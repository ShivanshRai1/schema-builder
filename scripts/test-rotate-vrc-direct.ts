import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import { nextRotation } from "../src/model/rotation";
import { findWireJunctions } from "../src/wiring/junctions";
import { computeEdgePolyline } from "../src/wiring/wireGeometry";
import { pinWorldPoint } from "../src/wiring/pinGeometry";
import { finalizeConnectedPartMove } from "../src/wiring/wireMove";

const mk = (
  id: string,
  kind: "V" | "R" | "C" | "GND",
  x: number,
  y: number,
  rot = 0,
): Node<ComponentData> => ({
  id,
  type: "component",
  position: { x, y },
  data: {
    kind,
    refdes: kind === "GND" ? "" : `${kind}1`,
    params: defaultParams(kind),
    rotation: rot as 0 | 90 | 180 | 270,
  },
  measured: { width: 92, height: 54 },
});

const wire = (
  id: string,
  s: string,
  sh: string,
  t: string,
  th: string,
): Edge => ({
  id,
  type: "schematic",
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
  data: {},
});

const nodes: Node<ComponentData>[] = [
  mk("v", "V", 40, 220),
  mk("r", "R", 300, 80),
  mk("c", "C", 520, 80),
  mk("g", "GND", 300, 360),
];
const edges: Edge[] = [
  wire("vp-ra", "v", "p", "r", "a"),
  wire("rb-ca", "r", "b", "c", "a"),
  wire("cb-g", "c", "b", "g", "g"),
  wire("vn-g", "v", "n", "g", "g"),
];

function polyHasBadBacktrack(poly: { x: number; y: number }[]): boolean {
  // Skip pin stubs at each end; only flag interior U-turns.
  const lo = 2;
  const hi = poly.length - 3;
  for (let i = lo; i <= hi; i++) {
    const a = poly[i - 1]!;
    const b = poly[i]!;
    const c = poly[i + 1]!;
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const bc = { x: c.x - b.x, y: c.y - b.y };
    if (Math.hypot(ab.x, ab.y) < 0.5 || Math.hypot(bc.x, bc.y) < 0.5) continue;
    if (ab.x * bc.x + ab.y * bc.y < -0.5) return true;
  }
  return false;
}

function pinGap(ns: Node<ComponentData>[], e: Edge): number {
  const poly = computeEdgePolyline(ns, e);
  if (poly.length < 2) return 999;
  const src = ns.find((n) => n.id === e.source)!;
  const tgt = ns.find((n) => n.id === e.target)!;
  const sp = pinWorldPoint(src, e.sourceHandle!)!;
  const tp = pinWorldPoint(tgt, e.targetHandle!)!;
  return Math.max(
    Math.hypot(poly[0]!.x - sp.x, poly[0]!.y - sp.y),
    Math.hypot(poly[poly.length - 1]!.x - tp.x, poly[poly.length - 1]!.y - tp.y),
  );
}

let ns = nodes;
let es = edges;
for (const step of [1, 2, 3, 1, 2]) {
  const r = ns.find((n) => n.id === "r")!;
  const nextNodes = ns.map((n) =>
    n.id === "r"
      ? { ...n, data: { ...n.data, rotation: nextRotation(r.data.rotation) } }
      : n,
  );
  const out = finalizeConnectedPartMove(nextNodes, es, new Set(["r"]));
  ns = out.nodes;
  es = out.edges;
  for (const e of es) {
    if (e.source !== "r" && e.target !== "r") continue;
    const wps = (e.data as { waypoints?: unknown[] }).waypoints ?? [];
    if (wps.length) {
      throw new Error(`${e.id} should have empty waypoints after rotate, got ${wps.length}`);
    }
    const poly = computeEdgePolyline(ns, e);
    if (polyHasBadBacktrack(poly)) {
      throw new Error(`${e.id} backtracks after rotate: ${JSON.stringify(poly)}`);
    }
    if (pinGap(ns, e) > 1) {
      throw new Error(`${e.id} does not reach pin after rotate`);
    }
  }
  const rCross = es
    .filter((e) => e.source === "r" || e.target === "r")
    .flatMap((e) => findWireJunctions(ns, [e]).crossings);
  if (rCross.length) {
    throw new Error(`hollow crossings on R wires after rotate step ${step}`);
  }
}

const moved = finalizeConnectedPartMove(
  ns.map((n) =>
    n.id === "r" ? { ...n, position: { x: n.position.x + 64, y: n.position.y + 48 } } : n,
  ),
  es,
  new Set(["r"]),
);
for (const e of moved.edges) {
  if (e.source !== "r" && e.target !== "r") continue;
  const poly = computeEdgePolyline(moved.nodes, e);
  if (polyHasBadBacktrack(poly)) {
    throw new Error(`${e.id} backtracks after move`);
  }
}

console.log("PASS direct V-R-C-GND survives rapid rotate");
console.log("PASS no backtracking polylines after rotate/move");
console.log("PASS all wires still reach pins");
