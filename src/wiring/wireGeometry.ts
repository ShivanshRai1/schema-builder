import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import {
  orthogonalPolyline,
  outwardStub,
  pinAwareOrthoPath,
  routeWirePoints,
  snapCoord,
  snapPoint,
  type PinSide,
  type Point,
} from "./orthogonal";
import { pinWorldPoint, pinWorldSide } from "./pinGeometry";

const STUB = 16;

/** Pin↔TIP: route toward the tip without backtracking out of the pin. */
export function routePinToTipPoints(
  pinPt: Point,
  tipPt: Point,
  pinSide: PinSide,
  waypoints: Point[],
): Point[] {
  if (waypoints.length) {
    return orthogonalPolyline([pinPt, ...waypoints, tipPt]);
  }
  if (Math.abs(pinPt.x - tipPt.x) < 0.5 || Math.abs(pinPt.y - tipPt.y) < 0.5) {
    return orthogonalPolyline([pinPt, tipPt]);
  }
  const exit = outwardStub(pinPt, pinSide, STUB);
  const exitAway =
    Math.hypot(exit.x - tipPt.x, exit.y - tipPt.y) >
    Math.hypot(pinPt.x - tipPt.x, pinPt.y - tipPt.y) + 4;
  if (exitAway) {
    // Tip is behind the pin exit — do NOT horizontal-first through the body.
    return orthogonalPolyline(pinAwareOrthoPath(pinPt, tipPt, pinSide, null));
  }
  return orthogonalPolyline([pinPt, exit, tipPt]);
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.01) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

/** Full rendered polyline for an edge (matches SchematicWireEdge). */
export function computeEdgePolyline(
  nodes: Node<ComponentData>[],
  edge: Edge,
): Point[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const src = byId.get(edge.source);
  const tgt = byId.get(edge.target);
  if (!src || !tgt || !edge.sourceHandle || !edge.targetHandle) return [];

  const start = pinWorldPoint(src, edge.sourceHandle);
  const end = pinWorldPoint(tgt, edge.targetHandle);
  if (!start || !end) return [];

  const waypoints =
    ((edge.data as { waypoints?: Point[] } | undefined)?.waypoints) ?? [];
  const srcIsTip = src.data.kind === "TIP";
  const tgtIsTip = tgt.data.kind === "TIP";
  const directPath = Boolean(
    (edge.data as { directPath?: boolean } | undefined)?.directPath,
  );

  // Baked geometry (e.g. Drag-detach freeze / Move rubber-band): draw exactly
  // start→waypoints→end. Empty waypoints → pin-aware single L (not blind
  // horizontal-first — that ran through parts after Move).
  // Must run before tip routing — otherwise routePinToTipPoints re-adds stubs on
  // top of an already-complete path and wires look doubled / distorted.
  if (directPath) {
    if (waypoints.length) {
      return orthogonalPolyline([start, ...waypoints, end]);
    }
    const srcSide = srcIsTip
      ? null
      : pinWorldSide(src, edge.sourceHandle);
    const tgtSide = tgtIsTip
      ? null
      : pinWorldSide(tgt, edge.targetHandle);
    if (srcIsTip && tgtIsTip) {
      return orthogonalPolyline(pinAwareOrthoPath(start, end));
    }
    if (srcIsTip !== tgtIsTip) {
      return orthogonalPolyline(
        pinAwareOrthoPath(
          start,
          end,
          srcIsTip ? null : srcSide,
          tgtIsTip ? null : tgtSide,
        ),
      );
    }
    return orthogonalPolyline(
      pinAwareOrthoPath(start, end, srcSide, tgtSide),
    );
  }

  // Pin↔TIP: route toward the junction/free end (rotation-safe). TIP↔TIP keeps
  // authored bends. Pin↔pin uses stub-aware routing below.
  if (srcIsTip || tgtIsTip) {
    if (srcIsTip && tgtIsTip) {
      return orthogonalPolyline(
        waypoints.length ? [start, ...waypoints, end] : [start, end],
      );
    }
    const pinIsSource = !srcIsTip;
    const pinNode = pinIsSource ? src : tgt;
    const pinHandle = pinIsSource ? edge.sourceHandle : edge.targetHandle;
    const pinSide = pinWorldSide(pinNode, pinHandle) ?? "left";
    const pinPt = pinIsSource ? start : end;
    const tipPt = pinIsSource ? end : start;
    const core = routePinToTipPoints(pinPt, tipPt, pinSide, waypoints);
    return pinIsSource ? core : core.slice().reverse();
  }

  const sourceSide = pinWorldSide(src, edge.sourceHandle) ?? "left";
  const targetSide = pinWorldSide(tgt, edge.targetHandle) ?? "right";
  // User-clicked bends: pin → bends → pin directly (no auto stubs — those
  // jogged off-grid and fought the preview the user saw while drawing).
  if (waypoints.length > 0) {
    return orthogonalPolyline([start, ...waypoints, end]);
  }
  return routeWirePoints(start, end, waypoints, sourceSide, targetSide, STUB);
}

/** Stored waypoints = interior bends (exclude pin + stub at each end). */
export function polylineToWaypoints(polyline: Point[]): Point[] {
  if (polyline.length <= 3) return [];
  if (polyline.length === 4) {
    // [pin, a, b, pin] after nub peel — keep the elbow when the path turns,
    // but leave collinear stub↔stub runs empty so autoroute can rebuild stubs.
    const p0 = polyline[0]!;
    const a = polyline[1]!;
    const b = polyline[2]!;
    const p3 = polyline[3]!;
    const cross = (u: Point, v: Point, w: Point) =>
      (v.x - u.x) * (w.y - v.y) - (v.y - u.y) * (w.x - v.x);
    if (Math.abs(cross(p0, a, b)) <= 1 && Math.abs(cross(a, b, p3)) <= 1) {
      return [];
    }
    return [a, b];
  }
  return polyline.slice(2, -2);
}

/** Interior of an authored path [start, …bends, end] — no pin-stub slicing. */
export function polylineToStoredWaypoints(
  nodes: Node<ComponentData>[],
  edge: Edge,
  polyline: Point[],
): Point[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const touchesTip =
    byId.get(edge.source)?.data.kind === "TIP" ||
    byId.get(edge.target)?.data.kind === "TIP";
  if (touchesTip) {
    if (polyline.length <= 2) return [];
    return polyline.slice(1, -1);
  }
  return polylineToWaypoints(polyline);
}

export type WireDragHit =
  | { kind: "corner"; polyIndex: number }
  | { kind: "segment"; segIndex: number };

const CORNER_TOL = 14;
const SEG_TOL = 16;

export function hitTestWirePolyline(
  polyline: Point[],
  cursor: Point,
  opts?: { tipWire?: boolean },
): WireDragHit | null {
  if (polyline.length < 2) return null;

  const cornerLo = opts?.tipWire ? 1 : 2;
  const cornerHi = opts?.tipWire ? polyline.length - 2 : polyline.length - 3;

  let bestCorner: { i: number; d: number } | null = null;
  if (cornerHi >= cornerLo) {
    for (let i = cornerLo; i <= cornerHi; i++) {
      const d = Math.hypot(cursor.x - polyline[i]!.x, cursor.y - polyline[i]!.y);
      if (d <= CORNER_TOL && (!bestCorner || d < bestCorner.d)) {
        bestCorner = { i, d };
      }
    }
  }
  if (bestCorner) return { kind: "corner", polyIndex: bestCorner.i };

  let bestSeg: { i: number; d: number } | null = null;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = distToSegment(cursor, polyline[i]!, polyline[i + 1]!);
    if (d <= SEG_TOL && (!bestSeg || d < bestSeg.d)) {
      bestSeg = { i, d };
    }
  }
  if (bestSeg) return { kind: "segment", segIndex: bestSeg.i };
  return null;
}

function isHorizontal(a: Point, b: Point): boolean {
  return Math.abs(a.y - b.y) < 0.5;
}

/** Drag an interior corner to a grid-snapped cursor. */
export function dragWireCorner(
  polyline: Point[],
  polyIndex: number,
  cursor: Point,
  grid = STUB,
): Point[] {
  const next = polyline.map((p) => ({ ...p }));
  next[polyIndex] = snapPoint(cursor, grid);
  return orthogonalPolyline(next);
}

/** LTspice-style segment drag: shift a H or V run perpendicular (adds dogleg). */
export function dragWireSegment(
  polyline: Point[],
  segIndex: number,
  cursor: Point,
  grid = STUB,
): Point[] {
  const p = polyline[segIndex]!;
  const q = polyline[segIndex + 1]!;
  if (!p || !q) return polyline;

  if (isHorizontal(p, q)) {
    const y = snapCoord(cursor.y, grid);
    if (Math.abs(y - p.y) < 0.5) return polyline;
    const head = polyline.slice(0, segIndex);
    const tail = polyline.slice(segIndex + 2);
    return orthogonalPolyline([
      ...head,
      p,
      { x: p.x, y },
      { x: q.x, y },
      q,
      ...tail,
    ]);
  }

  const x = snapCoord(cursor.x, grid);
  if (Math.abs(x - p.x) < 0.5) return polyline;
  const head = polyline.slice(0, segIndex);
  const tail = polyline.slice(segIndex + 2);
  return orthogonalPolyline([
    ...head,
    p,
    { x, y: p.y },
    { x, y: q.y },
    q,
    ...tail,
  ]);
}

export function applyWireDrag(
  polyline: Point[],
  hit: WireDragHit,
  cursor: Point,
  grid = STUB,
): Point[] {
  if (hit.kind === "corner") {
    return dragWireCorner(polyline, hit.polyIndex, cursor, grid);
  }
  return dragWireSegment(polyline, hit.segIndex, cursor, grid);
}

/**
 * Returns the closest point on the polyline to `p`, snapped to `grid`.
 * Used when starting a branch wire from a click on an existing wire.
 */
export function closestPointOnPolyline(pts: Point[], p: Point, grid: number): Point {
  let best: Point = pts[0]!;
  let bestDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq < 0.01 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < bestDist) {
      bestDist = d;
      // snap to the axis that is locked (H seg → snap x only, V seg → snap y only)
      if (Math.abs(dy) < 0.5) {
        best = { x: snapCoord(cx, grid), y: a.y };
      } else {
        best = { x: a.x, y: snapCoord(cy, grid) };
      }
    }
  }
  return best;
}

/** Exact closest point on a polyline (no grid rounding — for pin↔wire snap). */
export function closestPointOnPolylineRaw(pts: Point[], p: Point): Point {
  let best: Point = pts[0]!;
  let bestDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq < 0.01 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < bestDist) {
      bestDist = d;
      best = { x: cx, y: cy };
    }
  }
  return best;
}

/** Raw (unsnapped) distance from point to polyline. */
export function distToPolyline(pts: Point[], p: Point): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    best = Math.min(best, distToSegment(p, pts[i]!, pts[i + 1]!));
  }
  return best;
}

export type WireHit = {
  edgeId: string;
  point: Point;
  dist: number;
};

/**
 * Nearest existing wire under the cursor (for ending a draft on a mid-wire
 * join, including when the rail runs under a part that would steal the click).
 */
export function findNearestWireHit(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  cursor: Point,
  maxDist: number,
  grid: number,
  excludeEdgeIds?: Set<string>,
): WireHit | null {
  let best: WireHit | null = null;
  let bestLen = Infinity;
  for (const edge of edges) {
    if (excludeEdgeIds?.has(edge.id)) continue;
    const poly = computeEdgePolyline(nodes, edge);
    if (poly.length < 2) continue;
    const d = distToPolyline(poly, cursor);
    if (d > maxDist) continue;
    let len = 0;
    for (let i = 0; i < poly.length - 1; i++) {
      len += Math.hypot(poly[i + 1]!.x - poly[i]!.x, poly[i + 1]!.y - poly[i]!.y);
    }
    // At a hop/crossing both wires sit under the cursor (same dist). Prefer the
    // shorter edge so a tiny stub is scissors-selected instead of the long rail.
    if (best && d > best.dist + 0.5) continue;
    if (best && Math.abs(d - best.dist) <= 0.5 && len >= bestLen - 0.5) continue;
    best = {
      edgeId: edge.id,
      point: closestPointOnPolyline(poly, cursor, grid),
      dist: d,
    };
    bestLen = len;
  }
  return best;
}

export type { PinSide };
