import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import {
  orthogonalPolyline,
  outwardStub,
  pointsEqual,
  snapPoint,
  WIRE_GRID,
  type PinSide,
  type Point,
} from "./orthogonal";
import { pinWorldPoint, pinWorldSide } from "./pinGeometry";
import {
  closestPointOnPolyline,
  computeEdgePolyline,
  distToPolyline,
  dragWireSegment,
  polylineToStoredWaypoints,
} from "./wireGeometry";
import { collapsePassThroughTips, pruneOrphanTips } from "./tipCleanup";

const TIP_SIZE = 8;

function makeTip(
  tipId: string,
  at: Point,
  opts: { selected: boolean },
): Node<ComponentData> {
  return {
    id: tipId,
    type: "component",
    position: { x: at.x, y: at.y - TIP_SIZE / 2 },
    data: { kind: "TIP", refdes: "", params: {} },
    style: { width: TIP_SIZE, height: TIP_SIZE },
    selected: opts.selected,
    draggable: false,
  };
}

export type WireCutMoveResult = {
  nodes: Node<ComponentData>[];
  edges: Edge[];
  /** Tip ids to translate while dragging the free wire. */
  moveIds: string[];
  /** Edge that carries the moving path (tip↔tip). */
  edgeId: string;
  /** Waypoints at cut time (translated during drag). */
  baseWaypoints: Point[];
  didCut: boolean;
};

/**
 * Cut a wire off its pins/junctions so it can move as one free object.
 *
 * Always gives the wire two *exclusive* TIP ends (never share a tip with
 * another edge). That way a T-junction no longer "sticks" one end while
 * the rest of the wire tries to move.
 */
export function detachWireForMove(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  edgeId: string,
  newId: () => string,
): WireCutMoveResult | null {
  const edge = edges.find((e) => e.id === edgeId);
  if (!edge || !edge.sourceHandle || !edge.targetHandle) return null;

  const src = nodes.find((n) => n.id === edge.source);
  const tgt = nodes.find((n) => n.id === edge.target);
  if (!src || !tgt) return null;

  const polyline = computeEdgePolyline(nodes, edge);
  if (polyline.length < 2) return null;

  const start = polyline[0]!;
  const end = polyline[polyline.length - 1]!;
  const interior =
    polyline.length <= 2
      ? []
      : polyline.slice(1, -1).map((p) => snapPoint(p));

  const oldSource = edge.source;
  const oldTarget = edge.target;
  const srcIsTip = src.data.kind === "TIP";
  const tgtIsTip = tgt.data.kind === "TIP";
  const wasFree = srcIsTip && tgtIsTip;

  // Count how many edges use each endpoint (after removing this edge).
  const otherEdges = edges.filter((e) => e.id !== edgeId);
  const usage = (nodeId: string) =>
    otherEdges.reduce(
      (n, e) => n + (e.source === nodeId || e.target === nodeId ? 1 : 0),
      0,
    );

  const tipA = newId();
  const tipB = newId();

  // Drop old tips only if nothing else still needs them.
  const dropIds = new Set<string>();
  if (srcIsTip && usage(oldSource) === 0) dropIds.add(oldSource);
  if (tgtIsTip && usage(oldTarget) === 0) dropIds.add(oldTarget);

  const nextNodes: Node<ComponentData>[] = nodes
    .filter((n) => !dropIds.has(n.id))
    .map((n) => ({ ...n, selected: false as boolean }));

  nextNodes.push(makeTip(tipA, start, { selected: true }));
  nextNodes.push(makeTip(tipB, end, { selected: true }));

  const newEdge: Edge = {
    id: edgeId,
    type: "schematic",
    source: tipA,
    sourceHandle: "t",
    target: tipB,
    targetHandle: "t",
    data: { waypoints: interior },
    selected: true,
  };

  const nextEdges: Edge[] = [
    ...otherEdges.map((e) => ({ ...e, selected: false as boolean })),
    newEdge,
  ];

  return {
    nodes: nextNodes,
    edges: nextEdges,
    moveIds: [tipA, tipB],
    edgeId,
    baseWaypoints: interior.map((p) => ({ ...p })),
    // "Cut" if we peeled off pins OR split away from a shared junction tip.
    didCut: !wasFree || usage(oldSource) > 0 || usage(oldTarget) > 0,
  };
}

export function translatePoints(points: Point[], dx: number, dy: number): Point[] {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Interior corner indices on a rendered polyline (not endpoints). */
export function interiorCornerIndices(polyline: Point[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < polyline.length - 1; i++) {
    const a = polyline[i - 1]!;
    const b = polyline[i]!;
    const c = polyline[i + 1]!;
    const colinear =
      (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) ||
      (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5);
    if (!colinear) out.push(i);
  }
  return out;
}

/**
 * Corners the user can edit with bend handles.
 * Skips pin-stub elbows (index 1 / n-2 on normal pin↔pin wires) so handles
 * only appear on real route bends — not on the pin attach stubs.
 */
export function editableBendIndices(
  polyline: Point[],
  opts?: { tipWire?: boolean },
): number[] {
  const all = interiorCornerIndices(polyline);
  const tipWire = opts?.tipWire ?? false;
  const filtered = all.filter((i) => {
    // Pin↔pin routed path: [pin, stubOut, …user…, stubIn, pin]
    if (!tipWire && (i === 1 || i === polyline.length - 2)) return false;
    return true;
  });
  // One handle per location (avoid stacked yellow dots).
  const kept: number[] = [];
  const seen: Point[] = [];
  for (const i of filtered) {
    const p = polyline[i]!;
    if (seen.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < 10)) continue;
    seen.push(p);
    kept.push(i);
  }
  return kept;
}

/** True micro-jog: a short step between two longer runs — not a normal L arm. */
export function isMicroBend(polyline: Point[], cornerIndex: number): boolean {
  if (cornerIndex <= 0 || cornerIndex >= polyline.length - 1) return false;
  const a = polyline[cornerIndex - 1]!;
  const b = polyline[cornerIndex]!;
  const c = polyline[cornerIndex + 1]!;
  const lenIn = Math.hypot(b.x - a.x, b.y - a.y);
  const lenOut = Math.hypot(c.x - b.x, c.y - b.y);
  const short = Math.min(lenIn, lenOut);
  const long = Math.max(lenIn, lenOut);
  return short < 10 && long >= 16;
}

/** Collapse tiny orthogonal jogs (sub-grid "steps") into a clean path. */
export function collapseMicroBends(polyline: Point[], minLen = 10): Point[] {
  let poly = simplifyOrtho(polyline.map((p) => ({ ...p })));
  let guard = 0;
  while (guard++ < 32) {
    let shortAt = -1;
    for (let i = 0; i < poly.length - 1; i++) {
      const len = Math.hypot(poly[i + 1]!.x - poly[i]!.x, poly[i + 1]!.y - poly[i]!.y);
      if (len > 0.5 && len < minLen) {
        shortAt = i;
        break;
      }
    }
    if (shortAt < 0) break;

    // Drop an interior endpoint of the short segment, then re-ortho cleanly.
    // Prefer removing the later point (not the wire end).
    const removeIdx =
      shortAt + 1 < poly.length - 1
        ? shortAt + 1
        : shortAt > 0
          ? shortAt
          : -1;
    if (removeIdx < 0) break;

    poly = poly.filter((_, i) => i !== removeIdx);
    poly = simplifyOrtho(orthogonalPolyline(poly));
  }
  return poly;
}

/** Remove one corner; keep every other bend. Does not force a single L. */
export function straightenBendAt(
  polyline: Point[],
  cornerIndex: number,
): Point[] {
  if (cornerIndex <= 0 || cornerIndex >= polyline.length - 1) return polyline;
  const next = [
    ...polyline.slice(0, cornerIndex),
    ...polyline.slice(cornerIndex + 1),
  ];
  return simplifyOrtho(orthogonalPolyline(next));
}

/** Midpoints of user-editable segments (skip pin stubs). */
export function editableSegmentMids(
  polyline: Point[],
  opts?: { tipWire?: boolean; minLen?: number },
): { segIndex: number; point: Point; horizontal: boolean }[] {
  const minLen = opts?.minLen ?? 28;
  const tipWire = opts?.tipWire ?? false;
  const out: { segIndex: number; point: Point; horizontal: boolean }[] = [];
  const lo = tipWire ? 0 : 1;
  const hi = tipWire ? polyline.length - 2 : polyline.length - 3;
  for (let i = lo; i <= hi; i++) {
    const a = polyline[i]!;
    const b = polyline[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < minLen) continue;
    const horizontal = Math.abs(a.y - b.y) < 0.5;
    out.push({
      segIndex: i,
      point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      horizontal,
    });
  }
  return out;
}

/**
 * Flip HV ↔ VH elbow at a corner (L-bend direction change).
 * A—(B)—C with B = (C.x, A.y) becomes B' = (A.x, C.y), or vice versa.
 */
export function flipBendAt(polyline: Point[], cornerIndex: number): Point[] {
  if (cornerIndex <= 0 || cornerIndex >= polyline.length - 1) return polyline;
  const a = polyline[cornerIndex - 1]!;
  const b = polyline[cornerIndex]!;
  const c = polyline[cornerIndex + 1]!;

  const flipped: Point = { x: a.x + (c.x - b.x), y: a.y + (c.y - b.y) };
  // Classic elbow flip: (c.x, a.y) ↔ (a.x, c.y)
  const alt: Point =
    Math.abs(b.x - c.x) < 0.5 && Math.abs(b.y - a.y) < 0.5
      ? { x: a.x, y: c.y }
      : Math.abs(b.x - a.x) < 0.5 && Math.abs(b.y - c.y) < 0.5
        ? { x: c.x, y: a.y }
        : flipped;

  if (pointsEqual(alt, b)) return polyline;
  const next = polyline.map((p, i) => (i === cornerIndex ? alt : { ...p }));
  return simplifyOrtho(orthogonalPolyline(next));
}

function simplifyOrtho(poly: Point[]): Point[] {
  if (poly.length <= 2) return poly;
  const out: Point[] = [poly[0]!];
  for (let i = 1; i < poly.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const cur = poly[i]!;
    const next = poly[i + 1]!;
    if (pointsEqual(prev, cur)) continue;
    const colinear =
      (Math.abs(prev.x - cur.x) < 0.5 && Math.abs(cur.x - next.x) < 0.5) ||
      (Math.abs(prev.y - cur.y) < 0.5 && Math.abs(cur.y - next.y) < 0.5);
    if (colinear) continue;
    out.push(cur);
  }
  const last = poly[poly.length - 1]!;
  if (!pointsEqual(out[out.length - 1]!, last)) out.push(last);
  return out;
}

function tipNodePositionFromPin(at: Point): Point {
  return { x: at.x, y: at.y - TIP_SIZE / 2 };
}

function endsAligned(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5;
}

export type TipMove = { id: string; x: number; y: number };

export type BendEditResult = {
  waypoints: Point[];
  /** When unbending a free tip↔tip L, one/both tips move onto a straight H/V. */
  tipMoves?: TipMove[];
};

/**
 * Unbend a corner into a real straight run.
 * Orthogonal wires between offset tips can't lose their only elbow without
 * moving a tip — so for TIP ends we align them onto the longer arm.
 */
function planUnbend(
  nodes: Node<ComponentData>[],
  edge: Edge,
  poly: Point[],
  cornerIndex: number,
): BendEditResult | null {
  if (cornerIndex <= 0 || cornerIndex >= poly.length - 1) return null;
  const start = poly[0]!;
  const end = poly[poly.length - 1]!;
  const a = poly[cornerIndex - 1]!;
  const b = poly[cornerIndex]!;
  const c = poly[cornerIndex + 1]!;

  const src = nodes.find((n) => n.id === edge.source);
  const tgt = nodes.find((n) => n.id === edge.target);
  const srcTip = src?.data.kind === "TIP";
  const tgtTip = tgt?.data.kind === "TIP";
  if (!srcTip && !tgtTip) return null;

  const lenAB = Math.hypot(b.x - a.x, b.y - a.y);
  const lenBC = Math.hypot(c.x - b.x, c.y - b.y);
  const abH = Math.abs(a.y - b.y) < 0.5;
  const bcH = Math.abs(b.y - c.y) < 0.5;

  let newStart = { ...start };
  let newEnd = { ...end };

  if (lenAB >= lenBC) {
    // Keep AB's orientation through to the far end.
    if (abH) newEnd = { x: end.x, y: a.y };
    else newEnd = { x: a.x, y: end.y };
  } else {
    // Keep BC's orientation back to the near end.
    if (bcH) newStart = { x: start.x, y: c.y };
    else newStart = { x: c.x, y: start.y };
  }

  const tipMoves: TipMove[] = [];
  if (srcTip && !pointsEqual(start, newStart)) {
    const p = tipNodePositionFromPin(newStart);
    tipMoves.push({ id: edge.source, x: p.x, y: p.y });
  }
  if (tgtTip && !pointsEqual(end, newEnd)) {
    const p = tipNodePositionFromPin(newEnd);
    tipMoves.push({ id: edge.target, x: p.x, y: p.y });
  }
  if (!tipMoves.length) return null;

  return { waypoints: [], tipMoves };
}

function isUJog(a: Point, b: Point, c: Point, d: Point): boolean {
  const abH = Math.abs(a.y - b.y) < 0.5;
  const bcH = Math.abs(b.y - c.y) < 0.5;
  const cdH = Math.abs(c.y - d.y) < 0.5;
  const abV = Math.abs(a.x - b.x) < 0.5;
  const bcV = Math.abs(b.x - c.x) < 0.5;
  const cdV = Math.abs(c.x - d.x) < 0.5;
  // C / U off a vertical baseline: H–V–H returning to the same X (`[` / `]`).
  if (abH && bcV && cdH && Math.abs(a.x - d.x) < 0.5) return true;
  // C / U off a horizontal baseline: V–H–V returning to the same Y (`∪` / `∩`).
  if (abV && bcH && cdV && Math.abs(a.y - d.y) < 0.5) return true;
  return false;
}

/**
 * Flip a C/U-jog that contains `segIndex` to the opposite side of its baseline.
 * Clicking the bottom bar of a C should become the opposite C, not a staircase.
 */
export function flipUJogAtSegment(poly: Point[], segIndex: number): Point[] | null {
  if (segIndex < 0 || segIndex >= poly.length - 1) return null;
  let found: { start: number; a: Point; b: Point; c: Point; d: Point } | null = null;
  for (let start = 0; start + 3 < poly.length; start++) {
    if (segIndex < start || segIndex > start + 2) continue;
    const a = poly[start]!;
    const b = poly[start + 1]!;
    const c = poly[start + 2]!;
    const d = poly[start + 3]!;
    if (!isUJog(a, b, c, d)) continue;
    const isMiddle = segIndex === start + 1;
    if (isMiddle || !found) found = { start, a, b, c, d };
    if (isMiddle) break;
  }
  if (!found) return null;
  const { start, a, b, c } = found;
  const horiz = Math.abs(a.y - found.d.y) < 0.5;
  const b2 = horiz
    ? { x: b.x, y: 2 * a.y - b.y }
    : { x: 2 * a.x - b.x, y: b.y };
  const c2 = horiz
    ? { x: c.x, y: 2 * a.y - c.y }
    : { x: 2 * a.x - c.x, y: c.y };
  if (pointsEqual(b2, b) && pointsEqual(c2, c)) return null;
  const next = poly.map((p, i) =>
    i === start + 1 ? b2 : i === start + 2 ? c2 : { ...p },
  );
  return simplifyOrtho(next);
}

export function applyFlipJog(
  nodes: Node<ComponentData>[],
  edge: Edge,
  segIndex: number,
): BendEditResult | null {
  const poly = computeEdgePolyline(nodes, edge);
  if (!poly.length) return null;
  const flipped = flipUJogAtSegment(poly, segIndex);
  if (!flipped) return null;
  return { waypoints: polylineToStoredWaypoints(nodes, edge, flipped) };
}

/** Drop the two inner corners of a U-jog that contains `i`. */
function collapseUJogAt(poly: Point[], i: number): Point[] | null {
  const before = interiorCornerIndices(poly).length;
  for (let start = 0; start + 3 < poly.length; start++) {
    if (i < start + 1 || i > start + 2) continue;
    const a = poly[start]!;
    const b = poly[start + 1]!;
    const c = poly[start + 2]!;
    const d = poly[start + 3]!;
    if (!isUJog(a, b, c, d)) continue;
    const next = simplifyOrtho([
      ...poly.slice(0, start + 1),
      ...poly.slice(start + 3),
    ]);
    if (next.length < 3) continue;
    if (interiorCornerIndices(next).length < before) return next;
  }
  return null;
}

/**
 * Click a corner: collapse the U-jog that corner belongs to.
 * Last L on a free (tip) wire: unbend to a straight line by moving a tip.
 * Last L on pinned parts: no-op (removing it only flips HV ↔ VH).
 */
export function applyRemoveBend(
  nodes: Node<ComponentData>[],
  edge: Edge,
  cornerPolyIndex: number,
): BendEditResult | null {
  const poly = computeEdgePolyline(nodes, edge);
  if (!poly.length) return null;
  const src = nodes.find((n) => n.id === edge.source);
  const tgt = nodes.find((n) => n.id === edge.target);
  const free = src?.data.kind === "TIP" && tgt?.data.kind === "TIP";

  const collapsed = collapseUJogAt(poly, cornerPolyIndex);
  if (collapsed) {
    return { waypoints: polylineToStoredWaypoints(nodes, edge, collapsed) };
  }

  const before = interiorCornerIndices(poly).length;
  const reduced = straightenBendAt(poly, cornerPolyIndex);
  const after = interiorCornerIndices(reduced).length;
  if (after < before) {
    return { waypoints: polylineToStoredWaypoints(nodes, edge, reduced) };
  }

  if (free) {
    const planned = planUnbend(nodes, edge, poly, cornerPolyIndex);
    if (planned) return planned;
  }
  return null;
}

/** Flatten every extra bend. Free tips move onto one H or V. Pins keep one auto-elbow if needed. */
export function flattenWire(
  nodes: Node<ComponentData>[],
  edge: Edge,
): BendEditResult | null {
  const poly = computeEdgePolyline(nodes, edge);
  if (poly.length < 2) return null;
  const start = poly[0]!;
  const end = poly[poly.length - 1]!;
  const src = nodes.find((n) => n.id === edge.source);
  const tgt = nodes.find((n) => n.id === edge.target);
  const srcTip = src?.data.kind === "TIP";
  const tgtTip = tgt?.data.kind === "TIP";

  if (srcTip && tgtTip && !endsAligned(start, end)) {
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    const newEnd = dx >= dy ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
    const p = tipNodePositionFromPin(newEnd);
    return {
      waypoints: [],
      tipMoves: [{ id: edge.target, x: p.x, y: p.y }],
    };
  }
  return { waypoints: [] };
}

/**
 * Drag a segment perpendicular to add a U-jog (direction follows the cursor).
 * Pass `basePoly` (path at pointer-down) so live frames resize that jog
 * instead of stacking a new one every move.
 */
export function applyInsertBend(
  nodes: Node<ComponentData>[],
  edge: Edge,
  segIndex: number,
  cursor: Point,
  basePoly?: Point[],
): BendEditResult | null {
  const poly = basePoly ?? computeEdgePolyline(nodes, edge);
  if (!poly.length || segIndex < 0 || segIndex >= poly.length - 1) return null;
  const next = dragWireSegment(poly, segIndex, cursor, 16);
  if (next.length <= poly.length) return null;
  return { waypoints: polylineToStoredWaypoints(nodes, edge, next) };
}

/** Apply bend edit on an edge. */
export function applyBendEdit(
  nodes: Node<ComponentData>[],
  edge: Edge,
  cornerPolyIndex: number,
  action: "straighten" | "flip" | "remove",
): BendEditResult | null {
  const poly = computeEdgePolyline(nodes, edge);
  if (!poly.length) return null;

  if (action === "flip") {
    const next = flipBendAt(poly, cornerPolyIndex);
    return { waypoints: polylineToStoredWaypoints(nodes, edge, next) };
  }

  return applyRemoveBend(nodes, edge, cornerPolyIndex);
}

/** Flatten all bends (alias used by double-click). */
export function cleanWirePath(
  nodes: Node<ComponentData>[],
  edge: Edge,
  _minLen = 10,
): BendEditResult | null {
  return flattenWire(nodes, edge);
}

const STUB = 16;

function alignedOrtho(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5;
}

/**
 * Single-elbow waypoints between pin stubs so the final approach follows the
 * preferred pin (horizontal into left/right, vertical into top/bottom).
 * Empty waypoints alone often leave a stair next to the far pin because the
 * auto router puts the elbow there.
 */
/** Axis the pin exits along. */
function sideAxis(side: PinSide): "h" | "v" {
  return side === "left" || side === "right" ? "h" : "v";
}

/** Sign of the pin's outward direction on its axis. */
function sideSign(side: PinSide): number {
  return side === "right" || side === "bottom" ? 1 : -1;
}

function pinToPinStraightWaypoints(
  start: Point,
  end: Point,
  sourceSide: PinSide,
  targetSide: PinSide,
  prefer: "source" | "target",
): Point[] {
  const startOut = outwardStub(start, sourceSide, STUB);
  const endOut = outwardStub(end, targetSide, STUB);
  if (alignedOrtho(startOut, endOut)) return [];

  const srcH = sideAxis(sourceSide) === "h";
  const tgtH = sideAxis(targetSide) === "h";
  // After a part move, pins often land within one grid of coplanar. Empty
  // waypoints + clearApproachBend's near-align path yield a tiny stair instead
  // of a body-clearance detour (big step / overhang past the far pin).
  if (srcH && tgtH && Math.abs(start.y - end.y) <= WIRE_GRID) return [];
  if (!srcH && !tgtH && Math.abs(start.x - end.x) <= WIRE_GRID) return [];

  const anchor = prefer === "source" ? startOut : endOut;
  const other = prefer === "source" ? endOut : startOut;
  const anchorSide = prefer === "source" ? sourceSide : targetSide;

  const axis = sideAxis(anchorSide);
  const sign = sideSign(anchorSide);

  // The long run may only follow the anchor pin's own row/column when the far
  // end actually lies in the direction that pin faces. If it lies behind the
  // pin, running along that row doubles the wire back across its own component
  // — passing through the part's body and its other pin. Take the
  // perpendicular elbow instead so the path clears the part first.
  const delta = axis === "h" ? other.x - anchor.x : other.y - anchor.y;
  const backtracks = delta * sign < 0;

  // Use a mid-column/row elbow so the long run never overhangs past the far
  // pin stub (old single-elbow at other.x looked like an extra tip).
  const mid = snapPoint(
    { x: (startOut.x + endOut.x) / 2, y: (startOut.y + endOut.y) / 2 },
    WIRE_GRID,
  );

  if (axis === "h") {
    if (backtracks) {
      return [
        { x: anchor.x, y: mid.y },
        { x: other.x, y: mid.y },
      ];
    }
    return [
      { x: mid.x, y: anchor.y },
      { x: mid.x, y: other.y },
    ];
  }
  if (backtracks) {
    return [
      { x: mid.x, y: anchor.y },
      { x: mid.x, y: other.y },
    ];
  }
  return [
    { x: anchor.x, y: mid.y },
    { x: other.x, y: mid.y },
  ];
}

function alignTipToPin(
  tipPoint: Point,
  pinPoint: Point,
  pinSide: PinSide | null,
): Point {
  if (pinSide === "left" || pinSide === "right") {
    return { x: tipPoint.x, y: pinPoint.y };
  }
  if (pinSide === "top" || pinSide === "bottom") {
    return { x: pinPoint.x, y: tipPoint.y };
  }
  const dx = Math.abs(pinPoint.x - tipPoint.x);
  const dy = Math.abs(pinPoint.y - tipPoint.y);
  return dx >= dy
    ? { x: tipPoint.x, y: pinPoint.y }
    : { x: pinPoint.x, y: tipPoint.y };
}

/**
 * Double-click straighten:
 * - pin↔TIP: slide the tip onto the pin's exit row/column
 * - TIP↔TIP: collapse to one H/V (may move a tip)
 * - pin↔pin: one clean elbow with the final approach into the nearer pin
 */
export function straightenWire(
  nodes: Node<ComponentData>[],
  edge: Edge,
  clickPoint?: Point,
): BendEditResult | null {
  if (!edge.sourceHandle || !edge.targetHandle) return null;
  const src = nodes.find((n) => n.id === edge.source);
  const tgt = nodes.find((n) => n.id === edge.target);
  if (!src || !tgt) return null;

  const start = pinWorldPoint(src, edge.sourceHandle);
  const end = pinWorldPoint(tgt, edge.targetHandle);
  if (!start || !end) return null;

  const srcTip = src.data.kind === "TIP";
  const tgtTip = tgt.data.kind === "TIP";

  if (srcTip && tgtTip) {
    return flattenWire(nodes, edge);
  }

  if (srcTip !== tgtTip) {
    const tip = srcTip ? src : tgt;
    const tipPoint = srcTip ? start : end;
    const pinPoint = srcTip ? end : start;
    const pinNode = srcTip ? tgt : src;
    const pinHandle = srcTip ? edge.targetHandle : edge.sourceHandle;
    const pinSide = pinWorldSide(pinNode, pinHandle);
    const aligned = alignTipToPin(tipPoint, pinPoint, pinSide);
    if (pointsEqual(aligned, tipPoint)) {
      return { waypoints: [] };
    }
    const p = tipNodePositionFromPin(aligned);
    return {
      waypoints: [],
      tipMoves: [{ id: tip.id, x: p.x, y: p.y }],
    };
  }

  const sourceSide = pinWorldSide(src, edge.sourceHandle) ?? "left";
  const targetSide = pinWorldSide(tgt, edge.targetHandle) ?? "right";
  let prefer: "source" | "target" = "target";
  if (clickPoint) {
    const ds = Math.hypot(clickPoint.x - start.x, clickPoint.y - start.y);
    const dt = Math.hypot(clickPoint.x - end.x, clickPoint.y - end.y);
    prefer = ds <= dt ? "source" : "target";
  }
  return {
    waypoints: pinToPinStraightWaypoints(
      start,
      end,
      sourceSide,
      targetSide,
      prefer,
    ),
  };
}

export type ConnectedPartMovePlan = {
  /** Part + long free TIP wires that should translate with the drag. */
  moveIds: string[];
  /** Incident pin↔pin / pin↔junction edges whose absolute waypoints go stale. */
  clearWaypointEdgeIds: string[];
  /** Short free stubs removed at move start (riding them creates hollow crossings). */
  dropStubTipIds: string[];
  dropStubEdgeIds: string[];
};

export type TipWireAttachResult = {
  nodes: Node<ComponentData>[];
  edges: Edge[];
  attached: number;
};

export type ConnectedPartMoveResult = {
  nodes: Node<ComponentData>[];
  edges: Edge[];
};

const SHORT_FREE_STUB_MAX = 48;

function polylineLen(poly: Point[]): number {
  let len = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    len += Math.hypot(poly[i + 1]!.x - poly[i]!.x, poly[i + 1]!.y - poly[i]!.y);
  }
  return len;
}

/** Degree-1 pin↔TIP stub short enough to discard instead of dragging. */
function isShortFreeTipStub(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  edge: Edge,
  tipId: string,
  maxLen = SHORT_FREE_STUB_MAX,
): boolean {
  const deg = edges.reduce(
    (n, e) => n + (e.source === tipId || e.target === tipId ? 1 : 0),
    0,
  );
  if (deg !== 1) return false;
  const poly = computeEdgePolyline(nodes, edge);
  if (poly.length < 2) return true;
  return polylineLen(poly) <= maxLen;
}

/**
 * Merge moved free wire ends into rails they land on.
 *
 * A component can already own a short pin↔TIP edge (for example after an older
 * detach). Moving that component may place the TIP exactly on another wire.
 * Merely overlapping them is not electrical connectivity and junction
 * detection correctly draws a hollow crossing ring. Reuse the free TIP as the
 * rail's junction so the graph and the drawing agree.
 */
export function attachFreeTipsToWires(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  candidateTipIds: ReadonlySet<string>,
  tolerance = 4,
): TipWireAttachResult {
  let nextNodes = nodes;
  let nextEdges = edges;
  let attached = 0;

  for (const tipId of candidateTipIds) {
    const tip = nextNodes.find(
      (node) => node.id === tipId && node.data.kind === "TIP",
    );
    if (!tip) continue;

    const incident = nextEdges.filter(
      (edge) => edge.source === tipId || edge.target === tipId,
    );
    if (incident.length !== 1) continue;
    const branchEdge = incident[0]!;
    const tipPoint = pinWorldPoint(tip, "t");
    if (!tipPoint) continue;

    let target:
      | { edge: Edge; poly: Point[]; point: Point; distance: number }
      | null = null;
    for (const edge of nextEdges) {
      if (edge.id === branchEdge.id) continue;
      if (edge.source === tipId || edge.target === tipId) continue;
      const poly = computeEdgePolyline(nextNodes, edge);
      if (poly.length < 2) continue;
      const distance = distToPolyline(poly, tipPoint);
      if (distance > tolerance || (target && distance >= target.distance)) continue;
      target = {
        edge,
        poly,
        point: closestPointOnPolyline(poly, tipPoint, 1),
        distance,
      };
    }
    if (!target) continue;

    const first = target.poly[0]!;
    const last = target.poly[target.poly.length - 1]!;
    const nearStart = Math.hypot(target.point.x - first.x, target.point.y - first.y) <= 1;
    const nearEnd = Math.hypot(target.point.x - last.x, target.point.y - last.y) <= 1;

    // At an existing endpoint, merge the dangling branch directly into that
    // endpoint instead of creating a zero-length rail half.
    if (nearStart || nearEnd) {
      const endpointIsStart = nearStart;
      const endpointNodeId = endpointIsStart
        ? target.edge.source
        : target.edge.target;
      const endpointHandle = endpointIsStart
        ? target.edge.sourceHandle
        : target.edge.targetHandle;
      nextEdges = nextEdges.map((edge) => {
        if (edge.id !== branchEdge.id) return edge;
        if (edge.source === tipId) {
          return {
            ...edge,
            source: endpointNodeId,
            sourceHandle: endpointHandle,
          };
        }
        return {
          ...edge,
          target: endpointNodeId,
          targetHandle: endpointHandle,
        };
      });
      nextNodes = nextNodes.filter((node) => node.id !== tipId);
      attached++;
      continue;
    }

    let splitIndex = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < target.poly.length - 1; index++) {
      const a = target.poly[index]!;
      const b = target.poly[index + 1]!;
      const distance =
        Math.abs(a.y - b.y) < 0.5
          ? Math.abs(target.point.y - a.y)
          : Math.abs(target.point.x - a.x);
      const inside =
        target.point.x >= Math.min(a.x, b.x) - 0.5 &&
        target.point.x <= Math.max(a.x, b.x) + 0.5 &&
        target.point.y >= Math.min(a.y, b.y) - 0.5 &&
        target.point.y <= Math.max(a.y, b.y) + 0.5;
      if (inside && distance < bestDistance) {
        bestDistance = distance;
        splitIndex = index;
      }
    }

    const dedupe = (points: Point[]) =>
      points.filter(
        (point, index) =>
          index === 0 ||
          Math.hypot(
            point.x - points[index - 1]!.x,
            point.y - points[index - 1]!.y,
          ) > 0.5,
      );
    const before = dedupe([
      ...target.poly.slice(0, splitIndex + 1),
      target.point,
    ]);
    const after = dedupe([
      target.point,
      ...target.poly.slice(splitIndex + 1),
    ]);

    nextNodes = nextNodes.map((node) =>
      node.id === tipId
        ? {
            ...node,
            position: { x: target!.point.x, y: target!.point.y - TIP_SIZE / 2 },
          }
        : node,
    );
    nextEdges = [
      ...nextEdges.filter((edge) => edge.id !== target!.edge.id),
      {
        ...target.edge,
        id: `${target.edge.id}:before:${tipId}`,
        target: tipId,
        targetHandle: "t",
        data: { ...(target.edge.data as object), waypoints: before.slice(1, -1) },
      },
      {
        ...target.edge,
        id: `${target.edge.id}:after:${tipId}`,
        source: tipId,
        sourceHandle: "t",
        data: { ...(target.edge.data as object), waypoints: after.slice(1, -1) },
      },
    ];
    attached++;
  }

  return { nodes: nextNodes, edges: nextEdges, attached };
}

/**
 * When a part moves with wires attached:
 * - long free TIP wires ride along (same delta as the part)
 * - short free stubs are dropped (they become hollow crossings / junk tips)
 * - pin↔pin / junction wires drop stored waypoints so they re-route from pins
 */
export function planConnectedPartMove(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  partId: string,
): ConnectedPartMovePlan | null {
  const part = nodes.find((n) => n.id === partId && n.data.kind !== "TIP");
  if (!part) return null;

  const deg = new Map<string, number>();
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
  }

  const freeTipIds: string[] = [];
  const clearWaypointEdgeIds: string[] = [];
  const dropStubTipIds: string[] = [];
  const dropStubEdgeIds: string[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const e of edges) {
    if (e.source !== partId && e.target !== partId) continue;
    const otherId = e.source === partId ? e.target : e.source;
    const other = byId.get(otherId);
    if (!other) continue;
    if (other.data.kind === "TIP" && (deg.get(otherId) ?? 0) === 1) {
      if (isShortFreeTipStub(nodes, edges, e, otherId)) {
        dropStubTipIds.push(otherId);
        dropStubEdgeIds.push(e.id);
      } else {
        freeTipIds.push(otherId);
      }
      continue;
    }
    clearWaypointEdgeIds.push(e.id);
  }

  return {
    moveIds: [partId, ...freeTipIds],
    clearWaypointEdgeIds,
    dropStubTipIds,
    dropStubEdgeIds,
  };
}

function applyTipMoves(
  nodes: Node<ComponentData>[],
  tipMoves: TipMove[],
): Node<ComponentData>[] {
  if (!tipMoves.length) return nodes;
  const byId = new Map(tipMoves.map((m) => [m.id, m]));
  return nodes.map((n) => {
    const m = byId.get(n.id);
    return m ? { ...n, position: { x: m.x, y: m.y } } : n;
  });
}

/**
 * Slide a shared junction tip along its rail so it sits under/near the moved
 * pin. Using pin-row straighten here would yank the tip off a horizontal bus
 * when the part has left/right pins.
 */
function snapJunctionTipOntoRail(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  branchEdge: Edge,
  tipId: string,
  partId: string,
  partHandle: string,
): TipMove | null {
  const part = nodes.find((n) => n.id === partId);
  if (!part) return null;
  const pinPt = pinWorldPoint(part, partHandle);
  if (!pinPt) return null;

  const side = pinWorldSide(part, partHandle);
  // Top/bottom pins onto a horizontal bus: project the pin column, not an
  // outward stub that points away from the rail (rotation left stranded tips).
  const aim =
    side === "left" || side === "right"
      ? outwardStub(pinPt, side, STUB)
      : pinPt;

  let best: Point | null = null;
  let bestDist = Infinity;
  for (const edge of edges) {
    if (edge.id === branchEdge.id) continue;
    if (edge.source !== tipId && edge.target !== tipId) continue;
    const railSrc = nodes.find((n) => n.id === edge.source);
    const railTgt = nodes.find((n) => n.id === edge.target);
    // Only slide along tip↔tip rail halves — never along part branches (C tap,
    // R leg, etc.) or the snap lands on the wrong segment after rotate/move.
    if (railSrc?.data.kind !== "TIP" || railTgt?.data.kind !== "TIP") continue;
    const poly = computeEdgePolyline(nodes, edge);
    if (poly.length < 2) continue;
    const onRail = closestPointOnPolyline(poly, aim, WIRE_GRID);
    const dist = Math.hypot(onRail.x - aim.x, onRail.y - aim.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = onRail;
    }
  }
  if (!best) return null;

  const tip = nodes.find((n) => n.id === tipId);
  const cur = tip ? pinWorldPoint(tip, "t") : null;
  if (cur && Math.hypot(cur.x - best.x, cur.y - best.y) < 0.5) return null;
  const p = tipNodePositionFromPin(best);
  return { id: tipId, x: p.x, y: p.y };
}

/** Reposition every junction tip attached to a transformed part (2 passes). */
function snapAllJunctionTipsForParts(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  movedPartIds: ReadonlySet<string>,
): { nodes: Node<ComponentData>[]; edges: Edge[] } {
  let nextNodes = nodes;
  let nextEdges = edges;
  const deg = () => {
    const d = new Map<string, number>();
    for (const e of nextEdges) {
      d.set(e.source, (d.get(e.source) ?? 0) + 1);
      d.set(e.target, (d.get(e.target) ?? 0) + 1);
    }
    return d;
  };

  for (let pass = 0; pass < 2; pass++) {
    const tipMoves: TipMove[] = [];
    const d = deg();
    for (const e of nextEdges) {
      const srcMoved = movedPartIds.has(e.source);
      const tgtMoved = movedPartIds.has(e.target);
      if (!srcMoved && !tgtMoved) continue;
      const src = nextNodes.find((n) => n.id === e.source);
      const tgt = nextNodes.find((n) => n.id === e.target);
      if (!src || !tgt) continue;
      if (src.data.kind === "TIP" && tgt.data.kind === "TIP") continue;
      if (src.data.kind !== "TIP" && tgt.data.kind !== "TIP") continue;
      const tip = src.data.kind === "TIP" ? src : tgt;
      const part = src.data.kind === "TIP" ? tgt : src;
      const partHandle =
        src.data.kind === "TIP" ? e.targetHandle! : e.sourceHandle!;
      if ((d.get(tip.id) ?? 0) < 2 || !movedPartIds.has(part.id)) continue;
      const snap = snapJunctionTipOntoRail(
        nextNodes,
        nextEdges,
        e,
        tip.id,
        part.id,
        partHandle,
      );
      if (snap) tipMoves.push(snap);
    }
    if (!tipMoves.length) break;
    nextNodes = applyTipMoves(nextNodes, tipMoves);
    const touched = new Set(tipMoves.map((m) => m.id));
    nextEdges = nextEdges.map((edge) => {
      if (!touched.has(edge.source) && !touched.has(edge.target)) return edge;
      return { ...edge, data: { ...(edge.data as object), waypoints: [] } };
    });
  }
  return { nodes: nextNodes, edges: nextEdges };
}

/**
 * Drop short free stubs still hanging off moved parts (especially when the
 * same pin already has a real connection — those draw as hollow crossings).
 */
function dropShortFreeStubsOnParts(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  movedPartIds: ReadonlySet<string>,
): ConnectedPartMoveResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const deg = new Map<string, number>();
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
  }

  const dropTips = new Set<string>();
  const dropEdges = new Set<string>();

  for (const e of edges) {
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (!src || !tgt) continue;
    const srcTip = src.data.kind === "TIP";
    const tgtTip = tgt.data.kind === "TIP";
    if (srcTip === tgtTip) continue;

    const tip = srcTip ? src : tgt;
    const part = srcTip ? tgt : src;
    if (!movedPartIds.has(part.id)) continue;
    if ((deg.get(tip.id) ?? 0) !== 1) continue;
    if (!isShortFreeTipStub(nodes, edges, e, tip.id)) continue;

    // Always drop short stubs on a moved part. If the pin also has another
    // edge, leaving the stub guarantees a hollow crossing at the pin.
    dropTips.add(tip.id);
    dropEdges.add(e.id);
  }

  if (!dropTips.size) return { nodes, edges };
  return {
    nodes: nodes.filter((n) => !dropTips.has(n.id)),
    edges: edges.filter((e) => !dropEdges.has(e.id)),
  };
}

/**
 * After a part lands, rebuild attached wires and clean the graph:
 * - pin↔pin: one clean elbow into the moved pin
 * - pin↔junction: slide tip along the rail under the pin (keep T intact)
 * - pin↔free TIP: align tip onto the pin row/column
 * - free tips that land on rails merge into real junctions
 * - short free stubs on moved parts are removed
 *
 * Returns edges only (legacy). Prefer finalizeConnectedPartMove when tips move.
 */
export function autorouteWiresForMovedParts(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  movedPartIds: ReadonlySet<string>,
): Edge[] {
  return finalizeConnectedPartMove(nodes, edges, movedPartIds).edges;
}

/**
 * Full post-move cleanup for any circuit: autoroute + tip slides + attach + prune.
 */
export function finalizeConnectedPartMove(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  movedPartIds: ReadonlySet<string>,
): ConnectedPartMoveResult {
  if (!movedPartIds.size) return { nodes, edges };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const deg = new Map<string, number>();
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
  }

  // Absolute waypoints go stale after rotate/move. Clear every edge that
  // touches a moved part or a shared junction tip on that part before routing.
  const junctionTipIds = new Set<string>();
  const clearWaypointIds = new Set<string>();
  for (const e of edges) {
    const srcMoved = movedPartIds.has(e.source);
    const tgtMoved = movedPartIds.has(e.target);
    if (srcMoved || tgtMoved) clearWaypointIds.add(e.id);
    if (!srcMoved && !tgtMoved) continue;
    const otherId = srcMoved ? e.target : e.source;
    const other = byId.get(otherId);
    if (other?.data.kind === "TIP" && (deg.get(otherId) ?? 0) >= 2) {
      junctionTipIds.add(otherId);
    }
  }
  for (const e of edges) {
    if (junctionTipIds.has(e.source) || junctionTipIds.has(e.target)) {
      clearWaypointIds.add(e.id);
    }
  }
  const workEdges =
    clearWaypointIds.size === 0
      ? edges
      : edges.map((e) =>
          clearWaypointIds.has(e.id)
            ? { ...e, data: { ...(e.data as object), waypoints: [] } }
            : e,
        );

  const tipMoves: TipMove[] = [];
  const touchedTipIds = new Set<string>(junctionTipIds);

  let nextEdges = workEdges.map((edge) => {
    const srcMoved = movedPartIds.has(edge.source);
    const tgtMoved = movedPartIds.has(edge.target);
    if (!srcMoved && !tgtMoved) return edge;
    const src = byId.get(edge.source);
    const tgt = byId.get(edge.target);
    if (!src || !tgt) return edge;
    if (!edge.sourceHandle || !edge.targetHandle) return edge;

    if (src.data.kind === "TIP" || tgt.data.kind === "TIP") {
      const tip = src.data.kind === "TIP" ? src : tgt;
      const part = src.data.kind === "TIP" ? tgt : src;
      const partHandle =
        src.data.kind === "TIP" ? edge.targetHandle : edge.sourceHandle;
      const tipDeg = deg.get(tip.id) ?? 0;

      if (tipDeg >= 2 && movedPartIds.has(part.id)) {
        const snap = snapJunctionTipOntoRail(
          nodes,
          workEdges,
          edge,
          tip.id,
          part.id,
          partHandle,
        );
        if (snap) {
          tipMoves.push(snap);
          touchedTipIds.add(snap.id);
        }
        return {
          ...edge,
          data: { ...(edge.data as object), waypoints: [] },
        };
      }

      // Free tip: slide onto the pin's exit row/column.
      const result = straightenWire(nodes, edge);
      if (result?.tipMoves?.length) {
        for (const m of result.tipMoves) {
          tipMoves.push(m);
          touchedTipIds.add(m.id);
        }
      }
      return {
        ...edge,
        data: { ...(edge.data as object), waypoints: result?.waypoints ?? [] },
      };
    }

    // Pin↔pin: empty waypoints — routeWirePoints re-approaches from pin stubs.
    // straightenWire elbows go stale/backtrack after rotate and caused the
    // doubled paths / wires-through-parts seen in V-R-C circuits.
    return {
      ...edge,
      data: { ...(edge.data as object), waypoints: [], directPath: false },
    };
  });

  let nextNodes = applyTipMoves(nodes, tipMoves);

  // Rail halves attached to a slid junction tip: drop absolute waypoints so
  // they re-anchor to the tip's new position without leftover elbows.
  if (touchedTipIds.size) {
    nextEdges = nextEdges.map((edge) => {
      if (!touchedTipIds.has(edge.source) && !touchedTipIds.has(edge.target)) {
        return edge;
      }
      const wps =
        ((edge.data as { waypoints?: Point[] } | undefined)?.waypoints) ?? [];
      if (!wps.length) return edge;
      return {
        ...edge,
        data: { ...(edge.data as object), waypoints: [] },
      };
    });
  }

  // Free tips that rode with the part (or remain deg-1) may sit on a rail.
  const degAfter = new Map<string, number>();
  for (const e of nextEdges) {
    degAfter.set(e.source, (degAfter.get(e.source) ?? 0) + 1);
    degAfter.set(e.target, (degAfter.get(e.target) ?? 0) + 1);
  }
  const candidateTips = new Set<string>();
  for (const e of nextEdges) {
    const srcPart = movedPartIds.has(e.source);
    const tgtPart = movedPartIds.has(e.target);
    if (!srcPart && !tgtPart) continue;
    const tipId = srcPart ? e.target : e.source;
    const tip = nextNodes.find((n) => n.id === tipId);
    if (tip?.data.kind === "TIP" && (degAfter.get(tipId) ?? 0) === 1) {
      candidateTips.add(tipId);
    }
  }
  if (candidateTips.size) {
    const attached = attachFreeTipsToWires(nextNodes, nextEdges, candidateTips);
    nextNodes = attached.nodes;
    nextEdges = attached.edges;
  }

  const prunedStubs = dropShortFreeStubsOnParts(nextNodes, nextEdges, movedPartIds);
  nextNodes = prunedStubs.nodes;
  nextEdges = prunedStubs.edges;

  const resnapped = snapAllJunctionTipsForParts(nextNodes, nextEdges, movedPartIds);
  nextNodes = resnapped.nodes;
  nextEdges = resnapped.edges;

  const collapsed = collapsePassThroughTips(nextNodes, nextEdges);
  return pruneOrphanTips(collapsed.nodes, collapsed.edges);
}
