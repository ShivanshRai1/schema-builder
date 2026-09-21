/**
 * Reproduce: join two free wires into a rectangle / L — must NOT invent a
 * filled T square with no third branch. Delete of a real T must not wipe rails.
 */
import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { findWireJunctions, dissolveJunctionTip } from "../src/wiring/junctions";

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

// Two wires joined at a corner tip (L only) — no filled square.
{
  const nodes = [tip("A", 0, 0), tip("J", 0, 100), tip("B", 100, 100)];
  const edges = [edge("v", "A", "J"), edge("h", "J", "B")];
  const marks = findWireJunctions(nodes, edges);
  assert(
    marks.junctions.length === 0,
    `L join must not invent T square, got ${JSON.stringify(marks.junctions)}`,
  );
}

// Closed rectangle as one tip↔tip snake (ends meet) — not a T.
{
  const n2 = [tip("S", 0, 0), tip("E", 0, 0)];
  const e2 = [
    edge("box", "S", "E", [
      { x: 0, y: 200 },
      { x: 200, y: 200 },
      { x: 200, y: 0 },
    ]),
  ];
  const marks = findWireJunctions(n2, e2);
  assert(
    marks.junctions.length === 0,
    `closed rectangle snake must not invent T, got ${JSON.stringify(marks)}`,
  );
}

// Two wires: finish tip of H onto mid of V (same net via merge tip) → real T.
// Deg-3 tip should mark once.
{
  const nodes = [
    tip("vT", 0, 0),
    tip("J", 0, 100),
    tip("vB", 0, 200),
    tip("hR", 100, 100),
  ];
  const edges = [
    edge("vu", "vT", "J"),
    edge("vd", "J", "vB"),
    edge("h", "J", "hR"),
  ];
  const marks = findWireJunctions(nodes, edges);
  assert(marks.junctions.length === 1, `real T needs one square, got ${JSON.stringify(marks)}`);
}

// False self-T: tip lands on own L corner of a U (not mid-rail) — no square.
{
  const nodes = [tip("A", 0, 100), tip("B", 0, 100)];
  const edges = [
    edge("u", "A", "B", [
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ]),
  ];
  // A and B coincide at (0,100) — path goes out and back? Actually ends at same point.
  // Use: start (0,0), end lands on left vertical mid of own path.
  const n3 = [tip("S", 0, 0), tip("E", 0, 100)];
  const e3 = [
    edge("path", "S", "E", [
      { x: 100, y: 0 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
      { x: 0, y: 100 },
    ]),
  ];
  // E is at (0,100) which is ON the final vertical segment from (0,200) to (0,100) — that's the ENDPOINT, not interior.
  // True self-T: E at (0,100) while path has vertical (0,0)-(0,200) as earlier segment.
  const n4 = [tip("S", 0, 0), tip("E", 0, 100)];
  const e4 = [
    edge("selfT", "S", "E", [
      { x: 0, y: 200 },
      { x: 100, y: 200 },
      { x: 100, y: 100 },
    ]),
  ];
  // Path: (0,0)->(0,200)->(100,200)->(100,100)->(0,100). End (0,100) is on first segment interior.
  const marks = findWireJunctions(n4, e4);
  assert(
    marks.junctions.some((p) => Math.abs(p.x) < 2 && Math.abs(p.y - 100) < 2),
    `true self-T should mark, got ${JSON.stringify(marks)}`,
  );
}

// User bug: connecting two wires leaves a spur/T mark with no third branch —
// often a deg-2 tip + geometric self/elbow. Deg-2 L must stay unmarked.
{
  // After join: tip J shared by two edges only (collinear or L).
  const nodes = [tip("A", 0, 0), tip("J", 0, 100), tip("B", 0, 200)];
  const edges = [edge("a", "A", "J"), edge("b", "J", "B")];
  const marks = findWireJunctions(nodes, edges);
  assert(
    marks.junctions.length === 0,
    `collinear splice must not show T, got ${JSON.stringify(marks.junctions)}`,
  );
}

// Dissolve real T: three free tips remain, no edge deleted entirely as "wipe".
{
  let id = 0;
  const newId = () => `t${++id}`;
  const nodes = [
    tip("vT", 0, 0),
    tip("J", 0, 100),
    tip("vB", 0, 200),
    tip("hR", 100, 100),
  ];
  const edges = [
    edge("vu", "vT", "J"),
    edge("vd", "J", "vB"),
    edge("h", "J", "hR"),
  ];
  const out = dissolveJunctionTip(nodes, edges, "J", newId);
  assert(out, "dissolve must succeed");
  assert(out!.edges.length === 3, `keep 3 edges, got ${out!.edges.length}`);
  assert(!out!.nodes.some((n) => n.id === "J"), "shared tip removed");
  assert(
    out!.nodes.filter((n) => n.data.kind === "TIP").length >= 6,
    "each leg gets its own tip",
  );
}

console.log("PASS false-T + dissolve junction");
