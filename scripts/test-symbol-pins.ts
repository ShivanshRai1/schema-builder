/**
 * New schematic symbols must keep catalog pin sides, so wires/netlist stay valid.
 * Layout boxes are grid-aligned (16px) so center pins land on the wire grid.
 */
import type { Node } from "@xyflow/react";
import type { ComponentData, ComponentKind } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import { getSymbolLayout, hasSymbol, layoutPinsOnGrid } from "../src/nodes/symbols/layout";
import { pinWorldPoint } from "../src/wiring/pinGeometry";
import { WIRE_GRID } from "../src/wiring/orthogonal";

const mk = (kind: ComponentKind, x = 0, y = 0): Node<ComponentData> => ({
  id: kind,
  type: "component",
  position: { x, y },
  data: { kind, refdes: kind, params: { ...defaultParams(kind) } },
});

function expectPin(
  kind: ComponentKind,
  pinId: string,
  x: number,
  y: number,
) {
  const pt = pinWorldPoint(mk(kind), pinId);
  if (!pt || Math.abs(pt.x - x) > 0.5 || Math.abs(pt.y - y) > 0.5) {
    console.error(`FAIL ${kind}.${pinId} expected`, { x, y }, "got", pt);
    process.exit(1);
  }
}

function expectOnGrid(kind: ComponentKind, pinId: string) {
  const pt = pinWorldPoint(mk(kind), pinId);
  if (!pt) {
    console.error(`FAIL ${kind}.${pinId} missing`);
    process.exit(1);
  }
  if (pt.x % WIRE_GRID !== 0 || pt.y % WIRE_GRID !== 0) {
    console.error(`FAIL ${kind}.${pinId} off-grid`, pt);
    process.exit(1);
  }
}

for (const kind of ["R", "C", "L", "V", "GND", "D", "I", "NMOS", "PMOS", "NPN", "PNP", "EAMP"] as const) {
  if (!hasSymbol(kind) || !getSymbolLayout(kind)) {
    console.error("FAIL missing symbol layout", kind);
    process.exit(1);
  }
  if (!layoutPinsOnGrid(kind)) {
    console.error("FAIL layout not grid-aligned", kind, getSymbolLayout(kind));
    process.exit(1);
  }
}

// Diode: a left, k right. Layout 64×32
expectPin("D", "a", 0, 16);
expectPin("D", "k", 64, 16);

// V / I: Layout 64×112 — center column and both ends on grid
expectPin("I", "p", 32, 0);
expectPin("I", "n", 32, 112);
expectPin("V", "p", 32, 0);
expectPin("V", "n", 32, 112);
expectOnGrid("V", "p");
expectOnGrid("V", "n");

// After 90° the box swaps so pins sit on the leads, not on the circle.
const v90: Node<ComponentData> = {
  ...mk("V"),
  data: { ...mk("V").data, rotation: 90 },
};
const p90 = pinWorldPoint(v90, "p");
const n90 = pinWorldPoint(v90, "n");
if (!p90 || p90.x !== 112 || p90.y !== 32) {
  console.error("FAIL V@90 p should be right-center", p90);
  process.exit(1);
}
if (!n90 || n90.x !== 0 || n90.y !== 32) {
  console.error("FAIL V@90 n should be left-center", n90);
  process.exit(1);
}

// NMOS: D top, G left, S bottom. Layout 64×96
expectPin("NMOS", "d", 32, 0);
expectPin("NMOS", "g", 0, 48);
expectPin("NMOS", "s", 32, 96);

// PMOS catalog inverts D/S vs NMOS.
expectPin("PMOS", "s", 32, 0);
expectPin("PMOS", "g", 0, 48);
expectPin("PMOS", "d", 32, 96);

expectPin("NPN", "c", 32, 0);
expectPin("NPN", "b", 0, 48);
expectPin("NPN", "e", 32, 96);

expectPin("PNP", "e", 32, 0);
expectPin("PNP", "b", 0, 48);
expectPin("PNP", "c", 32, 96);

// Op-amp: + at 0.25, − at 0.75, out right-center. Layout 64×64
expectPin("EAMP", "inp", 0, 16);
expectPin("EAMP", "inn", 0, 48);
expectPin("EAMP", "out", 64, 32);

expectOnGrid("R", "a");
expectOnGrid("GND", "g");

console.log("PASS new symbol pin geometry matches catalog sides (grid-aligned)");
