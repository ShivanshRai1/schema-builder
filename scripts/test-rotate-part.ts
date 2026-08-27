import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import { nextRotation } from "../src/model/rotation";
import { extractNets } from "../src/netlist/nets";
import { findWireJunctions } from "../src/wiring/junctions";
import { computeEdgePolyline } from "../src/wiring/wireGeometry";
import { pinWorldPoint } from "../src/wiring/pinGeometry";
import { finalizeConnectedPartMove } from "../src/wiring/wireMove";

const node = (
  id: string,
  kind: "V" | "R" | "C" | "GND" | "TIP",
  x: number,
  y: number,
  rotation = 0,
): Node<ComponentData> => ({
  id,
  type: "component",
  position: { x, y },
  data: {
    kind,
    refdes: kind === "GND" || kind === "TIP" ? "" : `${kind}1`,
    params: kind === "TIP" ? {} : defaultParams(kind),
    rotation: rotation as 0 | 90 | 180 | 270,
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

// Top horizontal bus with T-junctions — similar to V-R-C layout after edits.
const busY = 120;
const busNodes: Node<ComponentData>[] = [
  node("v", "V", 40, 180),
  node("r", "R", 320, 80),
  node("c", "C", 520, 80),
  node("g", "GND", 320, 360),
  node("jt", "TIP", 360, busY - 4),
  node("tl", "TIP", 120, busY - 4),
  node("tr", "TIP", 560, busY - 4),
];
const busEdges: Edge[] = [
  edge("l-j", "tl", "t", "jt", "t"),
  edge("j-r", "j-rail", "jt", "t", "tr", "t"),
  edge("v-l", "v", "p", "tl", "t"),
  edge("r-j", "r", "a", "jt", "t"),
  edge("j-c", "jt", "t", "c", "a"),
  edge("c-g", "c", "b", "g", "g"),
  edge("v-g", "v", "n", "g", "g"),
];
// Fix edge id typo
busEdges[1] = edge("j-rail", "jt", "t", "tr", "t");

function rotateR(nodes: Node<ComponentData>[], edges: Edge[], steps: number) {
  let ns = nodes;
  let es = edges;
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

const before = extractNets(busNodes, busEdges);
const { nodes: afterNodes, edges: afterEdges } = rotateR(busNodes, busEdges, 1);
const after = extractNets(afterNodes, afterEdges);

if (before.netOf("v", "p") !== after.netOf("v", "p")) {
  throw new Error("rotation changed V+ net");
}
if (before.netOf("r", "a") !== after.netOf("c", "a")) {
  throw new Error("rotation broke bus net continuity");
}

const jt = afterNodes.find((n) => n.id === "jt")!;
const jtPin = pinWorldPoint(jt, "t")!;
const rPin = pinWorldPoint(afterNodes.find((n) => n.id === "r")!, "a")!;
if (Math.abs(jtPin.x - rPin.x) > 24) {
  throw new Error(
    `after rotate, junction tip must sit under R pin (tip.x=${jtPin.x}, pin.x=${rPin.x})`,
  );
}

const rj = afterEdges.find((e) => e.id === "r-j")!;
const rjPoly = computeEdgePolyline(afterNodes, rj);
const rjWps = (rj.data as { waypoints?: { x: number; y: number }[] }).waypoints ?? [];
if (rjWps.length) {
  throw new Error("branch to junction must not keep stale waypoints after rotate");
}

// No free tip stub dangling off R.
const freeOnR = afterEdges.filter((e) => {
  if (e.source !== "r" && e.target !== "r") return false;
  const other = e.source === "r" ? e.target : e.source;
  const otherNode = afterNodes.find((n) => n.id === other);
  if (otherNode?.data.kind !== "TIP") return false;
  const deg = afterEdges.filter((x) => x.source === other || x.target === other).length;
  return deg === 1;
});
if (freeOnR.length) {
  throw new Error("rotation left free tip stub on R");
}

const marks = findWireJunctions(afterNodes, afterEdges);
if (marks.crossings.length) {
  throw new Error(
    `rotation produced hollow crossings: ${marks.crossings.map((p) => `${p.x},${p.y}`).join("; ")}`,
  );
}

console.log("PASS rotate keeps bus nets");
console.log("PASS junction tip follows rotated R pin");
console.log("PASS no stale branch waypoints after rotate");
console.log("PASS no hollow crossings after rotate");
