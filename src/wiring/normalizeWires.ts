import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import type { Point } from "./orthogonal";
import { dist, pointsEqual } from "./orthogonal";
import { collapseMicroBends } from "./wireMove";
import { computeEdgePolyline, polylineToStoredWaypoints } from "./wireGeometry";
import { pruneOrphanTips, collapsePassThroughTips } from "./tipCleanup";
import { findWireJunctions } from "./junctions";
import { pinWorldPoint } from "./pinGeometry";

/** Max length (flow units) for an auto-removable dangling stub off a junction. */
export const SHORT_STUB_MAX_LEN = 48;

function waypointsEqual(a: Point[], b: Point[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!pointsEqual(a[i]!, b[i]!)) return false;
  }
  return true;
}

function tipDegree(edges: Edge[]): Map<string, number> {
  const deg = new Map<string, number>();
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
  }
  return deg;
}

/**
 * True if this edge is a dangling/trailing stub:
 * - one free TIP (degree 1) on either end, OR
 * - tip↔tip floating segment (both tips degree 1).
 * Main connected wires (pin↔pin, pin↔junction, junction↔junction) return false.
 */
export function isDanglingOrTrailingEdge(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  edge: Edge,
): boolean {
  const nodesById = new Map(nodes.map((n) => [n.id, n] as const));
  const deg = tipDegree(edges);
  const src = nodesById.get(edge.source);
  const tgt = nodesById.get(edge.target);
  if (!src || !tgt) return false;

  const srcTip = src.data.kind === "TIP";
  const tgtTip = tgt.data.kind === "TIP";
  const srcDeg = deg.get(edge.source) ?? 0;
  const tgtDeg = deg.get(edge.target) ?? 0;

  // Floating tip↔tip wire (both ends free).
  if (srcTip && tgtTip && srcDeg === 1 && tgtDeg === 1) return true;

  // Stub off a junction or pin: exactly one free tip.
  if (srcTip && srcDeg === 1) return true;
  if (tgtTip && tgtDeg === 1) return true;

  return false;
}

/** Short leftover stub — safe to delete in one Esc. Long dangling wires must peel. */
export function isShortDanglingStub(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  edge: Edge,
  maxLen = SHORT_STUB_MAX_LEN,
): boolean {
  if (!isDanglingOrTrailingEdge(nodes, edges, edge)) return false;
  const waypoints =
    ((edge.data as { waypoints?: Point[] } | undefined)?.waypoints) ?? [];
  const poly = computeEdgePolyline(nodes, edge);
  if (poly.length < 2) return true;
  const len = polylineLength(poly);
  // Micro-jog leftovers (tiny L from off-grid pins) still count as short stubs.
  // Longer paths with real authored bends must peel instead of one-shot delete.
  if (waypoints.length > 1 && len > maxLen) return false;
  return len <= maxLen;
}

/** Distance along polyline from start to the closest point on the poly to `p`. */
function distAlongPoly(poly: Point[], p: Point): number {
  let bestD = Infinity;
  let bestAlong = 0;
  let along = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const segLen = dist(a, b);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq < 0.01 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < bestD) {
      bestD = d;
      bestAlong = along + t * segLen;
    }
    along += segLen;
  }
  return bestAlong;
}

function pointAlongPoly(poly: Point[], targetAlong: number): Point {
  let along = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const segLen = dist(a, b);
    if (along + segLen >= targetAlong - 0.01) {
      const t = segLen < 0.01 ? 0 : (targetAlong - along) / segLen;
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    }
    along += segLen;
  }
  return poly[poly.length - 1]!;
}

/**
 * Interior join points on this edge: places where other same-net wires T-join
 * onto this wire's path (not the edge's own endpoints).
 */
export function findInteriorJoinsOnEdge(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  edge: Edge,
): Point[] {
  const poly = computeEdgePolyline(nodes, edge);
  if (poly.length < 2) return [];

  const marks = findWireJunctions(nodes, edges);
  const total = polylineLength(poly);
  const joins: Point[] = [];

  const consider = (p: Point) => {
    const along = distAlongPoly(poly, p);
    // Must sit on the poly, and not at either endpoint.
    const closest = pointAlongPoly(poly, along);
    if (dist(closest, p) > 8) return;
    if (along < 8 || along > total - 8) return;
    if (joins.some((j) => dist(j, closest) < 4)) return;
    joins.push(closest);
  };

  for (const j of marks.junctions) consider(j);
  // Also treat visual crossings as trim points — stubs past a cross should go too.
  for (const c of marks.crossings) consider(c);

  // Also: other edge endpoints that land on this poly interior.
  for (const e of edges) {
    if (e.id === edge.id) continue;
    if (!e.sourceHandle || !e.targetHandle) continue;
    const src = nodes.find((n) => n.id === e.source);
    const tgt = nodes.find((n) => n.id === e.target);
    if (!src || !tgt) continue;
    const a = pinWorldPoint(src, e.sourceHandle);
    const b = pinWorldPoint(tgt, e.targetHandle);
    if (a) consider(a);
    if (b) consider(b);
  }

  // Geometric H×V crossings with every other wire (same or different net).
  // Catches a vertical that only visually meets horizontals mid-run.
  for (const e of edges) {
    if (e.id === edge.id) continue;
    const other = computeEdgePolyline(nodes, e);
    if (other.length < 2) continue;
    for (let i = 0; i < poly.length - 1; i++) {
      const a1 = poly[i]!;
      const a2 = poly[i + 1]!;
      const aH = Math.abs(a1.y - a2.y) < 0.6;
      const aV = Math.abs(a1.x - a2.x) < 0.6;
      if (!aH && !aV) continue;
      for (let j = 0; j < other.length - 1; j++) {
        const b1 = other[j]!;
        const b2 = other[j + 1]!;
        const bH = Math.abs(b1.y - b2.y) < 0.6;
        const bV = Math.abs(b1.x - b2.x) < 0.6;
        if (aH && bV) {
          const x = b1.x;
          const y = a1.y;
          const onA =
            x >= Math.min(a1.x, a2.x) - 1 && x <= Math.max(a1.x, a2.x) + 1;
          const onB =
            y >= Math.min(b1.y, b2.y) - 1 && y <= Math.max(b1.y, b2.y) + 1;
          if (onA && onB) consider({ x, y });
        } else if (aV && bH) {
          const x = a1.x;
          const y = b1.y;
          const onA =
            y >= Math.min(a1.y, a2.y) - 1 && y <= Math.max(a1.y, a2.y) + 1;
          const onB =
            x >= Math.min(b1.x, b2.x) - 1 && x <= Math.max(b1.x, b2.x) + 1;
          if (onA && onB) consider({ x, y });
        }
      }
    }
  }

  return joins;
}

/**
 * Retract free TIP ends of an edge back to the outermost interior joins.
 * This turns "stub above + middle + stub below" into just the middle segment
 * without deleting the useful connected run.
 */
export function trimEdgeEndsToJoins(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  edge: Edge,
): { nodes: Node<ComponentData>[]; edge: Edge; changed: boolean } {
  const joins = findInteriorJoinsOnEdge(nodes, edges, edge);
  if (joins.length === 0) return { nodes, edge, changed: false };

  const poly = computeEdgePolyline(nodes, edge);
  if (poly.length < 2) return { nodes, edge, changed: false };

  const total = polylineLength(poly);
  const ranked = joins
    .map((p) => ({ p, along: distAlongPoly(poly, p) }))
    .sort((a, b) => a.along - b.along);
  const first = ranked[0]!;
  const last = ranked[ranked.length - 1]!;

  const deg = tipDegree(edges);
  const nodesById = new Map(nodes.map((n) => [n.id, n] as const));
  const src = nodesById.get(edge.source);
  const tgt = nodesById.get(edge.target);
  const srcFree = src?.data.kind === "TIP" && (deg.get(edge.source) ?? 0) === 1;
  const tgtFree = tgt?.data.kind === "TIP" && (deg.get(edge.target) ?? 0) === 1;

  // How far past the outermost join does each free tip stick out?
  const startOvershoot = first.along; // tip at 0 → join at first.along
  const endOvershoot = total - last.along;

  if (startOvershoot < 8 && endOvershoot < 8) {
    return { nodes, edge, changed: false };
  }

  // If retracting both ends would collapse the wire to ~zero, don't — let Esc peel/delete.
  const remaining = last.along - first.along;
  if (remaining < 8) return { nodes, edge, changed: false };

  let nextNodes = nodes;
  let changed = false;
  const newStart = srcFree && startOvershoot >= 8 ? first.p : poly[0]!;
  const newEnd = tgtFree && endOvershoot >= 8 ? last.p : poly[poly.length - 1]!;

  if (srcFree && startOvershoot >= 8) {
    nextNodes = nextNodes.map((n) =>
      n.id === edge.source
        ? { ...n, position: { x: newStart.x, y: newStart.y - 4 } }
        : n,
    );
    changed = true;
  }
  if (tgtFree && endOvershoot >= 8) {
    nextNodes = nextNodes.map((n) =>
      n.id === edge.target
        ? { ...n, position: { x: newEnd.x, y: newEnd.y - 4 } }
        : n,
    );
    changed = true;
  }

  if (!changed) return { nodes, edge, changed: false };

  // Straight run between the (possibly new) tip positions.
  const nextEdge = {
    ...edge,
    data: { ...(edge.data as object), waypoints: [] as Point[] },
  };
  return { nodes: nextNodes, edge: nextEdge, changed: true };
}

/**
 * Delete dangling/trailing stub edges (and their free tips), optionally
 * limited to stubs attached to given tip ids or a specific set of edge ids.
 */
export function removeDanglingOrTrailingEdges(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  opts?: { atTipIds?: Iterable<string>; onlyEdgeIds?: Iterable<string> },
): { nodes: Node<ComponentData>[]; edges: Edge[]; removed: number } {
  const at = opts?.atTipIds ? new Set(opts.atTipIds) : null;
  const only = opts?.onlyEdgeIds ? new Set(opts.onlyEdgeIds) : null;

  const stubs = edges.filter((e) => {
    if (only && !only.has(e.id)) return false;
    if (!isDanglingOrTrailingEdge(nodes, edges, e)) return false;
    if (at) {
      return at.has(e.source) || at.has(e.target);
    }
    return true;
  });

  if (!stubs.length) return { nodes, edges, removed: 0 };

  const dropEdge = new Set(stubs.map((e) => e.id));
  const nodesById = new Map(nodes.map((n) => [n.id, n] as const));
  const deg = tipDegree(edges);
  const dropTip = new Set<string>();

  for (const e of stubs) {
    const src = nodesById.get(e.source);
    const tgt = nodesById.get(e.target);
    if (src?.data.kind === "TIP" && (deg.get(e.source) ?? 0) === 1) dropTip.add(e.source);
    if (tgt?.data.kind === "TIP" && (deg.get(e.target) ?? 0) === 1) dropTip.add(e.target);
  }

  const nextEdges = edges.filter((e) => !dropEdge.has(e.id));
  const nextNodes = nodes.filter((n) => !dropTip.has(n.id));
  const pruned = pruneOrphanTips(nextNodes, nextEdges);
  const collapsed = collapsePassThroughTips(pruned.nodes, pruned.edges);
  return { nodes: collapsed.nodes, edges: collapsed.edges, removed: stubs.length };
}

function polylineLength(pts: Point[]): number {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    len += dist(pts[i]!, pts[i + 1]!);
  }
  return len;
}

/**
 * Drop a short end "nub" (tiny L into a tip).
 * Pattern: … → long run → short stub → tip.
 * Returns the shortened polyline where the tip endpoint moves onto the corner
 * (caller must move the TIP node to match the new endpoint).
 */
export function trimTrailingNubs(
  poly: Point[],
  opts?: { maxNub?: number; minLong?: number },
): Point[] | null {
  const maxNub = opts?.maxNub ?? SHORT_STUB_MAX_LEN;
  const minLong = opts?.minLong ?? 16;
  if (poly.length < 3) return null;

  let next = poly.map((p) => ({ ...p }));
  let changed = false;
  let guard = 0;

  while (guard++ < 16 && next.length >= 3) {
    const n = next.length;
    const lastShort = dist(next[n - 2]!, next[n - 1]!);
    const lastLong = dist(next[n - 3]!, next[n - 2]!);
    const firstShort = dist(next[0]!, next[1]!);
    const firstLong = dist(next[1]!, next[2]!);

    const endIsNub =
      lastShort > 0.5 && lastShort <= maxNub && lastLong >= minLong && lastShort < lastLong;
    const startIsNub =
      firstShort > 0.5 && firstShort <= maxNub && firstLong >= minLong && firstShort < firstLong;

    let trimmed = false;
    if (endIsNub && (!startIsNub || lastShort <= firstShort)) {
      // Drop the tip endpoint: [..., A, B, tip] → [..., A, B] (tip moves to B)
      next = next.slice(0, n - 1);
      trimmed = true;
    } else if (startIsNub) {
      // Drop the start tip endpoint: [tip, B, C, ...] → [B, C, ...]
      next = next.slice(1);
      trimmed = true;
    }

    if (!trimmed) break;
    changed = true;
    next = collapseMicroBends(next, 10);
  }

  return changed ? next : null;
}

/**
 * Clean trailing nubs on one edge.
 * May rewrite waypoints and/or nudge TIP node positions to the cleaned endpoints.
 */
export function cleanEdgeTrailingNubs(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  edge: Edge,
): {
  edge: Edge;
  nodes: Node<ComponentData>[];
  changed: boolean;
} {
  void edges;
  const waypoints = ((edge.data as { waypoints?: Point[] } | undefined)?.waypoints ??
    []) as Point[];
  const poly = computeEdgePolyline(nodes, edge);
  if (poly.length < 2) return { edge, nodes, changed: false };

  const nodesById = new Map(nodes.map((n) => [n.id, n] as const));
  const src = nodesById.get(edge.source);
  const tgt = nodesById.get(edge.target);
  const srcIsTip = src?.data.kind === "TIP";
  const tgtIsTip = tgt?.data.kind === "TIP";

  let nextNodes = nodes;
  let working = poly.map((p) => ({ ...p }));
  let changed = false;

  const trimmed = trimTrailingNubs(working);
  if (trimmed && trimmed.length >= 2) {
    const oldStart = working[0]!;
    const oldEnd = working[working.length - 1]!;
    const newStart = trimmed[0]!;
    const newEnd = trimmed[trimmed.length - 1]!;

    // Move TIP nodes to match shortened endpoints (peel the nub, keep the long run).
    nextNodes = nextNodes.map((n) => {
      if (srcIsTip && n.id === edge.source && !pointsEqual(oldStart, newStart)) {
        return { ...n, position: { x: newStart.x, y: newStart.y - 4 } };
      }
      if (tgtIsTip && n.id === edge.target && !pointsEqual(oldEnd, newEnd)) {
        return { ...n, position: { x: newEnd.x, y: newEnd.y - 4 } };
      }
      return n;
    });
    working = trimmed;
    changed = true;
  } else {
    // Tip↔tip nearly aligned but ortho routing inserts a tiny L — snap tips onto axis.
    if (srcIsTip && tgtIsTip && working.length >= 2) {
      const a = working[0]!;
      const b = working[working.length - 1]!;
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      if (dy >= 16 && dx > 0.5 && dx <= SHORT_STUB_MAX_LEN) {
        const x = (a.x + b.x) / 2;
        nextNodes = nextNodes.map((n) => {
          if (n.id === edge.source) return { ...n, position: { x, y: a.y - 4 } };
          if (n.id === edge.target) return { ...n, position: { x, y: b.y - 4 } };
          return n;
        });
        changed = true;
      } else if (dx >= 16 && dy > 0.5 && dy <= SHORT_STUB_MAX_LEN) {
        const y = (a.y + b.y) / 2;
        nextNodes = nextNodes.map((n) => {
          if (n.id === edge.source) return { ...n, position: { x: a.x, y: y - 4 } };
          if (n.id === edge.target) return { ...n, position: { x: b.x, y: y - 4 } };
          return n;
        });
        changed = true;
      }
    }

    const collapsed = collapseMicroBends(
      computeEdgePolyline(nextNodes, {
        ...edge,
        data: { ...(edge.data as object), waypoints },
      }),
      10,
    );
    if (collapsed.length >= 2 && !waypointsEqual(working, collapsed)) {
      working = collapsed;
      changed = true;
    } else if (changed) {
      working = computeEdgePolyline(nextNodes, {
        ...edge,
        data: { ...(edge.data as object), waypoints: [] },
      });
    }
  }

  if (!changed) return { edge, nodes, changed: false };

  const nextWaypoints = polylineToStoredWaypoints(nextNodes, edge, working);
  return {
    edge: { ...edge, data: { ...(edge.data as object), waypoints: nextWaypoints } },
    nodes: nextNodes,
    changed: true,
  };
}

/**
 * A dangling stub off a junction: one end is a free TIP (degree 1),
 * the other end is a junction TIP (degree >= 2). These are the short
 * leftover "tails" left after mid-wire branching / reconnects.
 */
export function findDanglingJunctionStubs(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  opts?: { maxLen?: number; onlyShort?: boolean },
): Edge[] {
  const maxLen = opts?.maxLen ?? SHORT_STUB_MAX_LEN;
  const onlyShort = opts?.onlyShort ?? true;
  const nodesById = new Map(nodes.map((n) => [n.id, n] as const));
  const deg = tipDegree(edges);
  const out: Edge[] = [];

  for (const e of edges) {
    const src = nodesById.get(e.source);
    const tgt = nodesById.get(e.target);
    if (!src || !tgt) continue;
    if (src.data.kind !== "TIP" || tgt.data.kind !== "TIP") continue;

    const srcDeg = deg.get(e.source) ?? 0;
    const tgtDeg = deg.get(e.target) ?? 0;

    // Exactly one free tip, other side is a junction (2+ wires).
    const freeIsSrc = srcDeg === 1 && tgtDeg >= 2;
    const freeIsTgt = tgtDeg === 1 && srcDeg >= 2;
    if (!freeIsSrc && !freeIsTgt) continue;

    // Move-mode freeze tips must stay until the part is dropped back on them.
    const freeNode = freeIsSrc ? src : tgt;
    if (freeNode.data.params?.moveAnchor === "1") continue;

    if (onlyShort) {
      const poly = computeEdgePolyline(nodes, e);
      if (poly.length < 2) continue;
      if (polylineLength(poly) > maxLen) continue;
    }

    out.push(e);
  }

  return out;
}

/**
 * Remove dangling junction stubs (and their free TIP), then prune orphans.
 * Does not change connectivity of the main net — only drops free tails.
 * If `atTipIds` is set, only stubs attached to those junction TIP ids are removed.
 */
export function pruneDanglingJunctionStubs(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  opts?: { maxLen?: number; onlyShort?: boolean; atTipIds?: Iterable<string> },
): { nodes: Node<ComponentData>[]; edges: Edge[]; removed: number } {
  const at = opts?.atTipIds ? new Set(opts.atTipIds) : null;
  let stubs = findDanglingJunctionStubs(nodes, edges, opts);
  if (at) {
    stubs = stubs.filter((s) => at.has(s.source) || at.has(s.target));
  }
  if (!stubs.length) return { nodes, edges, removed: 0 };

  const dropEdge = new Set(stubs.map((e) => e.id));
  const nodesById = new Map(nodes.map((n) => [n.id, n] as const));
  const deg = tipDegree(edges);
  const dropTip = new Set<string>();

  for (const e of stubs) {
    const srcDeg = deg.get(e.source) ?? 0;
    const tgtDeg = deg.get(e.target) ?? 0;
    if (srcDeg === 1 && nodesById.get(e.source)?.data.kind === "TIP") dropTip.add(e.source);
    if (tgtDeg === 1 && nodesById.get(e.target)?.data.kind === "TIP") dropTip.add(e.target);
  }

  const nextEdges = edges.filter((e) => !dropEdge.has(e.id));
  const nextNodes = nodes.filter((n) => !dropTip.has(n.id));
  const pruned = pruneOrphanTips(nextNodes, nextEdges);
  const collapsed = collapsePassThroughTips(pruned.nodes, pruned.edges);
  return { nodes: collapsed.nodes, edges: collapsed.edges, removed: stubs.length };
}

/**
 * Collapse tiny orthogonal jogs / trailing nubs and rewrite edge waypoints.
 * Also removes short dangling stubs hanging off junction TIPs.
 * Only touches edges that already have authored waypoints or touch TIP nodes.
 */
export function normalizeWires(
  nodes: Node<ComponentData>[],
  edges: Edge[],
): { nodes: Node<ComponentData>[]; edges: Edge[] } {
  const nodesById = new Map(nodes.map((n) => [n.id, n] as const));

  let nextNodes = nodes;
  let nextEdges = edges;

  for (const e of edges) {
    const waypoints = ((e.data as { waypoints?: Point[] } | undefined)?.waypoints ??
      []) as Point[];

    const src = nodesById.get(e.source);
    const tgt = nodesById.get(e.target);
    const srcIsTip = src?.data.kind === "TIP";
    const tgtIsTip = tgt?.data.kind === "TIP";

    // Don't touch pure pin→pin edges that have no stored waypoints.
    if (!srcIsTip && !tgtIsTip && waypoints.length === 0) continue;

    const cur = nextEdges.find((x) => x.id === e.id) ?? e;
    const { edge, nodes: ns, changed } = cleanEdgeTrailingNubs(nextNodes, nextEdges, cur);
    if (!changed) continue;
    nextNodes = ns;
    nextEdges = nextEdges.map((x) => (x.id === e.id ? edge : x));
  }

  const pruned = pruneOrphanTips(nextNodes, nextEdges);
  const stubs = pruneDanglingJunctionStubs(pruned.nodes, pruned.edges, {
    onlyShort: true,
  });
  // Heal rails split by a mid-wire branch after the branch stub is gone.
  const collapsed = collapsePassThroughTips(stubs.nodes, stubs.edges);
  return { nodes: collapsed.nodes, edges: collapsed.edges };
}
