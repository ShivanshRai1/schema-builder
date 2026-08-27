import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import { computeEdgePolyline } from "../src/wiring/wireGeometry";
import {
  cleanEdgeTrailingNubs,
  isDanglingOrTrailingEdge,
  normalizeWires,
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

  // Long rail ending in a free tip with a short terminal nub — trim nub.
  const A = tip("A", 40, 160);
  const B = tip("B", 220, 200);
  const n2 = [A, B];
  const es2 = [edge("LONG", "A", "B", [{ x: 220, y: 160 }])];
  const trim = planScissorWireDelete(n2, es2, "LONG", { x: 220, y: 190 });
  assert(trim?.action === "trimTip", "trims free-tip nub on long wire");
  assert(
    trim &&
      trim.action === "trimTip" &&
      trim.trimmedPoly.length >= 2 &&
      Math.abs(trim.trimmedPoly[trim.trimmedPoly.length - 1]!.y - 160) < 1,
    "nub removed; tip sits on the rail row",
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

// Pin↔pin L-nub (vertical jog off R.b stub): scissors must trim, not delete rail.
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
  assert(plan?.action === "trimTip", `vertical nub trims (got ${plan?.action})`);
  assert(
    plan &&
      plan.action === "trimTip" &&
      plan.trimmedPoly.every((p) => Math.abs(p.x - 392) > 1 || Math.abs(p.y - 96) < 1),
    "vertical jog removed from trimmed poly",
  );

  const railMid = { x: 442, y: 96 };
  const refuse = planScissorWireDelete(n, es, "rb-ca", railMid);
  assert(refuse === null, "long horizontal click must not delete pin↔pin rail");
}

// Pin-exit stub (autoroute tip): scissors must peel it and keep it gone.
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
  assert(plan?.action === "trimTip", `pin stub peels (got ${plan?.action})`);
  assert(
    plan && plan.action === "trimTip" && plan.directPath === true,
    "pin stub peel locks directPath",
  );
  assert(
    plan &&
      plan.action === "trimTip" &&
      plan.trimmedPoly.length >= 2 &&
      Math.hypot(
        plan.trimmedPoly[1]!.x - plan.trimmedPoly[0]!.x,
        plan.trimmedPoly[1]!.y - plan.trimmedPoly[0]!.y,
      ) > 16.5,
    "first remaining segment is longer than a pin stub",
  );
  // Persist like App does — stub must not regenerate.
  const wps =
    plan!.action === "trimTip" && plan.trimmedPoly.length > 2
      ? plan.trimmedPoly.slice(1, -1)
      : [];
  const afterEdge = {
    ...es[0]!,
    data: { waypoints: wps, directPath: true },
  };
  const after = computeEdgePolyline(n, afterEdge);
  const firstLen = Math.hypot(
    after[1]!.x - after[0]!.x,
    after[1]!.y - after[0]!.y,
  );
  assert(firstLen > 16.5, `peeled stub stays gone (firstLen=${firstLen})`);
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
  // Click on the long vertical near the elbow — previously this no-oped.
  const vertClick = { x: 380, y: 120 };
  const plan = planScissorWireDelete(n, es, "rb-ca", vertClick);
  assert(plan?.action === "trimTip", `overhang peels on vertical click (got ${plan?.action})`);
  assert(
    plan &&
      plan.action === "trimTip" &&
      !plan.trimmedPoly.some(
        (p, i) =>
          i > 0 &&
          i < plan.trimmedPoly.length - 1 &&
          p.x > 390,
      ),
    "overhang tip removed from trimmed poly",
  );
  // Click on the overhang tip itself.
  const tipClick = { x: 396, y: 96 };
  const plan2 = planScissorWireDelete(n, es, "rb-ca", tipClick);
  assert(plan2?.action === "trimTip", "overhang tip click peels");
}

console.log("test-dangling-stubs: ok");
