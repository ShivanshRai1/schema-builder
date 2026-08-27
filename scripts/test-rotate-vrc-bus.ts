import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import { nextRotation } from "../src/model/rotation";
import { extractNets } from "../src/netlist/nets";
import { findWireJunctions } from "../src/wiring/junctions";
import { computeEdgePolyline, routePinToTipPoints } from "../src/wiring/wireGeometry";
import { pinWorldPoint, pinWorldSide } from "../src/wiring/pinGeometry";
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

// V — bus — C with R tap on bus (matches user's V-R-C layout).
const busY = 120;
const jx = 360;
const nodes0: Node<ComponentData>[] = [
  node("v", "V", 40, 180),
  node("r", "R", 320, 80),
  node("c", "C", 520, 80),
  node("g", "GND", 320, 360),
  node("jt", "TIP", jx, busY - 4),
  node("tl", "TIP", 120, busY - 4),
  node("tr", "TIP", 560, busY - 4),
];
const edges0: Edge[] = [
  edge("bus-l", "tl", "t", "jt", "t"),
  edge("bus-r", "jt", "t", "tr", "t"),
  edge("v-bus", "v", "p", "tl", "t"),
  edge("r-j", "r", "a", "jt", "t"),
  edge("c-bus", "jt", "t", "c", "a"),
  edge("c-g", "c", "b", "g", "g"),
  edge("v-g", "v", "n", "g", "g"),
];

function rotateChain(
  ns: Node<ComponentData>[],
  es: Edge[],
  steps: number,
) {
  let nodes = ns;
  let edges = es;
  for (let i = 0; i < steps; i++) {
    const r = nodes.find((n) => n.id === "r")!;
    const nextNodes = nodes.map((n) =>
      n.id === "r"
        ? { ...n, data: { ...n.data, rotation: nextRotation(r.data.rotation) } }
        : n,
    );
    const out = finalizeConnectedPartMove(nextNodes, edges, new Set(["r"]));
    nodes = out.nodes;
    edges = out.edges;
  }
  return { nodes, edges };
}

// Pin-tip route must not backtrack upward when tip is below a top pin.
const r90 = nodes0.map((n) =>
  n.id === "r" ? { ...n, data: { ...n.data, rotation: 90 as const } } : n,
);
const rPin = pinWorldPoint(r90.find((n) => n.id === "r")!, "a")!;
const tipBelow = { x: rPin.x, y: busY };
const side = pinWorldSide(r90.find((n) => n.id === "r")!, "a")!;
const branchPoly = routePinToTipPoints(rPin, tipBelow, side!, []);
const goesUp =
  branchPoly.length >= 2 &&
  branchPoly.some((p, i) => i > 0 && p.y < rPin.y - 1);
if (goesUp) {
  throw new Error("pin-tip route must not run upward when tip is below top pin");
}

const once = rotateChain(nodes0, edges0, 1);
const jt = once.nodes.find((n) => n.id === "jt")!;
const jtPin = pinWorldPoint(jt, "t")!;
const rPin1 = pinWorldPoint(once.nodes.find((n) => n.id === "r")!, "a")!;
if (Math.abs(jtPin.x - rPin1.x) > 20) {
  throw new Error(
    `after 90° rotate junction must follow R pin column (tip.x=${jtPin.x}, pin.x=${rPin1.x})`,
  );
}

const rj = once.edges.find((e) => e.id === "r-j")!;
const rjPoly = computeEdgePolyline(once.nodes, rj);
if (rjPoly.some((p) => p.y < rPin1.y - 24)) {
  throw new Error("branch wire must not leave a long upward stub above rotated R");
}

const marks = findWireJunctions(once.nodes, once.edges);
if (marks.crossings.length) {
  throw new Error(`rotate produced hollow crossings: ${JSON.stringify(marks.crossings)}`);
}

// Rapid rotate + stale-edge regression (chained vs stale).
const staleOnce = rotateChain(nodes0, edges0, 1);
const r = staleOnce.nodes.find((n) => n.id === "r")!;
const staleNodes = staleOnce.nodes.map((n) =>
  n.id === "r"
    ? { ...n, data: { ...n.data, rotation: nextRotation(r.data.rotation) } }
    : n,
);
const stale = finalizeConnectedPartMove(staleNodes, edges0, new Set(["r"]));
if (!findWireJunctions(stale.nodes, stale.edges).crossings.length) {
  console.log("note: stale second rotate did not reproduce crossing in this layout");
}

const rapid = rotateChain(nodes0, edges0, 4);
const nets0 = extractNets(nodes0, edges0);
const nets4 = extractNets(rapid.nodes, rapid.edges);
if (nets0.netOf("v", "p") !== nets4.netOf("c", "a")) {
  throw new Error("rapid rotate broke bus net");
}
if (findWireJunctions(rapid.nodes, rapid.edges).crossings.length) {
  throw new Error("rapid 4× rotate produced hollow crossings");
}

console.log("PASS pin-tip routes toward bus below top pin");
console.log("PASS junction follows R after 90° rotate");
console.log("PASS no upward zombie stub above R");
console.log("PASS V-R-C bus layout stays clean on rapid rotate");
