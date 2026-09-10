/**
 * Toggle crossing hop ↔ junction square by rewriting the wire graph.
 *
 * - Hop (mid-mid cross, not joined) → shared TIP on both rails (connected).
 * - Junction TIP → merge straight through-runs so rails cross again (hop).
 */
import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import { collapseMicroBends } from "./wireMove";
import {
  computeEdgePolyline,
  polylineToStoredWaypoints,
} from "./wireGeometry";
import { pruneOrphanTips } from "./tipCleanup";
import type { Point } from "./orthogonal";

const TIP_SIZE = 8;
const END_EPS = 8;

function makeTip(
  id: string,
  at: Point,
): Node<ComponentData> {
  return {
    id,
    type: "component",
    position: { x: at.x, y: at.y - TIP_SIZE / 2 },
    data: { kind: "TIP", refdes: "", params: {} },
    style: { width: TIP_SIZE, height: TIP_SIZE },
    selected: false,
    draggable: false,
  };
}

function near(a: Point, b: Point, tol = 1.5): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tol;
}

function withoutAdjacentDuplicates(points: Point[]): Point[] {
  return points.filter(
    (p, i) =>
      i === 0 || Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y) > 0.5,
  );
}

function projectSplit(
  poly: Point[],
  branchPoint: Point,
): { splitIdx: number; splitPoint: Point } | null {
  if (poly.length < 2) return null;
  let splitIdx = 0;
  let bestD = Infinity;
  let splitPoint = poly[0]!;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t =
      lenSq < 0.01
        ? 0
        : ((branchPoint.x - a.x) * dx + (branchPoint.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const d = Math.hypot(branchPoint.x - cx, branchPoint.y - cy);
    if (d < bestD) {
      bestD = d;
      splitIdx = i;
      splitPoint = { x: cx, y: cy };
    }
  }
  if (bestD > 14) return null;
  // Refuse endpoint splits — those are pin/tip ends, not mid-rail joins.
  if (near(splitPoint, poly[0]!, END_EPS)) return null;
  if (near(splitPoint, poly[poly.length - 1]!, END_EPS)) return null;
  return { splitIdx, splitPoint };
}

function otherEnd(
  e: Edge,
  tipId: string,
): { nodeId: string; handle: string } | null {
  if (e.source === tipId) {
    if (!e.targetHandle) return null;
    return { nodeId: e.target, handle: e.targetHandle };
  }
  if (e.target === tipId) {
    if (!e.sourceHandle) return null;
    return { nodeId: e.source, handle: e.sourceHandle };
  }
  return null;
}

function orientPolyTowardTip(poly: Point[], tipAtStart: boolean): Point[] {
  if (poly.length < 2) return poly;
  return tipAtStart ? [...poly].reverse() : poly;
}

function orientPolyFromTip(poly: Point[], tipAtStart: boolean): Point[] {
  if (poly.length < 2) return poly;
  return tipAtStart ? poly : [...poly].reverse();
}

function isStraightPassThrough(poly1: Point[], poly2: Point[]): boolean {
  if (poly1.length < 2 || poly2.length < 2) return false;
  const tip = poly1[poly1.length - 1]!;
  const before = poly1[poly1.length - 2]!;
  const after = poly2[1]!;
  const h =
    Math.abs(before.y - tip.y) < 0.6 && Math.abs(after.y - tip.y) < 0.6;
  const v =
    Math.abs(before.x - tip.x) < 0.6 && Math.abs(after.x - tip.x) < 0.6;
  return h || v;
}

/**
 * Split one edge at `point`, attaching both halves to `tipId` (created if needed).
 */
export function splitEdgeOntoTip(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  edgeId: string,
  point: Point,
  tipId: string,
  newId: () => string,
): { nodes: Node<ComponentData>[]; edges: Edge[]; tipId: string; at: Point } | null {
  const edge = edges.find((e) => e.id === edgeId);
  if (!edge) return null;
  const poly = computeEdgePolyline(nodes, edge);
  const split = projectSplit(poly, point);
  if (!split) return null;
  const { splitIdx, splitPoint } = split;

  let nextNodes = nodes;
  let tip = nextNodes.find((n) => n.id === tipId);
  if (!tip) {
    tip = makeTip(tipId, splitPoint);
    nextNodes = [...nextNodes, tip];
  } else if (tip.data.kind !== "TIP") {
    return null;
  } else {
    // Seat existing tip on the projected join.
    nextNodes = nextNodes.map((n) =>
      n.id === tipId
        ? { ...n, position: { x: splitPoint.x, y: splitPoint.y - TIP_SIZE / 2 } }
        : n,
    );
  }

  const beforePath = withoutAdjacentDuplicates([
    ...poly.slice(0, splitIdx + 1),
    splitPoint,
  ]);
  const afterPath = withoutAdjacentDuplicates([
    splitPoint,
    ...poly.slice(splitIdx + 1),
  ]);
  if (beforePath.length < 2 || afterPath.length < 2) return null;

  const beforeBranch = beforePath.slice(1, -1);
  const afterBranch = afterPath.slice(1, -1);
  const uid = newId();

  const nextEdges = [
    ...edges.filter((e) => e.id !== edgeId),
    {
      ...edge,
      id: `${edge.source}${edge.sourceHandle}-${tipId}t-${uid}a`,
      target: tipId,
      targetHandle: "t",
      data: { waypoints: beforeBranch, directPath: true },
      selected: false,
    },
    {
      ...edge,
      id: `${tipId}t-${edge.target}${edge.targetHandle}-${uid}b`,
      source: tipId,
      sourceHandle: "t",
      data: { waypoints: afterBranch, directPath: true },
      selected: false,
    },
  ];

  return { nodes: nextNodes, edges: nextEdges, tipId, at: splitPoint };
}

/**
 * Turn a crossing hop into a connected junction: both rails share one TIP.
 */
export function joinWiresAtCrossing(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  edgeIdA: string,
  edgeIdB: string,
  point: Point,
  newId: () => string,
): { nodes: Node<ComponentData>[]; edges: Edge[]; tipId: string } | null {
  if (!edgeIdA || !edgeIdB || edgeIdA === edgeIdB) return null;
  if (!edges.some((e) => e.id === edgeIdA) || !edges.some((e) => e.id === edgeIdB)) {
    return null;
  }

  const tipId = newId();
  const first = splitEdgeOntoTip(nodes, edges, edgeIdA, point, tipId, newId);
  if (!first) return null;
  const second = splitEdgeOntoTip(
    first.nodes,
    first.edges,
    edgeIdB,
    first.at,
    tipId,
    newId,
  );
  if (!second) return null;

  // Must be a real multi-leg join (4 halves for a + cross).
  const deg = second.edges.reduce(
    (n, e) => n + (e.source === tipId || e.target === tipId ? 1 : 0),
    0,
  );
  if (deg < 3) return null;

  return { nodes: second.nodes, edges: second.edges, tipId };
}

/**
 * Merge one straight through-pair on a tip (H or V). Leaves other tip edges alone.
 */
function mergeStraightPairOnTip(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  tipId: string,
  e1: Edge,
  e2: Edge,
  mergeTag: number,
): { nodes: Node<ComponentData>[]; edges: Edge[] } | null {
  const a = otherEnd(e1, tipId);
  const b = otherEnd(e2, tipId);
  if (!a || !b || a.nodeId === tipId || b.nodeId === tipId) return null;
  if (a.nodeId === b.nodeId && a.handle === b.handle) return null;

  const poly1raw = computeEdgePolyline(nodes, e1);
  const poly2raw = computeEdgePolyline(nodes, e2);
  if (poly1raw.length < 2 || poly2raw.length < 2) return null;

  const poly1 = orientPolyTowardTip(poly1raw, e1.source === tipId);
  const poly2 = orientPolyFromTip(poly2raw, e2.source === tipId);
  if (!isStraightPassThrough(poly1, poly2)) return null;

  const mergedPoly = collapseMicroBends([...poly1.slice(0, -1), ...poly2]);
  if (mergedPoly.length < 2) return null;

  const newEdge: Edge = {
    id: `${a.nodeId}${a.handle}-${b.nodeId}${b.handle}-u${mergeTag}`,
    type: "schematic",
    source: a.nodeId,
    sourceHandle: a.handle,
    target: b.nodeId,
    targetHandle: b.handle,
    data: { waypoints: [], directPath: true },
    selected: Boolean(e1.selected || e2.selected),
  };
  const waypoints = polylineToStoredWaypoints(nodes, newEdge, mergedPoly);
  newEdge.data = { waypoints, directPath: true };

  let nextEdges = edges.filter((e) => e.id !== e1.id && e.id !== e2.id);
  nextEdges = [...nextEdges, newEdge];

  const stillUsed = nextEdges.some((e) => e.source === tipId || e.target === tipId);
  const nextNodes = stillUsed ? nodes : nodes.filter((n) => n.id !== tipId);
  return { nodes: nextNodes, edges: nextEdges };
}

/**
 * Turn a filled junction into a crossing hop: rejoin straight through-runs so
 * rails pass without sharing a TIP. A leftover branch keeps a free tip (looks
 * like a hop where it meets the restored rail).
 */
export function unjoinJunctionToCrossing(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  tipId: string,
): { nodes: Node<ComponentData>[]; edges: Edge[] } | null {
  const tip = nodes.find((n) => n.id === tipId);
  if (!tip || tip.data.kind !== "TIP") return null;

  let nextNodes = nodes;
  let nextEdges = edges;
  let merged = 0;
  let guard = 0;

  while (guard++ < 8) {
    const onTip = nextEdges.filter((e) => e.source === tipId || e.target === tipId);
    if (onTip.length < 2) break;

    let did = false;
    for (let i = 0; i < onTip.length; i++) {
      for (let j = i + 1; j < onTip.length; j++) {
        const result = mergeStraightPairOnTip(
          nextNodes,
          nextEdges,
          tipId,
          onTip[i]!,
          onTip[j]!,
          merged,
        );
        if (!result) continue;
        nextNodes = result.nodes;
        nextEdges = result.edges;
        merged++;
        did = true;
        break;
      }
      if (did) break;
    }
    if (!did) break;
    if (!nextNodes.some((n) => n.id === tipId)) break;
  }

  if (merged === 0) return null;

  const pruned = pruneOrphanTips(nextNodes, nextEdges);
  return { nodes: pruned.nodes, edges: pruned.edges };
}
