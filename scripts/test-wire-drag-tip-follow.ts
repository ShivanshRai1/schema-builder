/**
 * Drag-sliding a tip↔tip rail must move TIP ends so T-junction squares follow.
 */
import { dragWireSegment } from "../src/wiring/wireGeometry";
import { findWireJunctions } from "../src/wiring/junctions";
import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";

function tip(id: string, x: number, y: number): Node<ComponentData> {
  return {
    id,
    type: "component",
    position: { x, y: y - 4 },
    data: { kind: "TIP", refdes: "", params: {} },
    style: { width: 8, height: 8 },
    measured: { width: 8, height: 8 },
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

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// Horizontal tip↔tip bus with vertical branch at each end (T junctions).
{
  const poly = [
    { x: 0, y: 100 },
    { x: 200, y: 100 },
  ];
  const next = dragWireSegment(poly, 0, { x: 100, y: 140 }, 16, {
    slideStart: true,
    slideEnd: true,
  });
  assert(next.length === 2, `expected translated bar, got ${JSON.stringify(next)}`);
  assert(next[0]!.y === next[1]!.y, "both ends move together");
  assert(Math.abs(next[0]!.y - 100) > 8, `rail Y must leave 100, got ${next[0]!.y}`);
  assert(next[0]!.x === 0 && next[1]!.x === 200, "x ends stay");
}

// Without slide flags, ends stay and a dogleg forms (old behavior for pins).
{
  const poly = [
    { x: 0, y: 100 },
    { x: 200, y: 100 },
  ];
  const next = dragWireSegment(poly, 0, { x: 100, y: 160 }, 16);
  assert(next[0]!.y === 100 && next[next.length - 1]!.y === 100, "pin-style ends stay fixed");
  assert(next.some((p) => Math.abs(p.y - 160) < 1), "bar shifts between fixed ends");
}

// After sliding tips, junction marks sit on the new rail Y.
{
  const y0 = 100;
  const y1 = 160;
  let nodes: Node<ComponentData>[] = [
    tip("jt", 0, y0),
    tip("hR", 200, y0),
    tip("vT", 0, 0),
    tip("vB", 0, 200),
  ];
  let edges: Edge[] = [
    edge("h", "jt", "hR"),
    edge("vu", "vT", "jt"),
    edge("vd", "jt", "vB"),
  ];
  const next = dragWireSegment(
    [
      { x: 0, y: y0 },
      { x: 200, y: y0 },
    ],
    0,
    { x: 100, y: y1 },
    16,
    { slideStart: true, slideEnd: true },
  );
  const ny = next[0]!.y;
  nodes = nodes.map((n) => {
    if (n.id === "jt") return { ...n, position: { x: 0, y: ny - 4 } };
    if (n.id === "hR") return { ...n, position: { x: 200, y: ny - 4 } };
    return n;
  });
  // Vertical top tip stays; branch re-anchors via tip — mark must be at jt.
  const marks = findWireJunctions(nodes, edges);
  assert(
    marks.junctions.some((p) => Math.abs(p.x - 0) < 2 && Math.abs(p.y - ny) < 2),
    `T must follow rail to y=${ny}, got ${JSON.stringify(marks.junctions)}`,
  );
}

console.log("PASS wire drag tip-follow for T junctions");
