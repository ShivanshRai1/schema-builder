import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import {
  cleanEdgeTrailingNubs,
  isDanglingOrTrailingEdge,
  normalizeWires,
  removeDanglingOrTrailingEdges,
  trimEdgeEndsToJoins,
  trimTrailingNubs,
} from "../src/wiring/normalizeWires";

function tip(id: string, x: number, y: number): Node<ComponentData> {
  return {
    id,
    type: "component",
    position: { x, y: y - 4 },
    data: { kind: "TIP", refdes: "", params: {} },
    style: { width: 8, height: 8 },
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  waypoints: { x: number; y: number }[] = [],
): Edge {
  return {
    id,
    type: "schematic",
    source,
    sourceHandle: "t",
    target,
    targetHandle: "t",
    data: { waypoints },
  };
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const nodes: Node<ComponentData>[] = [
  tip("J", 100, 100),
  tip("A", 100, 40),
  tip("B", 100, 200),
  tip("A2", 160, 40),
  tip("B2", 160, 200),
  tip("F", 60, 100),
];

const edges: Edge[] = [
  edge("JA", "J", "A"),
  edge("JB", "J", "B"),
  edge("AA2", "A", "A2"),
  edge("BB2", "B", "B2"),
  edge("JF", "J", "F"),
];

assert(isDanglingOrTrailingEdge(nodes, edges, edges[4]!), "JF is dangling");
assert(!isDanglingOrTrailingEdge(nodes, edges, edges[0]!), "JA is main");

const removed = removeDanglingOrTrailingEdges(nodes, edges, { atTipIds: ["J"] });
assert(removed.removed === 1, "should remove 1 stub");
assert(!removed.edges.some((e) => e.id === "JF"), "stub JF gone");

const norm = normalizeWires(nodes, edges);
assert(!norm.edges.some((e) => e.id === "JF"), "normalize removes short stub");

const nubPoly = [
  { x: 100, y: 40 },
  { x: 100, y: 100 },
  { x: 116, y: 100 },
];
const trimmed = trimTrailingNubs(nubPoly);
assert(trimmed != null, "should trim nub");
assert(trimmed!.length === 2, "nub tip endpoint removed");

const tipNodes = [tip("T1", 100, 40), tip("T2", 116, 100)];
const tipEdge = edge("E", "T1", "T2", [{ x: 100, y: 100 }]);
const cleaned = cleanEdgeTrailingNubs(tipNodes, [tipEdge], tipEdge);
assert(cleaned.changed, "cleanEdgeTrailingNubs should change L-nub wire");

// Vertical free tip↔tip crossed by two horizontals at y=100 and y=200.
// Esc must retract stubs to those joins and keep the middle.
{
  const VT = tip("VT", 100, 0);
  const VB = tip("VB", 100, 300);
  const HT = tip("HT", 100, 100); // endpoint sits on vertical interior
  const HB = tip("HB", 100, 200);
  const LT = tip("LT", 40, 100);
  const LB = tip("LB", 40, 200);
  const n = [VT, VB, HT, HB, LT, LB];
  const es = [
    edge("VERT", "VT", "VB"),
    edge("H1", "LT", "HT"),
    edge("H2", "LB", "HB"),
  ];
  const r = trimEdgeEndsToJoins(n, es, es[0]!);
  assert(r.changed, "should retract vertical stubs to joins");
  const vt = r.nodes.find((x) => x.id === "VT")!;
  const vb = r.nodes.find((x) => x.id === "VB")!;
  // tip world y = position.y + 4
  assert(Math.abs(vt.position.y + 4 - 100) < 1, "top tip retracted to y=100");
  assert(Math.abs(vb.position.y + 4 - 200) < 1, "bottom tip retracted to y=200");
  assert(r.nodes.some((x) => x.id === "VT"), "vertical tips kept");
  assert(es.some((e) => e.id === "VERT"), "vertical edge kept");
}

console.log("test-dangling-stubs: ok");
