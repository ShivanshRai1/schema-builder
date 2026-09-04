import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import { extractNets } from "../netlist/nets";
import { pinWorldPoint } from "./pinGeometry";
import { computeEdgePolyline } from "./wireGeometry";
import type { Point } from "./orthogonal";

const TOL = 3.5;
const KEY_GRID = 2;

export function wireMarkKey(p: Point): string {
  return `${Math.round(p.x / KEY_GRID) * KEY_GRID},${Math.round(p.y / KEY_GRID) * KEY_GRID}`;
}

function keyOf(p: Point): string {
  return wireMarkKey(p);
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

/**
 * Interior of the complete polyline. Unlike segment-local onInterior, this
 * includes internal vertices/corners while still excluding the two true ends.
 */
function onPolylineInterior(p: Point, pts: Point[], tol = TOL): boolean {
  if (pts.length < 2) return false;
  if (near(p, pts[0]!, tol) || near(p, pts[pts.length - 1]!, tol)) return false;
  for (let i = 0; i < pts.length - 1; i++) {
    if (onSegment(p, pts[i]!, pts[i + 1]!, tol)) return true;
  }
  return false;
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

export type JunctionMark = Point & {
  /** Shared TIP at this join, when the square comes from a tip node. */
  tipId?: string;
};

export type CrossingMark = Point & {
  /** The two edges that cross here (not electrically joined). */
  edgeIds?: [string, string];
};

export type WireMarks = {
  /** Filled square — wires are on the same net and truly join here. */
  junctions: JunctionMark[];
  /** Hollow ring — wires visually cross but are on different nets (not connected). */
  crossings: CrossingMark[];
};

function onPolyline(p: Point, pts: Point[], tol = TOL): boolean {
  if (pts.length < 2) return false;
  for (let i = 0; i < pts.length - 1; i++) {
    if (onSegment(p, pts[i]!, pts[i + 1]!, tol)) return true;
  }
  return false;
}

/** Orient polyline so it starts at `pin` (or null if neither end is the pin). */
function orientFromPin(pin: Point, pts: Point[]): Point[] | null {
  if (pts.length < 2) return null;
  if (near(pts[0]!, pin)) return pts;
  if (near(pts[pts.length - 1]!, pin)) return pts.slice().reverse();
  return null;
}

/**
 * When several wires share a pin, they often run together for a stub then
 * split (GND T on a rail). The visual join is that split — not the pin.
 */
function branchPointFromPin(pin: Point, polys: Point[][]): Point | null {
  const oriented = polys
    .map((pts) => orientFromPin(pin, pts))
    .filter((pts): pts is Point[] => !!pts);
  if (oriented.length < 2) return null;

  const a = oriented[0]!;
  const others = oriented.slice(1);
  let lastShared: Point = pin;

  for (let i = 0; i < a.length - 1; i++) {
    const s = a[i]!;
    const e = a[i + 1]!;
    const len = Math.hypot(e.x - s.x, e.y - s.y);
    const steps = Math.max(1, Math.ceil(len / 2));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const p = { x: s.x + (e.x - s.x) * t, y: s.y + (e.y - s.y) * t };
      const shared = others.every((poly) => onPolyline(p, poly));
      if (shared) lastShared = p;
      else {
        return near(lastShared, pin, TOL + 2) ? null : lastShared;
      }
    }
  }
  return near(lastShared, pin, TOL + 2) ? null : lastShared;
}

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
  const edgePolys = edges.flatMap((e) => {
    if (!e.sourceHandle || !e.targetHandle) return [];
    const pts = computeEdgePolyline(nodes, e);
    if (pts.length < 2) return [];
    return [
      {
        edge: e,
        net: nets.netOf(e.source, e.sourceHandle),
        pts,
      },
    ];
  });

  const seenJ = new Set<string>();
  const seenC = new Set<string>();
  const junctions: JunctionMark[] = [];
  const crossings: CrossingMark[] = [];

  const addJ = (p: Point, tipId?: string) => {
    const k = keyOf(p);
    if (seenJ.has(k)) return;
    // Never put a filled junction on a component pin — that reads as a pin
    // square. Multi-wire pins get their mark at the branch (below).
    for (const pt of pinPoints.values()) {
      if (near(p, pt)) return;
    }
    seenJ.add(k);
    seenC.add(k);
    junctions.push(tipId ? { ...p, tipId } : { ...p });
  };

  const addC = (p: Point, edgeIds?: [string, string]) => {
    const k = keyOf(p);
    if (seenJ.has(k) || seenC.has(k)) return;
    // Pin square (or hidden connected pin) — don't stack a hollow crossing ring.
    for (const pt of pinPoints.values()) {
      if (near(p, pt)) return;
    }
    // Any wired pin nearby — crossing is expected at a T, not an error mark.
    for (const [key, count] of pinWireCount) {
      if (count < 1) continue;
      const pt = pinPoints.get(key);
      if (pt && near(p, pt, TOL + 4)) return;
    }
    seenC.add(k);
    crossings.push(edgeIds ? { ...p, edgeIds } : { ...p });
  };

  // Shared TIP with 2+ edges → junction mark (not on a component pin).
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
    if (pt) addJ(pt, n.id);
  }

  // Multi-wire pin: mark the visual T where the shared stub splits into the
  // rail — not the pin itself (both edges end on the pin in the graph).
  for (const [key, count] of pinWireCount) {
    if (count < 2) continue;
    const pin = pinPoints.get(key);
    if (!pin) continue;
    const [nodeId, pinId] = key.split(":");
    const related = edgePolys
      .filter(
        ({ edge: e }) =>
          (e.source === nodeId && e.sourceHandle === pinId) ||
          (e.target === nodeId && e.targetHandle === pinId),
      )
      .map((x) => x.pts);
    const branch = branchPointFromPin(pin, related);
    if (branch) addJ(branch);
  }

  // Wire-pair comparisons.
  for (let i = 0; i < edgePolys.length; i++) {
    for (let j = i + 1; j < edgePolys.length; j++) {
      const A = edgePolys[i]!;
      const B = edgePolys[j]!;
      const sameNet = A.net === B.net;
      const pair: [string, string] = [A.edge.id, B.edge.id];

      const aEnds = [A.pts[0]!, A.pts[A.pts.length - 1]!];
      const bEnds = [B.pts[0]!, B.pts[B.pts.length - 1]!];

      // T-style: endpoint of one wire sits on the interior of the other.
      // Same net → connected junction; different net → passing (not connected).
      for (const end of aEnds) {
        if (onPolylineInterior(end, B.pts)) {
          if (sameNet) addJ(end);
          else addC(end, pair);
        }
      }
      for (const end of bEnds) {
        if (onPolylineInterior(end, A.pts)) {
          if (sameNet) addJ(end);
          else addC(end, pair);
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
            else addC(hit, pair);
            continue;
          }
          // Endpoint of one on interior of the other (caught above too, but
          // orthoCross can also hit exactly at the tip).
          if (onAEnd && onInterior(hit, B.pts[t]!, B.pts[t + 1]!)) {
            if (sameNet) addJ(hit);
            else addC(hit, pair);
          } else if (onBEnd && onInterior(hit, A.pts[s]!, A.pts[s + 1]!)) {
            if (sameNet) addJ(hit);
            else addC(hit, pair);
          }
        }
      }
    }
  }

  return { junctions, crossings };
}

const MARK_HIT = 11;

/** Prefer junction/crossing marks under the cursor (Delete-mode scissors). */
export function hitTestWireMark(
  marks: WireMarks,
  cursor: Point,
  radius = MARK_HIT,
):
  | { kind: "junction"; mark: JunctionMark }
  | { kind: "crossing"; mark: CrossingMark }
  | null {
  let bestJ: { mark: JunctionMark; d: number } | null = null;
  for (const mark of marks.junctions) {
    const d = Math.hypot(mark.x - cursor.x, mark.y - cursor.y);
    if (d <= radius && (!bestJ || d < bestJ.d)) bestJ = { mark, d };
  }
  let bestC: { mark: CrossingMark; d: number } | null = null;
  for (const mark of marks.crossings) {
    const d = Math.hypot(mark.x - cursor.x, mark.y - cursor.y);
    if (d <= radius && (!bestC || d < bestC.d)) bestC = { mark, d };
  }
  if (bestJ && bestC) {
    return bestJ.d <= bestC.d
      ? { kind: "junction", mark: bestJ.mark }
      : { kind: "crossing", mark: bestC.mark };
  }
  if (bestJ) return { kind: "junction", mark: bestJ.mark };
  if (bestC) return { kind: "crossing", mark: bestC.mark };
  return null;
}

const TIP_SIZE = 8;

function makeFreeTip(
  tipId: string,
  at: Point,
): Node<ComponentData> {
  return {
    id: tipId,
    type: "component",
    position: { x: at.x, y: at.y - TIP_SIZE / 2 },
    data: { kind: "TIP", refdes: "", params: {} },
    style: { width: TIP_SIZE, height: TIP_SIZE },
    selected: false,
    draggable: false,
  };
}

/**
 * Break a filled junction square: shared TIP → each wire gets its own free tip
 * at the same point (electrically open). Tip-less marks: no-op (caller may
 * fall back to deleting a wire under the mark).
 */
export function dissolveJunctionTip(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  tipId: string,
  newId: () => string,
): { nodes: Node<ComponentData>[]; edges: Edge[] } | null {
  const tip = nodes.find((n) => n.id === tipId);
  if (!tip || tip.data.kind !== "TIP") return null;
  const onTip = edges.filter((e) => e.source === tipId || e.target === tipId);
  if (onTip.length < 2) return null;

  const at = pinWorldPoint(tip, "t");
  if (!at) return null;

  const nextNodes = nodes.filter((n) => n.id !== tipId);
  const kept = edges.filter((e) => e.source !== tipId && e.target !== tipId);
  const nextEdges = [...kept];

  for (const e of onTip) {
    const freeId = newId();
    nextNodes.push(makeFreeTip(freeId, at));
    nextEdges.push(
      e.source === tipId
        ? {
            ...e,
            id: `${freeId}t-${e.target}${e.targetHandle}`,
            source: freeId,
            sourceHandle: "t",
            selected: false,
          }
        : {
            ...e,
            id: `${e.source}${e.sourceHandle}-${freeId}t`,
            target: freeId,
            targetHandle: "t",
            selected: false,
          },
    );
  }

  return { nodes: nextNodes, edges: nextEdges };
}
