import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import {
  orthogonalPolyline,
  pointsEqual,
  snapPoint,
  type Point,
} from "./orthogonal";
import { computeEdgePolyline, dragWireSegment } from "./wireGeometry";

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
  return { waypoints: flipped.slice(1, -1) };
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
  if (collapsed) return { waypoints: collapsed.slice(1, -1) };

  const before = interiorCornerIndices(poly).length;
  const reduced = straightenBendAt(poly, cornerPolyIndex);
  const after = interiorCornerIndices(reduced).length;
  if (after < before) return { waypoints: reduced.slice(1, -1) };

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
  return { waypoints: next.slice(1, -1) };
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
    return { waypoints: next.slice(1, -1) };
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
