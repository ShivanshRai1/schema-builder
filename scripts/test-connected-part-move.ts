import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import { extractNets } from "../src/netlist/nets";
import { computeEdgePolyline } from "../src/wiring/wireGeometry";
import { pinWorldPoint } from "../src/wiring/pinGeometry";
import {
  finalizeConnectedPartMove,
  planConnectedPartMove,
} from "../src/wiring/wireMove";

const node = (
  id: string,
  kind: "V" | "R" | "C" | "GND" | "TIP",
  x: number,
  y: number,
): Node<ComponentData> => ({
  id,
  type: "component",
  position: { x, y },
  data: {
    kind,
    refdes: kind === "GND" || kind === "TIP" ? "" : `${kind}1`,
    params: kind === "TIP" ? {} : defaultParams(kind),
  },
  ...(kind === "TIP"
    ? { style: { width: 8, height: 8 }, measured: { width: 8, height: 8 } }
    : { measured: { width: 92, height: 54 } }),
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

const nodes: Node<ComponentData>[] = [
  node("v", "V", 40, 180),
  node("r", "R", 280, 90),
  node("c", "C", 540, 180),
  node("g", "GND", 280, 360),
];
const edges: Edge[] = [
  edge("vr", "v", "p", "r", "a", [
    { x: 120, y: 100 },
    { x: 200, y: 100 },
  ]),
  edge("rc", "r", "b", "c", "a"),
  edge("cg", "c", "b", "g", "g"),
  edge("vg", "v", "n", "g", "g"),
];

const beforeNets = extractNets(nodes, edges);
const untouchedBefore = computeEdgePolyline(nodes, edges[2]!);
const attachedBefore = computeEdgePolyline(nodes, edges[0]!);
const moved = nodes.map((n) =>
  n.id === "r" ? { ...n, position: { x: n.position.x + 96, y: n.position.y + 64 } } : n,
);
const afterNets = extractNets(moved, edges);
const untouchedAfter = computeEdgePolyline(moved, edges[2]!);
const attachedAfter = computeEdgePolyline(moved, edges[0]!);

if (beforeNets.netOf("v", "p") !== afterNets.netOf("v", "p")) {
  throw new Error("moving a part changed electrical connectivity");
}
if (JSON.stringify(untouchedBefore) !== JSON.stringify(untouchedAfter)) {
  throw new Error("moving R changed an unrelated C-GND wire");
}
if (JSON.stringify(attachedBefore) === JSON.stringify(attachedAfter)) {
  throw new Error("wire attached to moved R did not follow its pin");
}

const plan = planConnectedPartMove(nodes, edges, "r");
if (!plan) throw new Error("expected move plan for R");
if (!plan.moveIds.includes("r")) throw new Error("plan must include R");
if (!plan.clearWaypointEdgeIds.includes("vr") || !plan.clearWaypointEdgeIds.includes("rc")) {
  throw new Error("pin-pin wires attached to R must clear stale waypoints");
}

const cleared = edges.map((e) =>
  plan.clearWaypointEdgeIds.includes(e.id)
    ? { ...e, data: { waypoints: [] } }
    : e,
);
const finalized = finalizeConnectedPartMove(moved, cleared, new Set(["r"]));
const vr = finalized.edges.find((e) => e.id === "vr")!;
const wps = (vr.data as { waypoints?: { x: number; y: number }[] }).waypoints ?? [];
if (wps.length) {
  throw new Error("autoroute after move should clear stale waypoints on pin-pin wires");
}
const poly = computeEdgePolyline(finalized.nodes, vr);
const rPin = pinWorldPoint(finalized.nodes.find((n) => n.id === "r")!, "a")!;
const end = poly[poly.length - 1]!;
if (Math.hypot(end.x - rPin.x, end.y - rPin.y) > 0.5) {
  throw new Error("autoroute after move should still reach R pin");
}
const nearR = poly[poly.length - 2]!;
if (Math.abs(nearR.y - rPin.y) > 16 && Math.abs(nearR.x - rPin.x) > 16) {
  throw new Error("autoroute should approach R on its pin row or column");
}

// Short free TIP stub on R must be dropped at move start — not ridden.
const tipAt = pinWorldPoint(nodes.find((n) => n.id === "r")!, "a")!;
const withStub: Node<ComponentData>[] = [
  ...nodes,
  node("tip", "TIP", tipAt.x - 24, tipAt.y - 4),
];
const withStubEdges: Edge[] = [
  ...edges,
  edge("stub", "r", "a", "tip", "t"),
];
const stubPlan = planConnectedPartMove(withStub, withStubEdges, "r");
if (stubPlan?.moveIds.includes("tip")) {
  throw new Error("short free TIP stub must not ride with the part");
}
if (!stubPlan?.dropStubTipIds.includes("tip") || !stubPlan.dropStubEdgeIds.includes("stub")) {
  throw new Error("short free TIP stub must be dropped at move start");
}

// T-junction on a horizontal tip↔tip bus: moving R must slide the junction
// tip along the rail — not leave a stranded stub at the old X.
const busY = 207;
const tipX = 326;
const busNodes: Node<ComponentData>[] = [
  node("r2", "R", 280, 90),
  node("jt", "TIP", tipX, busY - 4),
  node("tl", "TIP", 100, busY - 4),
  node("tr", "TIP", 500, busY - 4),
];
const busEdges: Edge[] = [
  edge("l-j", "tl", "t", "jt", "t"),
  edge("j-r", "jt", "t", "tr", "t"),
  edge("r-jt", "r2", "b", "jt", "t"),
];
const r2Moved = busNodes.map((n) =>
  n.id === "r2" ? { ...n, position: { x: n.position.x + 80, y: n.position.y } } : n,
);
const busBefore = extractNets(busNodes, busEdges);
const busFinal = finalizeConnectedPartMove(r2Moved, busEdges, new Set(["r2"]));
const busAfter = extractNets(busFinal.nodes, busFinal.edges);
if (busBefore.netOf("r2", "b") !== busAfter.netOf("r2", "b")) {
  throw new Error("T-junction move changed net connectivity");
}
if (busBefore.netOf("tl", "t") !== busAfter.netOf("tr", "t")) {
  throw new Error("bus halves must stay on the same net after tip slide");
}
const jt = busFinal.nodes.find((n) => n.id === "jt");
if (!jt) throw new Error("junction tip should remain after move");
const jtPin = pinWorldPoint(jt, "t")!;
const r2Pin = pinWorldPoint(busFinal.nodes.find((n) => n.id === "r2")!, "b")!;
// Tip projects onto the rail near the pin's outward stub (right pin → +x).
if (Math.abs(jtPin.x - r2Pin.x) > 24) {
  throw new Error(
    `junction tip must slide near moved pin (tip.x=${jtPin.x}, pin.x=${r2Pin.x})`,
  );
}
if (Math.abs(jtPin.x - tipX) < 8) {
  throw new Error("junction tip must leave the old bus X when the part moves");
}
if (Math.abs(jtPin.y - busY) > 1) {
  throw new Error("junction tip must stay on the bus Y");
}
const jtDeg = busFinal.edges.filter(
  (e) => e.source === jt.id || e.target === jt.id,
).length;
if (jtDeg < 3) {
  throw new Error(`junction tip should remain a T (deg=${jtDeg})`);
}
const stubOnR = busFinal.edges.filter((e) => {
  if (e.source !== "r2" && e.target !== "r2") return false;
  const other = e.source === "r2" ? e.target : e.source;
  const otherNode = busFinal.nodes.find((n) => n.id === other);
  if (otherNode?.data.kind !== "TIP") return false;
  const tipDeg = busFinal.edges.filter(
    (x) => x.source === other || x.target === other,
  ).length;
  return tipDeg === 1;
});
if (stubOnR.length) {
  throw new Error("move finalize must not leave free tip stubs on the moved part");
}

console.log("PASS connected part move only redraws attached wires");
console.log("PASS autoroute after move approaches moved pin cleanly");
console.log("PASS short free tip stubs are dropped at move start");
console.log("PASS T-junction tip slides under moved pin (no stranded bus stub)");
