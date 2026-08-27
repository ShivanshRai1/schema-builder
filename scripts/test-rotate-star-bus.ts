/**
 * Reproduce the leftover stubs the user still sees after rotate/move:
 * - star bus (V/R/C all into one tip, no tip↔tip rail)
 * - dangling vertical tick on the bus after R rotates away
 * - junction must slide under R's pin
 */
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

function freeTipCount(nodes: Node<ComponentData>[], edges: Edge[]): number {
  const deg = new Map<string, number>();
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
  }
  return nodes.filter((n) => n.data.kind === "TIP" && (deg.get(n.id) ?? 0) === 1).length;
}

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

// --- Star topology: V, R, C all pin↔same tip (no tip↔tip rail) ---
const busY = 120;
const starNodes: Node<ComponentData>[] = [
  node("v", "V", 40, 180),
  node("r", "R", 300, 40),
  node("c", "C", 520, 80),
  node("g", "GND", 300, 360),
  node("jt", "TIP", 340, busY - 4),
];
const starEdges: Edge[] = [
  edge("v-j", "v", "p", "jt", "t"),
  edge("r-j", "r", "a", "jt", "t"),
  edge("c-j", "jt", "t", "c", "a"),
  edge("c-g", "c", "b", "g", "g"),
  edge("v-g", "v", "n", "g", "g"),
];

const before = extractNets(starNodes, starEdges);
const once = rotateR(starNodes, starEdges, 1);
const after = extractNets(once.nodes, once.edges);
if (before.netOf("v", "p") !== after.netOf("r", "a")) {
  throw new Error("star rotate broke V–R net");
}
if (before.netOf("r", "a") !== after.netOf("c", "a")) {
  throw new Error("star rotate broke R–C net");
}

const jt = once.nodes.find((n) => n.id === "jt");
if (!jt) throw new Error("star junction tip disappeared");
const jtPin = pinWorldPoint(jt, "t")!;
const rPin = pinWorldPoint(once.nodes.find((n) => n.id === "r")!, "a")!;
if (Math.abs(jtPin.x - rPin.x) > 20) {
  throw new Error(
    `star junction must slide under R (tip.x=${jtPin.x}, pin.x=${rPin.x})`,
  );
}
if (Math.abs(jtPin.y - busY) > 2) {
  throw new Error(`star junction must stay on bus Y (y=${jtPin.y})`);
}

const marks = findWireJunctions(once.nodes, once.edges);
if (marks.crossings.length) {
  throw new Error(`star rotate hollow crossings: ${JSON.stringify(marks.crossings)}`);
}
if (freeTipCount(once.nodes, once.edges) > 0) {
  throw new Error("star rotate left free tip stubs");
}

// --- Leftover dangling tick on bus (tip↔tip stub) must be pruned ---
const junkNodes: Node<ComponentData>[] = [
  ...starNodes,
  node("stub", "TIP", 340, busY - 40),
];
const junkEdges: Edge[] = [
  ...starEdges,
  edge("tick", "jt", "t", "stub", "t"),
];
const cleaned = finalizeConnectedPartMove(junkNodes, junkEdges, new Set(["r"]));
if (cleaned.nodes.some((n) => n.id === "stub")) {
  throw new Error("dangling bus tick tip must be pruned after finalize");
}
if (cleaned.edges.some((e) => e.id === "tick")) {
  throw new Error("dangling bus tick edge must be pruned after finalize");
}

// --- Rapid star rotates stay clean ---
const rapid = rotateR(starNodes, starEdges, 4);
if (findWireJunctions(rapid.nodes, rapid.edges).crossings.length) {
  throw new Error("rapid star rotate produced hollow crossings");
}
if (freeTipCount(rapid.nodes, rapid.edges) > 0) {
  throw new Error("rapid star rotate left free tip stubs");
}
const jt4 = pinWorldPoint(rapid.nodes.find((n) => n.id === "jt")!, "t")!;
const r4 = pinWorldPoint(rapid.nodes.find((n) => n.id === "r")!, "a")!;
if (Math.abs(jt4.x - r4.x) > 24) {
  throw new Error(`after 4× rotate tip not under R (tip.x=${jt4.x}, pin.x=${r4.x})`);
}

// Branch from R to tip should be a short clean run (no long upward stub).
const rj = rapid.edges.find((e) => e.id === "r-j")!;
const rjPoly = computeEdgePolyline(rapid.nodes, rj);
const minY = Math.min(...rjPoly.map((p) => p.y));
if (minY < r4.y - 8) {
  throw new Error("R branch must not stick upward above the pin");
}

console.log("PASS star junction slides under R after rotate");
console.log("PASS star nets survive rotate");
console.log("PASS dangling bus tick pruned");
console.log("PASS rapid star rotate stays clean");
