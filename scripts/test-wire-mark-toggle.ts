import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { findWireJunctions } from "../src/wiring/junctions";
import {
  joinWiresAtCrossing,
  unjoinJunctionToCrossing,
} from "../src/wiring/wireMarkToggle";

function tipAt(id: string, x: number, y: number): Node<ComponentData> {
  return {
    id,
    type: "component",
    position: { x, y: y - 4 },
    data: { kind: "TIP", refdes: "", params: {} },
    style: { width: 8, height: 8 },
    measured: { width: 8, height: 8 },
  };
}

function wire(
  id: string,
  s: string,
  sh: string,
  t: string,
  th: string,
): Edge {
  return {
    id,
    type: "schematic",
    source: s,
    sourceHandle: sh,
    target: t,
    targetHandle: th,
    data: { waypoints: [], directPath: true },
  };
}

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

let id = 0;
const newId = () => `t${++id}`;

// Two free wires cross mid-mid → hop; join → one square; unjoin → hop again.
{
  id = 0;
  const nodes: Node<ComponentData>[] = [
    tipAt("hL", 0, 100),
    tipAt("hR", 200, 100),
    tipAt("vT", 100, 0),
    tipAt("vB", 100, 200),
  ];
  const edges: Edge[] = [
    wire("H", "hL", "t", "hR", "t"),
    wire("V", "vT", "t", "vB", "t"),
  ];

  const before = findWireJunctions(nodes, edges);
  assert(before.crossings.length >= 1, "expected a hop before join");
  assert(before.junctions.length === 0, "no square before join");

  const cross = before.crossings[0]!;
  assert(cross.edgeIds, "crossing needs edgeIds");
  const joined = joinWiresAtCrossing(
    nodes,
    edges,
    cross.edgeIds![0],
    cross.edgeIds![1],
    cross,
    newId,
  );
  assert(joined, "join should succeed");
  const mid = findWireJunctions(joined!.nodes, joined!.edges);
  assert(
    mid.junctions.length >= 1,
    `expected junction after join, got ${JSON.stringify(mid)}`,
  );
  assert(mid.crossings.length === 0, "hop should become a square");

  const tipId = mid.junctions.find((j) => j.tipId)?.tipId;
  assert(tipId, "junction should carry tipId");
  const unjoined = unjoinJunctionToCrossing(joined!.nodes, joined!.edges, tipId!);
  assert(unjoined, "unjoin should succeed");
  const after = findWireJunctions(unjoined!.nodes, unjoined!.edges);
  assert(
    after.crossings.length >= 1,
    `expected hop after unjoin, got ${JSON.stringify(after)}`,
  );
  assert(
    after.junctions.length === 0,
    `expected no square after unjoin, got ${JSON.stringify(after.junctions)}`,
  );
}

console.log("PASS wire mark toggle");
