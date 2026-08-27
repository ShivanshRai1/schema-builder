import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import { nextRotation } from "../src/model/rotation";
import { findWireJunctions } from "../src/wiring/junctions";
import { finalizeConnectedPartMove } from "../src/wiring/wireMove";

const node = (
  id: string,
  kind: "V" | "R" | "C" | "GND",
  x: number,
  y: number,
  rotation = 0,
): Node<ComponentData> => ({
  id,
  type: "component",
  position: { x, y },
  data: {
    kind,
    refdes: kind === "GND" ? "" : `${kind}1`,
    params: defaultParams(kind),
    rotation: rotation as 0 | 90 | 180 | 270,
  },
  measured: { width: 92, height: 54 },
});

const edge = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  waypoints: { x: number; y: number }[] = [],
): Edge => ({
  id,
  type: "schematic",
  source,
  sourceHandle,
  target,
  targetHandle,
  data: { waypoints },
});

// Direct pin-pin mesh with authored waypoints (no TIP junctions).
const nodes: Node<ComponentData>[] = [
  node("v", "V", 40, 180),
  node("r", "R", 320, 80),
  node("c", "C", 520, 80),
  node("g", "GND", 320, 360),
];
const edges: Edge[] = [
  edge("vr", "v", "p", "r", "a", [
    { x: 120, y: 100 },
    { x: 240, y: 100 },
  ]),
  edge("rc", "r", "b", "c", "a", [{ x: 420, y: 100 }]),
  edge("cg", "c", "b", "g", "g"),
  edge("vg", "v", "n", "g", "g"),
];

import { finalizeConnectedPartMove } from "../src/wiring/wireMove";

function quickRotateChain(
  nodesIn: Node<ComponentData>[],
  edgesIn: Edge[],
  steps: number,
): { nodes: Node<ComponentData>[]; edges: Edge[] } {
  let ns = nodesIn;
  let es = edgesIn;
  for (let i = 0; i < steps; i++) {
    const r = ns.find((n) => n.id === "r")!;
    const nextNodes = ns.map((n) =>
      n.id === "r"
        ? { ...n, data: { ...n.data, rotation: nextRotation(r.data.rotation) } }
        : n,
    );
    const out = finalizeConnectedPartMove(nextNodes, es, new Set(["r"]));
    ns = out.nodes;
    es = out.edges;
  }
  return { nodes: ns, edges: es };
}

// Stale-edge bug (old behavior): rotate twice but feed original edges on pass 2.
const once = quickRotateChain(nodes, edges, 1);
const r = once.nodes.find((n) => n.id === "r")!;
const staleNodes = once.nodes.map((n) =>
  n.id === "r"
    ? { ...n, data: { ...n.data, rotation: nextRotation(r.data.rotation) } }
    : n,
);
const stale = finalizeConnectedPartMove(staleNodes, edges, new Set(["r"]));
const staleMarks = findWireJunctions(stale.nodes, stale.edges);
if (!staleMarks.crossings.length) {
  throw new Error("expected stale-edge quick rotate to reproduce hollow crossings");
}

// Fixed behavior: always chain the latest finalized edges (mirrors nodesRef sync).
const fixed = quickRotateChain(nodes, edges, 3);
const fixedMarks = findWireJunctions(fixed.nodes, fixed.edges);
if (fixedMarks.crossings.length) {
  throw new Error(
    `chained quick rotate must stay clean: ${JSON.stringify(fixedMarks.crossings)}`,
  );
}

console.log("PASS stale-edge quick rotate reproduces bug in isolation");
console.log("PASS chained finalized edges stay clean on rapid rotate");
