import type { Edge, Node } from "@xyflow/react";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import type { ComponentData } from "../model/types";
import { findNearestPin, pinWorldPoint } from "./pinGeometry";
import {
  computeEdgePolyline,
} from "./wireGeometry";
import type { Point } from "./orthogonal";
import { collapsePassThroughTips, pruneOrphanTips } from "./tipCleanup";

/**
 * Pin must land this close to a wire to attach. Grid is 16; stay under one cell
 * so a nearby rail isn't stolen, but on-grid overlap still hits.
 */
const HIT_TOL = 8;
/** Skip T-splice only at the literal wire tip (not interior corners). */
const END_EXCLUDE = 4;
/** Pins must span at least this fraction of their separation along the wire. */
const MIN_SPAN_FRAC = 0.45;
/** Absolute minimum span so tiny overlaps don't splice. */
const MIN_SPAN_PX = 12;

type PinHit = {
  pinId: string;
  point: Point;
  proj: Point;
  dist: number;
  arc: number;
  segIndex: number;
};

function dedupePath(points: Point[]): Point[] {
  return points.filter(
    (p, i) =>
      i === 0 ||
      Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y) > 0.5,
  );
}

/** Distance along polyline to the closest point on it; also returns projection. */
function projectOntoPolyline(
  poly: Point[],
  p: Point,
): { proj: Point; arc: number; segIndex: number; dist: number } {
  let bestDist = Infinity;
  let bestProj = poly[0]!;
  let bestArc = 0;
  let bestSeg = 0;
  let walked = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const lenSq = dx * dx + dy * dy;
    let t = lenSq < 0.01 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < bestDist) {
      bestDist = d;
      bestProj = { x: cx, y: cy };
      bestArc = walked + t * len;
      bestSeg = i;
    }
    walked += len;
  }
  return { proj: bestProj, arc: bestArc, segIndex: bestSeg, dist: bestDist };
}

/** Pin on an orthogonal segment (not a corner glancing hit on the wrong leg). */
function pinOnSegment(pt: Point, a: Point, b: Point, tol: number): boolean {
  const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  if (horiz) {
    if (Math.abs(pt.y - a.y) > tol) return false;
    const lo = Math.min(a.x, b.x) - tol;
    const hi = Math.max(a.x, b.x) + tol;
    return pt.x >= lo && pt.x <= hi;
  }
  if (Math.abs(pt.x - a.x) > tol) return false;
  const lo = Math.min(a.y, b.y) - tol;
  const hi = Math.max(a.y, b.y) + tol;
  return pt.y >= lo && pt.y <= hi;
}

function bestPinHitOnEdge(
  nodes: Node<ComponentData>[],
  edge: Edge,
  pt: Point,
  hitTol: number,
): { edge: Edge; poly: Point[]; hit: ReturnType<typeof projectOntoPolyline> } | null {
  const poly = computeEdgePolyline(nodes, edge);
  if (poly.length < 2) return null;
  const hit = projectOntoPolyline(poly, pt);
  if (hit.dist > hitTol) return null;
  const a = poly[hit.segIndex]!;
  const b = poly[hit.segIndex + 1]!;
  if (!pinOnSegment(pt, a, b, hitTol)) return null;
  const first = poly[0]!;
  const last = poly[poly.length - 1]!;
  const atStart = Math.hypot(hit.proj.x - first.x, hit.proj.y - first.y) < END_EXCLUDE;
  const atEnd = Math.hypot(hit.proj.x - last.x, hit.proj.y - last.y) < END_EXCLUDE;
  if ((atStart || atEnd) && hit.dist > 2) return null;
  return { edge, poly, hit };
}

function pathUntil(poly: Point[], segIndex: number, at: Point): Point[] {
  return dedupePath([...poly.slice(0, segIndex + 1), at]);
}

function pathFrom(poly: Point[], segIndex: number, at: Point): Point[] {
  return dedupePath([at, ...poly.slice(segIndex + 1)]);
}

function interiorWaypoints(path: Point[]): Point[] {
  if (path.length <= 2) return [];
  return path.slice(1, -1);
}

/** Split point on the hit segment using the pin's along-rail coordinate. */
function joinOnSegment(poly: Point[], segIndex: number, pin: Point): Point {
  const a = poly[segIndex]!;
  const b = poly[segIndex + 1]!;
  const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  if (horiz) {
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    return { x: Math.max(lo, Math.min(hi, pin.x)), y: a.y };
  }
  const lo = Math.min(a.y, b.y);
  const hi = Math.max(a.y, b.y);
  return { x: a.x, y: Math.max(lo, Math.min(hi, pin.y)) };
}

/** Move the part so `pinId` sits exactly on `join` (axis already chosen). */
function snapPartPinToJoin(
  part: Node<ComponentData>,
  pinId: string,
  join: Point,
): Node<ComponentData> {
  const pt = pinWorldPoint(part, pinId);
  if (!pt) return part;
  const nextPos = {
    x: part.position.x + (join.x - pt.x),
    y: part.position.y + (join.y - pt.y),
  };
  const { internals, ...rest } = { ...part, position: nextPos } as Node<ComponentData> & {
    internals?: unknown;
  };
  void internals;
  return rest as Node<ComponentData>;
}

function pinIsFree(
  edges: Edge[],
  partId: string,
  pinId: string,
): boolean {
  return !edges.some(
    (e) =>
      (e.source === partId && e.sourceHandle === pinId) ||
      (e.target === partId && e.targetHandle === pinId),
  );
}

/**
 * Series pin pairs we may splice into a wire: opposite sides (L↔R, T↔B).
 * Only true two-terminal parts (R, C, L, …). Multi-pin symbols (BJT, IGBT)
 * must use per-pin T-splice — series insert on one polyline breaks their nets.
 */
function seriesPinPairs(kind: ComponentData["kind"]): [string, string][] {
  const pins = COMPONENT_SPECS[kind].pins;
  if (pins.length !== 2) return [];
  return [[pins[0]!.id, pins[1]!.id]];
}

/**
 * LTspice-style "drop part onto wire": if two free pins of a part land on the
 * same wire, break the wire between them and attach each pin to a stub.
 * Nothing is left running under the part body.
 */
export function insertPartsOnWires(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  partIds: readonly string[],
  hitTol = HIT_TOL,
): { nodes: Node<ComponentData>[]; edges: Edge[]; inserted: number } {
  let nextNodes = nodes;
  let nextEdges = edges;
  let inserted = 0;

  for (const partId of partIds) {
    const part0 = nextNodes.find((n) => n.id === partId);
    if (!part0 || part0.data.kind === "TIP") continue;

    const pairs = seriesPinPairs(part0.data.kind);
    if (!pairs.length) continue;

    let best: {
      edge: Edge;
      poly: Point[];
      pinA: string;
      pinB: string;
      hitA: PinHit;
      hitB: PinHit;
    } | null = null;

    for (const [pinAId, pinBId] of pairs) {
      if (!pinIsFree(nextEdges, partId, pinAId)) continue;
      if (!pinIsFree(nextEdges, partId, pinBId)) continue;

      const pa0 = pinWorldPoint(part0, pinAId);
      const pb0 = pinWorldPoint(part0, pinBId);
      if (!pa0 || !pb0) continue;
      const pinSpan = Math.hypot(pb0.x - pa0.x, pb0.y - pa0.y);
      if (pinSpan < MIN_SPAN_PX) continue;

      for (const edge of nextEdges) {
        if (edge.source === partId || edge.target === partId) continue;
        const poly = computeEdgePolyline(nextNodes, edge);
        if (poly.length < 2) continue;

        const a = projectOntoPolyline(poly, pa0);
        const b = projectOntoPolyline(poly, pb0);
        if (a.dist > hitTol || b.dist > hitTol) continue;
        const segA = poly[a.segIndex]!;
        const segB = poly[a.segIndex + 1]!;
        const segA2 = poly[b.segIndex]!;
        const segB2 = poly[b.segIndex + 1]!;
        if (!pinOnSegment(pa0, segA, segB, hitTol)) continue;
        if (!pinOnSegment(pb0, segA2, segB2, hitTol)) continue;

        const along = Math.abs(b.arc - a.arc);
        if (along < Math.max(MIN_SPAN_PX, pinSpan * MIN_SPAN_FRAC)) continue;

        // Prefer tighter pin-to-wire hits.
        const score = a.dist + b.dist;
        if (best && score >= best.hitA.dist + best.hitB.dist) continue;

        best = {
          edge,
          poly,
          pinA: pinAId,
          pinB: pinBId,
          hitA: {
            pinId: pinAId,
            point: pa0,
            proj: a.proj,
            dist: a.dist,
            arc: a.arc,
            segIndex: a.segIndex,
          },
          hitB: {
            pinId: pinBId,
            point: pb0,
            proj: b.proj,
            dist: b.dist,
            arc: b.arc,
            segIndex: b.segIndex,
          },
        };
      }
    }

    if (!best) continue;

    // Seat the part on the rail so both pins share the wire axis (no jog).
    const join = joinOnSegment(best.poly, best.hitA.segIndex, best.hitA.point);
    const part = snapPartPinToJoin(part0, best.pinA, join);
    const pa = pinWorldPoint(part, best.pinA);
    const pb = pinWorldPoint(part, best.pinB);
    if (!pa || !pb) continue;

    const a2 = projectOntoPolyline(best.poly, pa);
    const b2 = projectOntoPolyline(best.poly, pb);
    // Order along the wire: nearer source first.
    const first = a2.arc <= b2.arc
      ? { pinId: best.pinA, ...a2 }
      : { pinId: best.pinB, ...b2 };
    const second = a2.arc <= b2.arc
      ? { pinId: best.pinB, ...b2 }
      : { pinId: best.pinA, ...a2 };

    if (Math.abs(second.arc - first.arc) < MIN_SPAN_PX) continue;

    const before = pathUntil(best.poly, first.segIndex, first.proj);
    const after = pathFrom(best.poly, second.segIndex, second.proj);

    const edge = best.edge;
    const leftWaypoints = interiorWaypoints(before);
    const rightWaypoints = interiorWaypoints(after);

    nextNodes = nextNodes.map((n) => (n.id === partId ? part : n));
    nextEdges = [
      ...nextEdges.filter((e) => e.id !== edge.id),
      {
        ...edge,
        id: `${edge.source}${edge.sourceHandle}-${partId}${first.pinId}`,
        target: partId,
        targetHandle: first.pinId,
        data: { waypoints: leftWaypoints, directPath: true },
        selected: false,
      },
      {
        ...edge,
        id: `${partId}${second.pinId}-${edge.target}${edge.targetHandle}`,
        source: partId,
        sourceHandle: second.pinId,
        data: { waypoints: rightWaypoints, directPath: true },
        selected: false,
      },
    ];
    inserted++;
  }

  return { nodes: nextNodes, edges: nextEdges, inserted };
}

/**
 * Wire-attach on place/drop:
 * 1) Two-pin parts: series break when both pins land on the same wire.
 * 2) Any remaining free pin on a rail: T-splice (I1 one leg, GND, IGBT gate, …).
 */
export function attachPartsToWires(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  partIds: readonly string[],
  hitTol = HIT_TOL,
): { nodes: Node<ComponentData>[]; edges: Edge[]; attached: number } {
  const ins = insertPartsOnWires(nodes, edges, partIds, hitTol);
  let ns = ins.inserted ? ins.nodes : nodes;
  let es = ins.inserted ? ins.edges : edges;

  const tee = splicePinsOntoWires(ns, es, partIds, hitTol);
  if (tee.spliced) {
    ns = tee.nodes;
    es = tee.edges;
  }

  if (ins.inserted || tee.spliced) {
    const collapsed = collapsePassThroughTips(ns, es);
    const pruned = pruneOrphanTips(collapsed.nodes, collapsed.edges);
    ns = pruned.nodes;
    es = pruned.edges;
  }
  return { nodes: ns, edges: es, attached: ins.inserted + tee.spliced };
}

/**
 * Seat a net-name label onto the nearest free part pin (same net as that pin).
 * Used when the join square lands on a device pin instead of a wire.
 */
export function attachNetNameToNearestPin(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  labelId: string,
  maxDist = 16,
): { nodes: Node<ComponentData>[]; edges: Edge[]; attached: boolean } {
  const label = nodes.find((n) => n.id === labelId);
  if (!label || label.data.kind !== "WIRELABEL") {
    return { nodes, edges, attached: false };
  }
  const pinId = COMPONENT_SPECS.WIRELABEL.pins[0]!.id;
  if (!pinIsFree(edges, labelId, pinId)) {
    return { nodes, edges, attached: false };
  }
  const pt = pinWorldPoint(label, pinId);
  if (!pt) return { nodes, edges, attached: false };

  const candidates = nodes.filter(
    (n) =>
      n.id !== labelId &&
      n.data.kind !== "TIP" &&
      n.data.kind !== "WIRELABEL",
  );
  const hit = findNearestPin(candidates, pt, { maxDist });
  if (!hit) return { nodes, edges, attached: false };

  const seated = snapPartPinToJoin(label, pinId, hit.point);
  const nextNodes = nodes.map((n) => (n.id === labelId ? seated : n));
  const edgeId = `${labelId}${pinId}-${hit.nodeId}${hit.pinId}`;
  const nextEdges = [
    ...edges,
    {
      id: edgeId,
      type: "schematic" as const,
      source: labelId,
      sourceHandle: pinId,
      target: hit.nodeId,
      targetHandle: hit.pinId,
      data: { waypoints: [], directPath: true },
    },
  ];
  return { nodes: nextNodes, edges: nextEdges, attached: true };
}

/**
 * T-junction splice: each free pin that lands on a wire mid-rail splits that
 * wire and attaches the pin. Single-pin parts (GND) and multi-pin parts (each
 * pin independently) use the same logic; series two-pin insert is separate.
 *
 * Multi-pin follow-up: after one pin of a BJT/IGBT T-splices a rail, a sibling
 * pin may still sit mid-rail on the stub that ends at that first pin. Those
 * edges used to be skipped (`source/target === partId`), leaving a hollow
 * square on a wire that looks connected. Attach the free pin to the external
 * half only — never add a pin↔pin short across the body.
 */
export function splicePinsOntoWires(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  partIds: readonly string[],
  hitTol = HIT_TOL,
): { nodes: Node<ComponentData>[]; edges: Edge[]; spliced: number } {
  let nextNodes = nodes;
  let nextEdges = edges;
  let spliced = 0;

  for (const partId of partIds) {
    const pins = (() => {
      const p = nextNodes.find((n) => n.id === partId);
      return p && p.data.kind !== "TIP" ? COMPONENT_SPECS[p.data.kind].pins : [];
    })();

    for (const pin of pins) {
      const part = nextNodes.find((n) => n.id === partId);
      if (!part || part.data.kind === "TIP") continue;
      if (!pinIsFree(nextEdges, partId, pin.id)) continue;
      const pt = pinWorldPoint(part, pin.id);
      if (!pt) continue;
      let best: {
        edge: Edge;
        poly: Point[];
        hit: ReturnType<typeof projectOntoPolyline>;
      } | null = null;

      for (const edge of nextEdges) {
        // Already wired on this exact pin — ignore.
        if (
          (edge.source === partId && edge.sourceHandle === pin.id) ||
          (edge.target === partId && edge.targetHandle === pin.id)
        ) {
          continue;
        }
        const candidate = bestPinHitOnEdge(nextNodes, edge, pt, hitTol);
        if (!candidate) continue;
        if (best && candidate.hit.dist >= best.hit.dist) continue;
        best = candidate;
      }
      if (!best) continue;

      const join = joinOnSegment(best.poly, best.hit.segIndex, pt);
      const seated = snapPartPinToJoin(part, pin.id, join);
      nextNodes = nextNodes.map((n) => (n.id === partId ? seated : n));
      const pinNow = pinWorldPoint(seated, pin.id) ?? join;
      const at = joinOnSegment(best.poly, best.hit.segIndex, pinNow);

      const before = pathUntil(best.poly, best.hit.segIndex, at);
      const after = pathFrom(best.poly, best.hit.segIndex, at);
      const edge = best.edge;

      const samePartOtherPin =
        (edge.source === partId && edge.sourceHandle !== pin.id) ||
        (edge.target === partId && edge.targetHandle !== pin.id);

      if (samePartOtherPin) {
        // External ↔ otherPin, with this pin mid-rail: keep only external ↔ pin.
        if (edge.target === partId) {
          nextEdges = [
            ...nextEdges.filter((e) => e.id !== edge.id),
            {
              ...edge,
              id: `${edge.source}${edge.sourceHandle}-${partId}${pin.id}`,
              target: partId,
              targetHandle: pin.id,
              data: { waypoints: interiorWaypoints(before), directPath: true },
              selected: false,
            },
          ];
        } else {
          nextEdges = [
            ...nextEdges.filter((e) => e.id !== edge.id),
            {
              ...edge,
              id: `${partId}${pin.id}-${edge.target}${edge.targetHandle}`,
              source: partId,
              sourceHandle: pin.id,
              data: { waypoints: interiorWaypoints(after), directPath: true },
              selected: false,
            },
          ];
        }
      } else {
        nextEdges = [
          ...nextEdges.filter((e) => e.id !== edge.id),
          {
            ...edge,
            id: `${edge.source}${edge.sourceHandle}-${partId}${pin.id}`,
            target: partId,
            targetHandle: pin.id,
            data: { waypoints: interiorWaypoints(before), directPath: true },
            selected: false,
          },
          {
            ...edge,
            id: `${partId}${pin.id}-${edge.target}${edge.targetHandle}`,
            source: partId,
            sourceHandle: pin.id,
            data: { waypoints: interiorWaypoints(after), directPath: true },
            selected: false,
          },
        ];
      }
      spliced++;
    }
  }

  return { nodes: nextNodes, edges: nextEdges, spliced };
}
