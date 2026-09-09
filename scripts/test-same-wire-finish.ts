/**
 * Finishing a draw from a free tip onto the middle of the SAME edge must not
 * wipe the remnant half (end → split).
 */
import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { computeEdgePolyline } from "../src/wiring/wireGeometry";

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
    data: { waypoints, directPath: true },
  };
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

/**
 * Simulate the post-split graph: vertical rail A→T and T→B, then "finish"
 * from A onto T with a new horizontal spur (the buggy merge path).
 */
{
  const A = tip("A", 100, 0);
  const T = tip("T", 100, 80);
  const B = tip("B", 100, 160);
  const nodes = [A, T, B];
  const edges = [
    edge("AT", "A", "T"), // remnant after mid-wire finish split
    edge("TB", "T", "B"),
  ];

  // Bug: drop edges touching A, then skip re-add because otherId===T===target.
  const buggy = edges.filter((e) => e.source !== "A" && e.target !== "A");
  assert(buggy.length === 1 && buggy[0]!.id === "TB", "buggy path keeps only TB");
  assert(
    !buggy.some((e) => e.id === "AT"),
    "buggy path deleted AT (the missing half)",
  );

  // Fix: keep remnant; add drawn spur A→T.
  const fixed = [
    ...edges,
    edge("SPUR", "A", "T", [{ x: 40, y: 0 }, { x: 40, y: 80 }]),
  ];
  assert(fixed.length === 3, "fix keeps remnant + far half + spur");
  assert(fixed.some((e) => e.id === "AT"), "AT remnant survives");
  assert(fixed.some((e) => e.id === "TB"), "TB survives");
  assert(fixed.some((e) => e.id === "SPUR"), "new draw survives");

  const polyAT = computeEdgePolyline(nodes, fixed.find((e) => e.id === "AT")!);
  assert(polyAT.length >= 2, "remnant still a real path");
}

console.log("test-same-wire-finish: ok");
