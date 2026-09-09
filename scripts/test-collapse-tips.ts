/**
 * Deg-2 splice tips left after deleting a mid-wire branch must merge away
 * so junction squares disappear.
 */
import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { collapsePassThroughTips, collapseOnePassThroughTip } from "../src/wiring/tipCleanup";
import { findWireJunctions } from "../src/wiring/junctions";

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
  sh: string,
  target: string,
  th: string,
  waypoints: { x: number; y: number }[] = [],
): Edge {
  return {
    id,
    type: "schematic",
    source,
    sourceHandle: sh,
    target,
    targetHandle: th,
    data: { waypoints },
  };
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// Horizontal rail split by junction tip J, plus a vertical branch stub JF.
const nodes: Node<ComponentData>[] = [
  tip("L", 40, 100),
  tip("J", 100, 100),
  tip("R", 160, 100),
  tip("F", 100, 40),
];

const edges: Edge[] = [
  edge("LJ", "L", "t", "J", "t"),
  edge("JR", "J", "t", "R", "t"),
  edge("JF", "J", "t", "F", "t"),
];

// With 3 edges, J is a real junction.
{
  const marks = findWireJunctions(nodes, edges);
  assert(marks.junctions.some((p) => Math.abs(p.x - 100) < 1 && Math.abs(p.y - 100) < 1), "J marked");
}

// Delete the vertical branch — leave deg-2 splice on the rail.
const afterDelete = {
  nodes: nodes.filter((n) => n.id !== "F"),
  edges: edges.filter((e) => e.id !== "JF"),
};

{
  const marks = findWireJunctions(afterDelete.nodes, afterDelete.edges);
  assert(
    marks.junctions.some((p) => Math.abs(p.x - 100) < 1 && Math.abs(p.y - 100) < 1),
    "splice tip still marked before collapse",
  );
}

const healed = collapsePassThroughTips(afterDelete.nodes, afterDelete.edges);
assert(healed.merged === 1, "should merge one pass-through tip");
assert(!healed.nodes.some((n) => n.id === "J"), "J tip removed");
assert(healed.edges.length === 1, "one continuous rail");
assert(
  healed.edges[0]!.source === "L" && healed.edges[0]!.target === "R",
  "L connected to R",
);

{
  const marks = findWireJunctions(healed.nodes, healed.edges);
  assert(
    !marks.junctions.some((p) => Math.abs(p.x - 100) < 1 && Math.abs(p.y - 100) < 1),
    "junction square gone after collapse",
  );
}

// Free-wire L corners (deg-2 at a bend) must NOT collapse — scissors used to
// cascade-merge those and wipe whole box drawings.
{
  const boxNodes: Node<ComponentData>[] = [
    tip("A", 0, 0),
    tip("B", 100, 0),
    tip("C", 100, 80),
    tip("D", 0, 80),
    tip("H1", 0, 40),
    tip("H2", 200, 40),
  ];
  const boxEdges: Edge[] = [
    edge("AB", "A", "t", "B", "t"),
    edge("BC", "B", "t", "C", "t"),
    edge("CD", "C", "t", "D", "t"),
    edge("DA", "D", "t", "A", "t"),
    edge("bus", "H1", "t", "H2", "t"),
  ];
  const before = boxEdges.length;
  const out = collapsePassThroughTips(boxNodes, boxEdges);
  assert(out.merged === 0, "L-corner tips must not merge");
  assert(out.edges.length === before, "free-wire box edges must survive collapse");
  assert(out.nodes.filter((n) => n.data.kind === "TIP").length === boxNodes.length, "tips kept");
}

// Scoped collapse: straight extension merges only that tip; L-box untouched.
{
  const rail = collapseOnePassThroughTip(
    [tip("L", 40, 100), tip("J", 100, 100), tip("R", 160, 100)],
    [
      edge("LJ", "L", "t", "J", "t"),
      edge("JR", "J", "t", "R", "t"),
    ],
    "J",
  );
  assert(rail.merged === 1, "scoped straight tip merges");
  assert(rail.edges.length === 1, "scoped merge → one rail");

  const boxNodes = [
    tip("A", 0, 0),
    tip("B", 100, 0),
    tip("C", 100, 80),
    tip("D", 0, 80),
  ];
  const boxEdges = [
    edge("AB", "A", "t", "B", "t"),
    edge("BC", "B", "t", "C", "t"),
    edge("CD", "C", "t", "D", "t"),
    edge("DA", "D", "t", "A", "t"),
  ];
  const corner = collapseOnePassThroughTip(boxNodes, boxEdges, "B");
  assert(corner.merged === 0, "scoped L-corner must not merge");
  assert(corner.edges.length === 4, "scoped collapse leaves box intact");
}

console.log("PASS collapse pass-through tips");
