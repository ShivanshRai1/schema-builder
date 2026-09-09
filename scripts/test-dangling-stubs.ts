import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import { computeEdgePolyline } from "../src/wiring/wireGeometry";
import {
  cleanEdgeTrailingNubs,
  isDanglingOrTrailingEdge,
  normalizeWires,
  planDeleteSelectedSegment,
  planScissorWireDelete,
  removeDanglingOrTrailingEdges,
  trimEdgeEndsToJoins,
  trimTrailingNubs,
} from "../src/wiring/normalizeWires";

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
    data: { waypoints },
  };
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const nodes: Node<ComponentData>[] = [
  tip("J", 100, 100),
  tip("A", 100, 40),
  tip("B", 100, 200),
  tip("A2", 160, 40),
  tip("B2", 160, 200),
  tip("F", 60, 100),
];

const edges: Edge[] = [
  edge("JA", "J", "A"),
  edge("JB", "J", "B"),
  edge("AA2", "A", "A2"),
  edge("BB2", "B", "B2"),
  edge("JF", "J", "F"),
];

assert(isDanglingOrTrailingEdge(nodes, edges, edges[4]!), "JF is dangling");
assert(!isDanglingOrTrailingEdge(nodes, edges, edges[0]!), "JA is main");

const removed = removeDanglingOrTrailingEdges(nodes, edges, { atTipIds: ["J"] });
assert(removed.removed === 1, "should remove 1 stub");
assert(!removed.edges.some((e) => e.id === "JF"), "stub JF gone");

const norm = normalizeWires(nodes, edges);
assert(
  norm.edges.some((e) => e.id === "JF"),
  "global normalize preserves an intentional short branch",
);

const nubPoly = [
  { x: 100, y: 40 },
  { x: 100, y: 100 },
  { x: 116, y: 100 },
];
const trimmed = trimTrailingNubs(nubPoly);
assert(trimmed != null, "should trim nub");
assert(trimmed!.length === 2, "nub tip endpoint removed");

const tipNodes = [tip("T1", 100, 40), tip("T2", 116, 100)];
const tipEdge = edge("E", "T1", "T2", [{ x: 100, y: 100 }]);
const cleaned = cleanEdgeTrailingNubs(tipNodes, [tipEdge], tipEdge);
assert(cleaned.changed, "cleanEdgeTrailingNubs should change L-nub wire");

// Vertical free tip↔tip crossed by two horizontals at y=100 and y=200.
// Esc must retract stubs to those joins and keep the middle.
{
  const VT = tip("VT", 100, 0);
  const VB = tip("VB", 100, 300);
  const HT = tip("HT", 100, 100); // endpoint sits on vertical interior
  const HB = tip("HB", 100, 200);
  const LT = tip("LT", 40, 100);
  const LB = tip("LB", 40, 200);
  const n = [VT, VB, HT, HB, LT, LB];
  const es = [
    edge("VERT", "VT", "VB"),
    edge("H1", "LT", "HT"),
    edge("H2", "LB", "HB"),
  ];
  const r = trimEdgeEndsToJoins(n, es, es[0]!);
  assert(r.changed, "should retract vertical stubs to joins");
  const vt = r.nodes.find((x) => x.id === "VT")!;
  const vb = r.nodes.find((x) => x.id === "VB")!;
  // tip world y = position.y + 4
  assert(Math.abs(vt.position.y + 4 - 100) < 1, "top tip retracted to y=100");
  assert(Math.abs(vb.position.y + 4 - 200) < 1, "bottom tip retracted to y=200");
  assert(r.nodes.some((x) => x.id === "VT"), "vertical tips kept");
  assert(es.some((e) => e.id === "VERT"), "vertical edge kept");
}

// Scissors: clicking a short dangling stub next to a long rail must delete the
// stub only — not the long wire (matches the "extra tip under R1" case).
{
  const J = tip("J", 200, 160);
  const L = tip("L", 40, 160);
  const D = tip("D", 200, 200); // short stub downward
  const n = [J, L, D];
  const es = [
    edge("RAIL", "L", "J", [{ x: 120, y: 160 }]),
    edge("STUB", "J", "D"),
  ];
  // Click on the stub; hit-test might have reported the rail id.
  const plan = planScissorWireDelete(n, es, "RAIL", { x: 200, y: 180 });
  assert(plan?.action === "delete", "stub click deletes");
  assert(plan && plan.action === "delete" && plan.edgeId === "STUB", "deletes stub not rail");

  // Floating tip↔tip scrap (both free): short leftovers wipe; long snakes open-cut.
  const A = tip("A", 40, 160);
  const B = tip("B", 220, 200);
  const n2 = [A, B];
  const es2 = [edge("LONG", "A", "B", [{ x: 220, y: 160 }])];
  const wipe = planScissorWireDelete(n2, es2, "LONG", { x: 220, y: 190 });
  assert(
    wipe?.action === "cutOpen" || wipe?.action === "trimTip",
    `long free tip↔tip open-cuts/trims, does not wipe (got ${wipe?.action})`,
  );

  // Short floating tip↔tip scrap still wipes.
  const S1 = tip("S1", 40, 160);
  const S2 = tip("S2", 80, 160);
  const nShort = [S1, S2];
  const esShort = [edge("SHORT", "S1", "S2")];
  const shortWipe = planScissorWireDelete(nShort, esShort, "SHORT", { x: 60, y: 160 });
  assert(shortWipe?.action === "delete", "short floating tip↔tip leftover deletes");
  assert(
    shortWipe && shortWipe.action === "delete" && shortWipe.edgeId === "SHORT",
    "deletes the floating scrap edge",
  );

  // Shared junction tip: long L-shaped rail + another long branch on same tip —
  // peel the clicked nub; do not wipe the rail.
  const J2 = tip("J2", 220, 200);
  const L2 = tip("L2", 40, 160);
  const R2 = tip("R2", 220, 40); // other branch (too long to count as short stub)
  const n3 = [J2, L2, R2];
  const es3 = [
    edge("RAIL2", "L2", "J2", [{ x: 220, y: 160 }]),
    edge("UP", "R2", "J2"),
  ];
  const peel = planScissorWireDelete(n3, es3, "RAIL2", { x: 220, y: 190 });
  assert(peel?.action === "peelToNewTip", `shared tip peels instead of wiping rail (got ${peel?.action})`);
  assert(peel && peel.action === "peelToNewTip" && peel.edgeId === "RAIL2", "peels the rail edge");
}

// Pin↔free-tip leftover (typical after segment cut): short scraps wipe.
{
  const mk = (
    id: string,
    kind: "R",
    x: number,
    y: number,
  ): Node<ComponentData> => ({
    id,
    type: "component",
    position: { x, y },
    data: {
      kind,
      refdes: "R1",
      params: defaultParams(kind),
      rotation: 0,
    },
    measured: { width: 92, height: 54 },
  });
  const r = mk("r", "R", 300, 80);
  // Short stub off the right pin (~32u) — wipe; long intentional pin↔tip open-cuts.
  const t = tip("T", 380, 107);
  const n = [r, t];
  const es = [
    {
      id: "leftover",
      type: "schematic",
      source: "r",
      sourceHandle: "b",
      target: "T",
      targetHandle: "t",
      data: { waypoints: [], directPath: true },
    } as Edge,
  ];
  const plan = planScissorWireDelete(n, es, "leftover", { x: 360, y: 107 });
  assert(plan?.action === "delete", `short pin↔tip leftover deletes (got ${plan?.action})`);
}

// Pin↔junction tip (V1 vertical with corner circle): delete that branch.
{
  const mk = (
    id: string,
    kind: "V" | "R",
    x: number,
    y: number,
  ): Node<ComponentData> => ({
    id,
    type: "component",
    position: { x, y },
    data: {
      kind,
      refdes: `${kind}1`,
      params: defaultParams(kind),
      rotation: 0,
    },
    measured: { width: 92, height: 54 },
  });
  const v = mk("v", "V", 100, 200);
  const r = mk("r", "R", 300, 80);
  const j = tip("J", 164, 120);
  const n = [v, r, j];
  const es = [
    {
      id: "vert",
      type: "schematic",
      source: "v",
      sourceHandle: "a",
      target: "J",
      targetHandle: "t",
      data: { waypoints: [], directPath: true },
    } as Edge,
    {
      id: "horiz",
      type: "schematic",
      source: "J",
      sourceHandle: "t",
      target: "r",
      targetHandle: "a",
      data: { waypoints: [], directPath: true },
    } as Edge,
  ];
  const plan = planScissorWireDelete(n, es, "vert", { x: 164, y: 160 });
  assert(plan?.action === "delete", `pin↔junction tip deletes (got ${plan?.action})`);
  assert(plan && plan.action === "delete" && plan.edgeId === "vert", "deletes vertical branch");
}

// Pin↔pin: scissors open-cut the clicked run (end clicks used to "trim" and look like a no-op).
{
  const mk = (
    id: string,
    kind: "R" | "C",
    x: number,
    y: number,
  ): Node<ComponentData> => ({
    id,
    type: "component",
    position: { x, y },
    data: {
      kind,
      refdes: `${kind}1`,
      params: defaultParams(kind),
      rotation: 0,
    },
    measured: { width: 92, height: 54 },
  });
  const n = [mk("r", "R", 300, 80), mk("c", "C", 520, 80)];
  const es = [
    {
      id: "rb-ca",
      type: "schematic",
      source: "r",
      sourceHandle: "b",
      target: "c",
      targetHandle: "a",
      data: { waypoints: [{ x: 392, y: 144 }] },
    } as Edge,
  ];
  const poly = computeEdgePolyline(n, es[0]!);
  assert(poly.length >= 5, "nub poly should have extra bends");
  const vertMid = { x: 392, y: 120 };
  const plan = planScissorWireDelete(n, es, "rb-ca", vertMid);
  assert(
    plan?.action === "cutOpen" || plan?.action === "delete",
    `vertical click cuts/deletes (got ${plan?.action})`,
  );

  const railMid = { x: 456, y: 144 };
  const cut = planScissorWireDelete(n, es, "rb-ca", railMid);
  assert(cut?.action === "cutOpen", `long horizontal open-cuts (got ${cut?.action})`);
  assert(
    cut &&
      cut.action === "cutOpen" &&
      cut.beforePoly !== null &&
      cut.afterPoly !== null,
    "cut keeps both remaining path pieces",
  );
}

// Pin-exit stub click: open-cut / delete that end (no silent trim no-op).
{
  const mk = (
    id: string,
    kind: "R" | "C",
    x: number,
    y: number,
  ): Node<ComponentData> => ({
    id,
    type: "component",
    position: { x, y },
    data: {
      kind,
      refdes: `${kind}1`,
      params: defaultParams(kind),
      rotation: 0,
    },
    measured: { width: 92, height: 54 },
  });
  const n = [mk("r", "R", 300, 80), mk("c", "C", 400, 200)];
  const es = [
    {
      id: "rb-ca",
      type: "schematic",
      source: "r",
      sourceHandle: "b",
      target: "c",
      targetHandle: "a",
      data: { waypoints: [] },
    } as Edge,
  ];
  const before = computeEdgePolyline(n, es[0]!);
  assert(before.length >= 4, "autoroute has pin stubs");
  const stubMid = {
    x: (before[0]!.x + before[1]!.x) / 2,
    y: (before[0]!.y + before[1]!.y) / 2,
  };
  const plan = planScissorWireDelete(n, es, "rb-ca", stubMid);
  assert(
    plan?.action === "cutOpen" || plan?.action === "delete",
    `pin stub end cuts/deletes (got ${plan?.action})`,
  );
}

// Pin↔pin U-turn overhang past the elbow (horizontal sticks out past vertical).
{
  const mk = (
    id: string,
    kind: "R" | "C",
    x: number,
    y: number,
  ): Node<ComponentData> => ({
    id,
    type: "component",
    position: { x, y },
    data: {
      kind,
      refdes: `${kind}1`,
      params: defaultParams(kind),
      rotation: 0,
    },
    measured: { width: 92, height: 54 },
  });
  const n = [mk("r", "R", 300, 80), mk("c", "C", 400, 200)];
  // Waypoints force: stub → past elbow → back to column → down.
  const es = [
    {
      id: "rb-ca",
      type: "schematic",
      source: "r",
      sourceHandle: "b",
      target: "c",
      targetHandle: "a",
      data: {
        waypoints: [
          { x: 396, y: 96 },
          { x: 380, y: 96 },
          { x: 380, y: 216 },
        ],
      },
    } as Edge,
  ];
  const poly = computeEdgePolyline(n, es[0]!);
  assert(
    poly.some((p, i) => i > 0 && i < poly.length - 1 && p.x > 390),
    "poly should include overhang past x=390",
  );
  // Click on the long vertical near the elbow — peel overhang or cut segment.
  const vertClick = { x: 380, y: 120 };
  const plan = planScissorWireDelete(n, es, "rb-ca", vertClick);
  assert(
    plan?.action === "cutOpen" ||
      plan?.action === "delete" ||
      plan?.action === "trimTip",
    `vertical click acts (got ${plan?.action})`,
  );
  // Click on the overhang tip itself.
  const tipClick = { x: 396, y: 96 };
  const plan2 = planScissorWireDelete(n, es, "rb-ca", tipClick);
  assert(
    plan2?.action === "cutOpen" ||
      plan2?.action === "delete" ||
      plan2?.action === "trimTip",
    `overhang tip click acts (got ${plan2?.action})`,
  );
}

// Selected mid-run on a long free tip↔tip snake: delete that run only.
{
  const A = tip("MA", 0, 0);
  const B = tip("MB", 160, 0);
  // Battlement: vertical, right, up, right, down, right (many segments).
  const n = [A, B];
  const es = [
    edge("SNAKE", "MA", "MB", [
      { x: 0, y: 80 },
      { x: 40, y: 80 },
      { x: 40, y: 40 },
      { x: 80, y: 40 },
      { x: 80, y: 80 },
      { x: 120, y: 80 },
      { x: 120, y: 40 },
      { x: 160, y: 40 },
      { x: 160, y: 0 },
    ]),
  ];
  const poly = computeEdgePolyline(n, es[0]!);
  assert(poly.length > 4, "snake has many segments");
  // Delete a middle horizontal (index 3: (40,40)-(80,40)).
  const plan = planDeleteSelectedSegment(n, es, "SNAKE", 3);
  assert(plan?.action === "cutOpen", `selected segment open-cuts (got ${plan?.action})`);
  if (plan?.action === "cutOpen") {
    assert(plan.beforePoly != null && plan.afterPoly != null, "both remnants kept");
    assert(
      plan.beforePoly!.length >= 2 && plan.afterPoly!.length >= 2,
      "remnants are real paths",
    );
  }
  // Scissors click mid-snake must not wipe either.
  const mid = { x: 60, y: 40 };
  const clickPlan = planScissorWireDelete(n, es, "SNAKE", mid);
  assert(
    clickPlan?.action === "cutOpen",
    `scissors mid-snake open-cuts (got ${clickPlan?.action})`,
  );
}

console.log("test-dangling-stubs: ok");
