import type { Edge, Node } from "@xyflow/react";
import type { ComponentData, ComponentKind } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import { applyNetlistToGraph } from "../src/netlist/applyNetlistToGraph";

function node(
  id: string,
  kind: ComponentKind,
  refdes: string,
  x: number,
  y: number,
): Node<ComponentData> {
  return {
    id,
    type: "component",
    position: { x, y },
    data: { kind, refdes, params: defaultParams(kind) },
  };
}

function edge(
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): Edge {
  return {
    id,
    type: "schematic",
    source,
    sourceHandle,
    target,
    targetHandle,
    data: { waypoints: [{ x: 96, y: 96 }] },
  };
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const nodes: Node<ComponentData>[] = [
  node("v", "V", "V1", 0, 100),
  node("r", "R", "R1", 200, 0),
  node("c", "C", "C1", 400, 100),
  node("g", "GND", "", 200, 300),
  node("tip", "TIP", "", 100, 96),
];
const edges: Edge[] = [
  edge("v-tip", "v", "p", "tip", "t"),
  edge("tip-r", "tip", "t", "r", "a"),
  edge("r-c", "r", "b", "c", "a"),
  edge("c-g", "c", "b", "g", "g"),
  edge("v-g", "v", "n", "g", "g"),
];

const same = applyNetlistToGraph(
  nodes,
  edges,
  "V1 1 0 DC 12\nR1 1 2 10k\nC1 2 0 1n\n.tran 1u 1m\n.end",
);
assert(!same.rewired, "value-only Apply must preserve wire geometry");
assert(same.nodes.some((n) => n.id === "tip"), "existing TIP must survive");
assert(same.edges.some((e) => e.id === "v-tip"), "existing edge id must survive");

const changed = applyNetlistToGraph(
  nodes,
  edges,
  "V1 1 0 DC 12\nR1 1 0 10k\n.tran 1u 1m\n.end",
);
assert(changed.rewired, "topology change must rebuild wires");
assert(!changed.nodes.some((n) => n.data.kind === "TIP"), "stale TIPs must be removed");
assert(!changed.edges.some((e) => e.source === "tip" || e.target === "tip"), "stale TIP edges must be removed");

console.log("PASS netlist Apply wire preservation");
