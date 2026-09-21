/**
 * Free-wire T onto a rail must show a filled junction square (user screenshot).
 */
import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { findWireJunctions } from "../src/wiring/junctions";

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

function hasJ(marks: ReturnType<typeof findWireJunctions>, x: number, y: number) {
  return marks.junctions.some(
    (p) => Math.abs(p.x - x) < 3 && Math.abs(p.y - y) < 3,
  );
}

// Classic T: vertical rail split at J + horizontal branch.
{
  const nodes = [
    tip("vT", 200, 0),
    tip("J", 200, 100),
    tip("vB", 200, 200),
    tip("hL", 40, 100),
  ];
  const edges = [
    edge("vu", "vT", "J"),
    edge("vd", "J", "vB"),
    edge("h", "hL", "J"),
  ];
  const marks = findWireJunctions(nodes, edges);
  assert(hasJ(marks, 200, 100), `classic T needs square at J, got ${JSON.stringify(marks)}`);
}

// Crossbar between two verticals (both T joins must mark).
{
  const nodes = [
    tip("lt", 0, 0),
    tip("lj", 0, 100),
    tip("lb", 0, 200),
    tip("rj", 200, 100),
    tip("rt", 200, 0),
    tip("rb", 200, 200),
  ];
  const edges = [
    edge("lv-u", "lt", "lj"),
    edge("lv-d", "lj", "lb"),
    edge("rv-u", "rt", "rj"),
    edge("rv-d", "rj", "rb"),
    edge("cross", "lj", "rj"),
  ];
  const marks = findWireJunctions(nodes, edges);
  assert(hasJ(marks, 0, 100), `left T square missing, got ${JSON.stringify(marks.junctions)}`);
  assert(hasJ(marks, 200, 100), `right T square missing, got ${JSON.stringify(marks.junctions)}`);
}

// Short branch nub (≤40px) onto a rail tip — must still show the square.
{
  const nodes = [
    tip("vT", 200, 0),
    tip("J", 200, 100),
    tip("vB", 200, 200),
    tip("hL", 180, 100),
  ];
  const edges = [
    edge("vu", "vT", "J"),
    edge("vd", "J", "vB"),
    edge("h", "hL", "J"),
  ];
  const marks = findWireJunctions(nodes, edges);
  assert(
    hasJ(marks, 200, 100),
    `short-nub T must still show square, got ${JSON.stringify(marks)}`,
  );
}

console.log("PASS free-wire T junction squares");
