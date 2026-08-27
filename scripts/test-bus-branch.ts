/**
 * Branch at cursor column on the clicked H bus — not nearest junction.
 */
import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { resolveBranchOnEdge } from "../src/wiring/busBranch";

function tip(id: string, x: number, y: number): Node<ComponentData> {
  return {
    id,
    type: "component",
    position: { x, y: y - 4 },
    data: { kind: "TIP", refdes: "", params: {} },
    style: { width: 8, height: 8 },
  };
}

function edge(id: string, a: string, b: string): Edge {
  return {
    id,
    type: "schematic",
    source: a,
    sourceHandle: "t",
    target: b,
    targetHandle: "t",
    data: { waypoints: [] },
  };
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// Horizontal bus 40→200 at y=100, with an existing junction tip at x=100.
const nodes: Node<ComponentData>[] = [
  tip("L", 40, 100),
  tip("J", 100, 100),
  tip("R", 200, 100),
  tip("V", 100, 160),
];
const edges: Edge[] = [
  edge("LJ", "L", "J"),
  edge("JR", "J", "R"),
  edge("JV", "J", "V"),
];

// Click on JR segment below the bus at x=148 — must attach near 144/160, not J(100).
const hit = resolveBranchOnEdge(nodes, edges, "JR", { x: 148, y: 130 }, 16);
assert(hit, "should resolve on JR");
assert(hit!.busAxis === "h", "H bus");
assert(Math.abs(hit!.point.y - 100) < 1, "on bus Y");
assert(Math.abs(hit!.point.x - 100) > 8, `must not stick to J, got ${hit!.point.x}`);
assert(
  Math.abs(hit!.point.x - 144) < 1 ||
    Math.abs(hit!.point.x - 160) < 1 ||
    Math.abs(hit!.point.x - 148) < 1,
  `column near cursor, got ${hit!.point.x}`,
);

console.log("PASS resolveBranchOnEdge column", hit!.point);
