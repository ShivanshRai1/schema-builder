/**
 * Deg-2 splice tips left after deleting a mid-wire branch must merge away
 * so junction squares disappear.
 */
import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { collapsePassThroughTips } from "../src/wiring/tipCleanup";
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

console.log("PASS collapse pass-through tips");
