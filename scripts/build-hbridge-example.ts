/**
 * Build examples/hbridge-simplified.json — simplified H-bridge for Run smoke tests.
 * Does not modify demo-circuit.json / starter.
 *
 * Topology (from 1HBridge_R6020PNJ…, PWM reduced to complementary VPULSE):
 *   Vin -- Q1 -- A -- Lout -- R -- B -- Q3 -- Vin
 *          |                              |
 *          Q4                             Q2
 *          +------------- 0 --------------+
 *   Vg1 → Rg → Q1+Q2 gates; Vg2 (delayed) → Rg → Q3+Q4.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { parseCircuitFile, toCircuitFile } from "../src/persistence/circuitFile";
import { toNetlist } from "../src/netlist/toNetlist";

function n(
  id: string,
  kind: ComponentData["kind"],
  refdes: string,
  x: number,
  y: number,
  params: Record<string, string> = {},
  rotation = 0,
): Node<ComponentData> {
  return {
    id,
    type: "component",
    position: { x, y },
    data: { kind, refdes, params, rotation },
  };
}

function e(
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  waypoints: { x: number; y: number }[] = [],
): Edge {
  return {
    id,
    type: "schematic",
    source,
    sourceHandle,
    target,
    targetHandle,
    data: { waypoints, directPath: true },
  };
}

const nodes: Node<ComponentData>[] = [
  n("vin", "BATTERY", "Vin", 48, 160, { dc: "48", rser: "" }),
  n("gnd", "GND", "", 320, 480, {}),

  n("q1", "SICMOS", "XQ1", 192, 48, { model: "SIC_MOS" }),
  n("q3", "SICMOS", "XQ3", 512, 48, { model: "SIC_MOS" }),
  n("q4", "SICMOS", "XQ4", 192, 288, { model: "SIC_MOS" }),
  n("q2", "SICMOS", "XQ2", 512, 288, { model: "SIC_MOS" }),

  n("lout", "L", "Lout", 336, 200, { value: "1m", ic: "" }, 90),
  n("rload", "R", "R", 432, 200, { value: "10" }, 90),

  // Complementary ~20 kHz gate drives (50 µs period), ~dead-time gap via delay.
  n("vg1", "VPULSE", "Vg1", -160, 64, {
    vinitial: "0",
    von: "10",
    tdelay: "0",
    trise: "10n",
    tfall: "10n",
    ton: "20u",
    tperiod: "50u",
  }),
  n("vg2", "VPULSE", "Vg2", -160, 304, {
    vinitial: "0",
    von: "10",
    tdelay: "25u",
    trise: "10n",
    tfall: "10n",
    ton: "20u",
    tperiod: "50u",
  }),

  n("rg1", "R", "Rg1", 32, 96, { value: "5" }, 90),
  n("rg2", "R", "Rg2", 32, 240, { value: "5" }, 90),
  n("rg3", "R", "Rg3", 672, 96, { value: "5" }, 90),
  n("rg4", "R", "Rg4", 672, 240, { value: "5" }, 90),

  n("lblVin", "WIRELABEL", "", 64, 48, { name: "Vin" }),
  n("lblA", "WIRELABEL", "", 256, 176, { name: "A" }),
  n("lblB", "WIRELABEL", "", 560, 176, { name: "B" }),

  n("prA", "VPROBE", "", 288, 128, {}),
  n("prB", "VPROBE", "", 592, 128, {}),
];

const edges: Edge[] = [
  // DC rail
  e("e-vin-lbl", "lblVin", "g", "vin", "p"),
  e("e-vin-q1", "vin", "p", "q1", "d", [{ x: 80, y: 32 }, { x: 240, y: 32 }]),
  e("e-vin-q3", "vin", "p", "q3", "d", [{ x: 80, y: 32 }, { x: 560, y: 32 }]),
  e("e-vin-gnd", "vin", "n", "gnd", "g", [{ x: 80, y: 496 }]),

  // Leg A: Q1.s / Q4.d
  e("e-q1s-q4d", "q1", "s", "q4", "d"),
  e("e-a-lbl", "lblA", "g", "q1", "s", [{ x: 256, y: 192 }]),
  e("e-a-pr", "prA", "p", "q1", "s", [{ x: 288, y: 192 }]),
  e("e-a-l", "q1", "s", "lout", "a", [{ x: 256, y: 192 }, { x: 352, y: 192 }]),
  e("e-l-r", "lout", "b", "rload", "a"),
  e("e-r-b", "rload", "b", "q3", "s", [{ x: 448, y: 192 }, { x: 560, y: 192 }]),
  e("e-b-lbl", "lblB", "g", "q3", "s", [{ x: 560, y: 192 }]),
  e("e-b-pr", "prB", "p", "q3", "s", [{ x: 592, y: 192 }]),
  e("e-q3s-q2d", "q3", "s", "q2", "d"),

  // Sources to ground
  e("e-q4s-gnd", "q4", "s", "gnd", "g", [{ x: 240, y: 496 }]),
  e("e-q2s-gnd", "q2", "s", "gnd", "g", [{ x: 560, y: 496 }]),

  // Diagonal drive Vg1 → Q1 + Q2
  e("e-vg1-gnd", "vg1", "n", "gnd", "g", [{ x: -128, y: 496 }]),
  e("e-vg1-rg1", "vg1", "p", "rg1", "a", [{ x: -128, y: 80 }]),
  e("e-rg1-q1", "rg1", "b", "q1", "g"),
  e("e-vg1-rg2", "vg1", "p", "rg2", "a", [{ x: -128, y: 80 }, { x: -128, y: 256 }]),
  e("e-rg2-q2", "rg2", "b", "q2", "g", [{ x: 80, y: 256 }, { x: 80, y: 360 }, { x: 512, y: 360 }]),

  // Complementary Vg2 → Q3 + Q4
  e("e-vg2-gnd", "vg2", "n", "gnd", "g", [{ x: -128, y: 496 }]),
  e("e-vg2-rg3", "vg2", "p", "rg3", "a", [{ x: -128, y: 320 }, { x: 704, y: 320 }, { x: 704, y: 80 }]),
  e("e-rg3-q3", "rg3", "b", "q3", "g"),
  e("e-vg2-rg4", "vg2", "p", "rg4", "a", [{ x: -128, y: 320 }, { x: 704, y: 320 }]),
  e("e-rg4-q4", "rg4", "b", "q4", "g", [{ x: 704, y: 256 }, { x: 192, y: 256 }]),
];

const snap = {
  nodes,
  edges,
  directives: [".tran 1u 500u", ".options reltol=1e-3"],
  library: "",
};

const parsed = parseCircuitFile(toCircuitFile(snap));
const netlist = toNetlist(parsed.nodes, parsed.edges, {
  title: "H-bridge simplified",
  directives: parsed.directives,
  library: parsed.library,
});

const required = ["Vin", "XQ1", "XQ2", "XQ3", "XQ4", "Lout", "R ", "Vg1", "Vg2", "SIC_MOS", ".tran"];
for (const tok of required) {
  if (!netlist.includes(tok)) {
    throw new Error(`netlist missing ${JSON.stringify(tok)}\n\n${netlist}`);
  }
}
if (netlist.includes("R6020") || /V=if/i.test(netlist)) {
  throw new Error("netlist still has LTspice-only constructs");
}

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "examples", "hbridge-simplified.json");
writeFileSync(out, JSON.stringify(toCircuitFile(parsed), null, 2) + "\n", "utf8");
console.log("wrote", out);
console.log("--- netlist preview ---");
console.log(netlist);
