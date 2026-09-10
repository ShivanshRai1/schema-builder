import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import { findWireJunctions } from "../src/wiring/junctions";

const mk = (
  id: string,
  kind: "R" | "C" | "GND" | "V" | "TIP" | "WIRELABEL",
  x: number,
  y: number,
): Node<ComponentData> => ({
  id,
  type: "component",
  position: { x, y },
  data:
    kind === "TIP"
      ? { kind: "TIP", refdes: "", params: {} }
      : kind === "WIRELABEL"
        ? { kind: "WIRELABEL", refdes: "", params: { name: "vin" } }
        : {
            kind,
            refdes: kind === "GND" ? "" : `${kind}1`,
            params: { ...defaultParams(kind) },
          },
  ...(kind === "TIP"
    ? { style: { width: 8, height: 8 }, measured: { width: 8, height: 8 } }
    : {}),
});

const tipAt = (id: string, x: number, y: number): Node<ComponentData> => ({
  id,
  type: "component",
  position: { x, y: y - 4 },
  data: { kind: "TIP", refdes: "", params: {} },
  style: { width: 8, height: 8 },
  measured: { width: 8, height: 8 },
});

const wire = (
  id: string,
  s: string,
  sh: string,
  t: string,
  th: string,
  wps: { x: number; y: number }[] = [],
): Edge => ({
  id,
  type: "schematic",
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
  data: { waypoints: wps },
});

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

// Shared TIP T (3 wire legs) → filled junction mark.
{
  const tip = tipAt("tip", 200, 104);
  const nodes: Node<ComponentData>[] = [
    mk("r", "R", 40, 88),
    mk("c", "C", 320, 88),
    mk("g", "GND", 192, 200),
    tip,
  ];
  const edges: Edge[] = [
    wire("e1", "r", "b", "tip", "t"),
    wire("e2", "tip", "t", "c", "a"),
    wire("e3", "tip", "t", "g", "a"),
  ];
  const marks = findWireJunctions(nodes, edges);
  assert(marks.junctions.length >= 1, "3-leg TIP should mark a junction");
}

// Through-splice tip (2 collinear wires, tip on the rail) → no filled square.
{
  const tip = tipAt("tip", 200, 104);
  const nodes: Node<ComponentData>[] = [mk("r", "R", 40, 88), mk("c", "C", 320, 88), tip];
  const edges: Edge[] = [
    {
      id: "e1",
      type: "schematic",
      source: "r",
      sourceHandle: "b",
      target: "tip",
      targetHandle: "t",
      data: { waypoints: [], directPath: true },
    },
    {
      id: "e2",
      type: "schematic",
      source: "tip",
      sourceHandle: "t",
      target: "c",
      targetHandle: "a",
      data: { waypoints: [], directPath: true },
    },
  ];
  const marks = findWireJunctions(nodes, edges);
  assert(marks.junctions.length === 0, "2-leg TIP bend should not mark a junction");
}

// L-bend + net label must not look like a T (false square under "vin").
{
  const tip = tipAt("tip", 200, 104);
  const label = mk("lb", "WIRELABEL", 188, 60);
  const nodes: Node<ComponentData>[] = [
    mk("r", "R", 40, 88),
    mk("c", "C", 320, 88),
    tip,
    label,
  ];
  const edges: Edge[] = [
    {
      id: "e1",
      type: "schematic",
      source: "r",
      sourceHandle: "b",
      target: "tip",
      targetHandle: "t",
      data: { waypoints: [], directPath: true },
    },
    {
      id: "e2",
      type: "schematic",
      source: "tip",
      sourceHandle: "t",
      target: "c",
      targetHandle: "a",
      data: { waypoints: [], directPath: true },
    },
    {
      id: "e3",
      type: "schematic",
      source: "lb",
      sourceHandle: "g",
      target: "tip",
      targetHandle: "t",
      data: { waypoints: [], directPath: true },
    },
  ];
  const marks = findWireJunctions(nodes, edges);
  assert(
    marks.junctions.length === 0,
    "WIRELABEL must not inflate tip degree into a junction mark",
  );
}

// Single wire → no invented marks.
{
  const nodes: Node<ComponentData>[] = [mk("r", "R", 0, 0), mk("c", "C", 200, 0)];
  const edges: Edge[] = [wire("h", "r", "b", "c", "a")];
  const marks = findWireJunctions(nodes, edges);
  assert(marks.junctions.length === 0, "single wire should not invent junctions");
  assert(marks.crossings.length === 0, "single wire should not invent crossings");
}

// Different-net: free tip of a vertical sits on a horizontal → hollow crossing.
{
  const hL = tipAt("hL", 0, 100);
  const hR = tipAt("hR", 200, 100);
  const vT = tipAt("vT", 100, 100); // tip parked on the horizontal
  const vB = tipAt("vB", 100, 200);
  const nodes = [hL, hR, vT, vB];
  const edges = [wire("H", "hL", "t", "hR", "t"), wire("V", "vT", "t", "vB", "t")];
  const marks = findWireJunctions(nodes, edges);
  assert(
    marks.crossings.length >= 1,
    `different-net tip-on-wire should be a crossing, got j=${marks.junctions.length} c=${marks.crossings.length}`,
  );
  assert(marks.junctions.length === 0, "different-net should not be a filled junction");
}

// Mid-mid cross of two free wires → hop.
{
  const nodes = [
    tipAt("hL", 0, 100),
    tipAt("hR", 200, 100),
    tipAt("vT", 100, 0),
    tipAt("vB", 100, 200),
  ];
  const edges = [wire("H", "hL", "t", "hR", "t"), wire("V", "vT", "t", "vB", "t")];
  const marks = findWireJunctions(nodes, edges);
  assert(marks.crossings.length >= 1, "mid-mid free cross should hop");
  assert(marks.junctions.length === 0, "mid-mid free cross should not join");
}

// One wire that snakes over itself → hop (not a join square).
{
  const a = tipAt("a", 0, 0);
  const b = tipAt("b", 0, 200);
  const nodes = [a, b];
  const edges: Edge[] = [
    {
      id: "snake",
      type: "schematic",
      source: "a",
      sourceHandle: "t",
      target: "b",
      targetHandle: "t",
      data: {
        waypoints: [
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 50, y: 100 },
          { x: 50, y: 50 },
          { x: 150, y: 50 },
          { x: 150, y: 200 },
        ],
      },
    },
  ];
  const marks = findWireJunctions(nodes, edges);
  assert(
    marks.crossings.length >= 1,
    `self-cross should hop, got j=${marks.junctions.length} c=${marks.crossings.length}`,
  );
}

// Wire ends on its own earlier rail (self-T) → filled square.
{
  const nodes = [tipAt("A", 0, 0), tipAt("B", 100, 100)];
  const edges: Edge[] = [
    {
      id: "selfT",
      type: "schematic",
      source: "A",
      sourceHandle: "t",
      target: "B",
      targetHandle: "t",
      data: {
        directPath: true,
        waypoints: [
          { x: 0, y: 100 },
          { x: 200, y: 100 },
        ],
      },
    },
  ];
  const marks = findWireJunctions(nodes, edges);
  assert(
    marks.junctions.some((p) => Math.abs(p.x - 100) < 2 && Math.abs(p.y - 100) < 2),
    `self-T needs square, got ${JSON.stringify(marks)}`,
  );
}

// H→V T with a short nub into the tip → one square only (not tip + elbow).
{
  const tip = tipAt("j", 200, 100);
  const vT = tipAt("vT", 200, 0);
  const vB = tipAt("vB", 200, 200);
  const hL = tipAt("hL", 40, 108);
  const nodes = [tip, vT, vB, hL];
  const edges: Edge[] = [
    {
      id: "vu",
      type: "schematic",
      source: "vT",
      sourceHandle: "t",
      target: "j",
      targetHandle: "t",
      data: { waypoints: [], directPath: true },
    },
    {
      id: "vd",
      type: "schematic",
      source: "j",
      sourceHandle: "t",
      target: "vB",
      targetHandle: "t",
      data: { waypoints: [], directPath: true },
    },
    {
      id: "h",
      type: "schematic",
      source: "hL",
      sourceHandle: "t",
      target: "j",
      targetHandle: "t",
      data: {
        waypoints: [{ x: 200, y: 108 }],
        directPath: true,
      },
    },
  ];
  const marks = findWireJunctions(nodes, edges);
  assert(
    marks.junctions.length === 1,
    `nubbed T should mark once, got ${JSON.stringify(marks.junctions)}`,
  );
  assert(
    Math.abs(marks.junctions[0]!.y - 100) < 2,
    "single square should sit on the tip, not the elbow",
  );
}

console.log("PASS wire junctions");
