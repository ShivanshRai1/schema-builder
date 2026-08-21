import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import { extractNets } from "../netlist/nets";
import { pinWorldPoint } from "./pinGeometry";
import { computeEdgePolyline } from "./wireGeometry";
import type { Point } from "./orthogonal";

const TOL = 3.5;
const KEY_GRID = 2;

function keyOf(p: Point): string {
  return `${Math.round(p.x / KEY_GRID) * KEY_GRID},${Math.round(p.y / KEY_GRID) * KEY_GRID}`;
}

function near(a: Point, b: Point, tol = TOL): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tol;
}

function onSegment(p: Point, a: Point, b: Point, tol = TOL): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.25) return near(p, a, tol);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  if (t < -0.02 || t > 1.02) return false;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) <= tol;
}

/** Interior of the segment (not the endpoints). */
function onInterior(p: Point, a: Point, b: Point, tol = TOL): boolean {
  if (!onSegment(p, a, b, tol)) return false;
  return !near(p, a, tol) && !near(p, b, tol);
}

function orthoCross(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const aH = Math.abs(a1.y - a2.y) < 0.6;
  const aV = Math.abs(a1.x - a2.x) < 0.6;
  const bH = Math.abs(b1.y - b2.y) < 0.6;
  const bV = Math.abs(b1.x - b2.x) < 0.6;
  if (aH && bV) {
    const y = a1.y;
    const x = b1.x;
    const xmin = Math.min(a1.x, a2.x);
    const xmax = Math.max(a1.x, a2.x);
    const ymin = Math.min(b1.y, b2.y);
    const ymax = Math.max(b1.y, b2.y);
    if (x >= xmin - 0.5 && x <= xmax + 0.5 && y >= ymin - 0.5 && y <= ymax + 0.5) {
      return { x, y };
    }
  }
  if (aV && bH) {
    const x = a1.x;
    const y = b1.y;
    const ymin = Math.min(a1.y, a2.y);
    const ymax = Math.max(a1.y, a2.y);
    const xmin = Math.min(b1.x, b2.x);
    const xmax = Math.max(b1.x, b2.x);
    if (y >= ymin - 0.5 && y <= ymax + 0.5 && x >= xmin - 0.5 && x <= xmax + 0.5) {
      return { x, y };
    }
  }
  return null;
}

export type WireMarks = {
  /** Filled square — wires are on the same net and truly join here. */
  junctions: Point[];
  /** Hollow ring — wires visually cross but are on different nets (not connected). */
  crossings: Point[];
};

/**
 * Find every point where wires meet or cross:
 * - Same net: shared TIP join or T/+ junction → filled square.
 * - Different net: wires cross visually → hollow ring so it's obvious they
 *   are NOT connected.
 * Component pins already have squares via CSS, so they are skipped for
 * junction marks but NOT for crossing marks (a crossing at a pin is still
 * useful to show).
 */
export function findWireJunctions(
  nodes: Node<ComponentData>[],
  edges: Edge[],
): WireMarks {
  // Count how many wires attach to each component pin.
  const pinWireCount = new Map<string, number>();
  const pinPoints = new Map<string, Point>();
  for (const node of nodes) {
    if (node.data.kind === "TIP") continue;
    for (const pin of COMPONENT_SPECS[node.data.kind].pins) {
      const pt = pinWorldPoint(node, pin.id);
      if (pt) {
        const k = `${node.id}:${pin.id}`;
        pinPoints.set(k, pt);
        pinWireCount.set(k, 0);
      }
    }
  }
  for (const e of edges) {
    const sk = `${e.source}:${e.sourceHandle}`;
    const tk = `${e.target}:${e.targetHandle}`;
    if (pinWireCount.has(sk)) pinWireCount.set(sk, pinWireCount.get(sk)! + 1);
    if (pinWireCount.has(tk)) pinWireCount.set(tk, pinWireCount.get(tk)! + 1);
  }

  const nets = extractNets(nodes, edges);
  const polys = edges.flatMap((e) => {
    if (!e.sourceHandle || !e.targetHandle) return [];
    const pts = computeEdgePolyline(nodes, e);
    if (pts.length < 2) return [];
    return [{ net: nets.netOf(e.source, e.sourceHandle), pts }];
  });

  const seenJ = new Set<string>();
  const seenC = new Set<string>();
  const junctions: Point[] = [];
  const crossings: Point[] = [];

  const addJ = (p: Point) => {
    const k = keyOf(p);
    if (seenJ.has(k)) return;
    seenJ.add(k);
    seenC.add(k);
    junctions.push(p);
  };

  const addC = (p: Point) => {
    const k = keyOf(p);
    if (seenJ.has(k) || seenC.has(k)) return;
    seenC.add(k);
    crossings.push(p);
  };

  // Shared TIP with 2+ edges → junction mark.
  const tipDegree = new Map<string, number>();
  for (const e of edges) {
    const bump = (id: string) => tipDegree.set(id, (tipDegree.get(id) ?? 0) + 1);
    bump(e.source);
    bump(e.target);
  }
  for (const n of nodes) {
    if (n.data.kind !== "TIP") continue;
    if ((tipDegree.get(n.id) ?? 0) < 2) continue;
    const pt = pinWorldPoint(n, "t");
    if (pt) addJ(pt);
  }

  // Component pins with 2+ wires → junction mark (e.g. GND with two wires).
  for (const [key, count] of pinWireCount) {
    if (count >= 2) {
      const pt = pinPoints.get(key);
      if (pt) addJ(pt);
    }
  }

  // Wire-pair comparisons.
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      const A = polys[i]!;
      const B = polys[j]!;
      const sameNet = A.net === B.net;

      const aEnds = [A.pts[0]!, A.pts[A.pts.length - 1]!];
      const bEnds = [B.pts[0]!, B.pts[B.pts.length - 1]!];

      // T-style: endpoint of one wire sits on the interior of the other.
      // Same net → connected junction; different net → passing (not connected).
      for (const end of aEnds) {
        for (let s = 0; s < B.pts.length - 1; s++) {
          if (onInterior(end, B.pts[s]!, B.pts[s + 1]!)) {
            if (sameNet) addJ(end);
            else addC(end);
          }
        }
      }
      for (const end of bEnds) {
        for (let s = 0; s < A.pts.length - 1; s++) {
          if (onInterior(end, A.pts[s]!, A.pts[s + 1]!)) {
            if (sameNet) addJ(end);
            else addC(end);
          }
        }
      }

      // Geometric segment crossings (true mid-segment X).
      for (let s = 0; s < A.pts.length - 1; s++) {
        for (let t = 0; t < B.pts.length - 1; t++) {
          const hit = orthoCross(A.pts[s]!, A.pts[s + 1]!, B.pts[t]!, B.pts[t + 1]!);
          if (!hit) continue;
          const onAEnd = aEnds.some((p) => near(hit, p));
          const onBEnd = bEnds.some((p) => near(hit, p));
          if (onAEnd && onBEnd) continue; // shared endpoint already at pin/tip
          // Mid-mid cross
          if (
            onInterior(hit, A.pts[s]!, A.pts[s + 1]!) &&
            onInterior(hit, B.pts[t]!, B.pts[t + 1]!)
          ) {
            if (sameNet) addJ(hit);
            else addC(hit);
            continue;
          }
          // Endpoint of one on interior of the other (caught above too, but
          // orthoCross can also hit exactly at the tip).
          if (onAEnd && onInterior(hit, B.pts[t]!, B.pts[t + 1]!)) {
            if (sameNet) addJ(hit);
            else addC(hit);
          } else if (onBEnd && onInterior(hit, A.pts[s]!, A.pts[s + 1]!)) {
            if (sameNet) addJ(hit);
            else addC(hit);
          }
        }
      }
    }
  }

  return { junctions, crossings };
}
