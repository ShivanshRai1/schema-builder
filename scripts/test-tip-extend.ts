/**
 * Extending a dangling tip onto a real pin must replace tip→wire with pin↔pin
 * and put both ends on the same net (never delete the wire).
 */
import { addEdge, type Edge, type Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import { clearTipStubsOnPins, pruneOrphanTips } from "../src/wiring/tipCleanup";
import { extractNets } from "../src/netlist/nets";
import { findNearestPin, PIN_SNAP_RADIUS } from "../src/wiring/pinGeometry";

const mk = (
  id: string,
  kind: "R" | "C" | "TIP",
  x: number,
  y: number,
  refdes = "",
): Node<ComponentData> => ({
  id,
  type: "component",
  position: { x, y },
  data: {
    kind,
    refdes: refdes || (kind === "R" ? "R1" : kind === "C" ? "C1" : ""),
    params: kind === "TIP" ? {} : { ...defaultParams(kind) },
  },
  measured: kind === "TIP" ? { width: 8, height: 8 } : { width: 92, height: 54 },
  ...(kind === "TIP" ? { style: { width: 8, height: 8 } } : {}),
});

/** Same merge path as App.onWire when source is a TIP. */
function mergeTipToPin(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  tipId: string,
  targetId: string,
  targetHandle: string,
  waypoints: { x: number; y: number }[],
): { nodes: Node<ComponentData>[]; edges: Edge[] } {
  const intoTip = edges.find(
    (e) =>
      (e.target === tipId && e.targetHandle === "t") ||
      (e.source === tipId && e.sourceHandle === "t"),
  );
  if (!intoTip) throw new Error("no tip edge");
  const fromSource = intoTip.target === tipId;
  const otherId = fromSource ? intoTip.source! : intoTip.target!;
  const otherHandle = fromSource ? intoTip.sourceHandle! : intoTip.targetHandle!;
  if (otherId === targetId && otherHandle === targetHandle) {
    const withoutTip = edges.filter((e) => e.source !== tipId && e.target !== tipId);
    return pruneOrphanTips(
      nodes.filter((n) => n.id !== tipId),
      withoutTip,
    );
  }
  const base =
    ((intoTip.data as { waypoints?: { x: number; y: number }[] } | undefined)?.waypoints) ??
    [];
  const tipNode = nodes.find((n) => n.id === tipId)!;
  const tipPos = { x: tipNode.position.x, y: tipNode.position.y + 4 };
  const orientedBase = fromSource ? base : [...base].reverse();
  const merged = [...orientedBase, tipPos, ...waypoints];
  let nextNodes = nodes.filter((n) => n.id !== tipId);
  let nextEdges = edges.filter((e) => e.source !== tipId && e.target !== tipId);
  const cleared = clearTipStubsOnPins(nextNodes, nextEdges, [
    { nodeId: targetId, handle: targetHandle },
  ]);
  nextNodes = cleared.nodes;
  nextEdges = cleared.edges;
  const pruned = pruneOrphanTips(nextNodes, nextEdges);
  return {
    nodes: pruned.nodes,
    edges: addEdge(
      {
        id: `${otherId}${otherHandle}-${targetId}${targetHandle}`,
        type: "schematic",
        source: otherId,
        sourceHandle: otherHandle,
        target: targetId,
        targetHandle: targetHandle,
        data: { waypoints: merged },
      },
      pruned.edges,
    ),
  };
}

const r1 = mk("n2", "R", 280, 90, "R1");
const c1 = mk("n3", "C", 540, 180, "C1");
// Tip parked on C1 pin a (false-connect geometry) — click steals from the pin.
const tip = mk("tip1", "TIP", 540 - 4, 180 + 27 - 4);
const stub: Edge = {
  id: "n2b-tip1t",
  type: "schematic",
  source: "n2",
  sourceHandle: "b",
  target: "tip1",
  targetHandle: "t",
  data: { waypoints: [{ x: 400, y: 117 }, { x: 400, y: 207 }] },
};

const before = extractNets([r1, c1, tip], [stub]);
if (before.netOf("n2", "b") === before.netOf("n3", "a")) {
  console.error("FAIL: tip on C1 must not already net-join before connect");
  process.exit(1);
}

const after = mergeTipToPin([r1, c1, tip], [stub], "tip1", "n3", "a", [
  { x: 520, y: 207 },
]);
if (after.nodes.some((n) => n.data.kind === "TIP")) {
  console.error("FAIL: tip should be gone after connect", after.nodes);
  process.exit(1);
}
if (after.edges.length !== 1) {
  console.error("FAIL: expected one pin↔pin edge", after.edges);
  process.exit(1);
}
const e = after.edges[0]!;
if (e.source !== "n2" || e.target !== "n3" || e.sourceHandle !== "b" || e.targetHandle !== "a") {
  console.error("FAIL: edge should be R1.b → C1.a", e);
  process.exit(1);
}
const nets = extractNets(after.nodes, after.edges);
if (nets.netOf("n2", "b") !== nets.netOf("n3", "a")) {
  console.error("FAIL: R1.b and C1.a must share a net after extend", nets);
  process.exit(1);
}

// Click resolution: tip on pin a → nearest real pin is C1.a
const tipPt = { x: 540, y: 207 };
const under = findNearestPin([r1, c1, tip], tipPt, {
  maxDist: PIN_SNAP_RADIUS,
  exclude: { nodeId: "tip1", pinId: "t" },
});
if (!under || under.nodeId !== "n3" || under.pinId !== "a") {
  console.error("FAIL: tip on C1.a should resolve to C1.a", under);
  process.exit(1);
}

// --- tip→tip wire: extend one tip to a real pin must NOT delete the wire ------
// Mirrors App.onWire "source is TIP" branch.
function extendSourceTip(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  tipId: string,
  targetId: string,
  targetHandle: string,
  waypoints: { x: number; y: number }[],
): { nodes: Node<ComponentData>[]; edges: Edge[] } {
  const intoTip = edges.find(
    (e) =>
      (e.target === tipId && e.targetHandle === "t") ||
      (e.source === tipId && e.sourceHandle === "t"),
  );
  if (!intoTip) throw new Error("no tip edge");
  const fromSource = intoTip.target === tipId;
  const otherId = fromSource ? intoTip.source! : intoTip.target!;
  const otherHandle = fromSource ? intoTip.sourceHandle! : intoTip.targetHandle!;
  const base =
    ((intoTip.data as { waypoints?: { x: number; y: number }[] } | undefined)?.waypoints) ??
    [];
  const tipNode = nodes.find((n) => n.id === tipId)!;
  const tipPos = { x: tipNode.position.x, y: tipNode.position.y + 4 };
  const orientedBase = fromSource ? base : [...base].reverse();
  const merged = [...orientedBase, tipPos, ...waypoints];
  let nextNodes = nodes.filter((n) => n.id !== tipId);
  let nextEdges = edges.filter((e) => e.source !== tipId && e.target !== tipId);
  if (!(otherId === targetId && otherHandle === targetHandle)) {
    nextEdges = addEdge(
      {
        id: `${otherId}${otherHandle}-${targetId}${targetHandle}`,
        type: "schematic",
        source: otherId,
        sourceHandle: otherHandle,
        target: targetId,
        targetHandle: targetHandle,
        data: { waypoints: merged },
      },
      nextEdges,
    );
  }
  const pruned = pruneOrphanTips(nextNodes, nextEdges);
  return { nodes: pruned.nodes, edges: pruned.edges };
}

const tipTop = mk("tipTop", "TIP", 200, 40);
const tipBot = mk("tipBot", "TIP", 520, 200);
const freeWire: Edge = {
  id: "tipTopt-tipBott",
  type: "schematic",
  source: "tipTop",
  sourceHandle: "t",
  target: "tipBot",
  targetHandle: "t",
  data: { waypoints: [{ x: 200, y: 200 }] },
};
const extended = extendSourceTip(
  [c1, tipTop, tipBot],
  [freeWire],
  "tipBot",
  "n3",
  "a",
  [{ x: 520, y: 207 }],
);
// The wire must survive: tipTop should still exist, one edge tipTop → C1.a.
if (!extended.nodes.some((n) => n.id === "tipTop")) {
  console.error("FAIL: extending one tip must NOT delete the other tip", extended.nodes);
  process.exit(1);
}
if (extended.edges.length !== 1) {
  console.error("FAIL: expected exactly one edge after extend", extended.edges);
  process.exit(1);
}
const ee = extended.edges[0]!;
if (
  !(
    (ee.source === "tipTop" && ee.target === "n3" && ee.targetHandle === "a") ||
    (ee.target === "tipTop" && ee.source === "n3" && ee.sourceHandle === "a")
  )
) {
  console.error("FAIL: extended edge should connect tipTop ↔ C1.a", ee);
  process.exit(1);
}

console.log("PASS tip extend → pin connect + netlist + tip→tip survives");
