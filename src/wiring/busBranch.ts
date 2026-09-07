/**
 * LTspice-like mid-wire branch: attach at the cursor's column on an H bus
 * (or row on a V bus), not the Euclidean-closest point (which sticks to a
 * nearby junction and forces a tiny jog before the next vertical).
 */
import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import {
  closestPointOnPolylineRaw,
  computeEdgePolyline,
  distToPolyline,
} from "./wireGeometry";
import { snapCoord, type Point } from "./orthogonal";

const TIP_SIZE = 8;

export type EdgeBranchTarget = {
  edgeId: string;
  point: Point;
  busAxis: "h" | "v";
  nodes: Node<ComponentData>[];
  edges: Edge[];
};

function tipPos(n: Node<ComponentData>): Point {
  return { x: n.position.x, y: n.position.y + TIP_SIZE / 2 };
}

/** Dominant axis of a polyline (longer total H vs V run). */
export function edgeDominantAxis(poly: Point[], grid: number): "h" | "v" | null {
  let hLen = 0;
  let vLen = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dy < 0.6) hLen += dx;
    else if (dx < 0.6) vLen += dy;
  }
  if (hLen < grid * 0.5 && vLen < grid * 0.5) return null;
  return hLen >= vLen ? "h" : "v";
}

/** Axis of the segment actually nearest the branch cursor. */
function nearestSegmentAxis(poly: Point[], cursor: Point): "h" | "v" | null {
  let best: { axis: "h" | "v"; distance: number } | null = null;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const horizontal = Math.abs(a.y - b.y) < 0.6;
    const vertical = Math.abs(a.x - b.x) < 0.6;
    if (!horizontal && !vertical) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t =
      lenSq < 0.01
        ? 0
        : Math.max(
            0,
            Math.min(1, ((cursor.x - a.x) * dx + (cursor.y - a.y) * dy) / lenSq),
          );
    const x = a.x + t * dx;
    const y = a.y + t * dy;
    const distance = Math.hypot(cursor.x - x, cursor.y - y);
    if (!best || distance < best.distance) {
      best = { axis: horizontal ? "h" : "v", distance };
    }
  }
  return best?.axis ?? null;
}

/**
 * Point on `edgeId` where a rung should start: cursor column on H bus Y,
 * or cursor row on V bus X. Extends the bus if the column/row is past an end.
 */
export function resolveBranchOnEdge(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  edgeId: string,
  cursor: Point,
  grid: number,
): EdgeBranchTarget | null {
  const edge = edges.find((e) => e.id === edgeId);
  if (!edge) return null;
  const poly = computeEdgePolyline(nodes, edge);
  if (poly.length < 2) return null;

  // Use the run the user actually clicked. A global dominant-axis heuristic
  // is ambiguous on balanced L shapes and can attach the branch to the wrong
  // leg. Keep the old heuristic only as a degenerate fallback.
  const axis = nearestSegmentAxis(poly, cursor) ?? edgeDominantAxis(poly, grid);
  if (!axis) return null;

  let point: Point;
  if (axis === "h") {
    let bestY = poly[0]!.y;
    let bestDy = Infinity;
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i]!;
      const b = poly[i + 1]!;
      if (Math.abs(a.y - b.y) > 0.6) continue;
      const dy = Math.abs(cursor.y - a.y);
      if (dy < bestDy) {
        bestDy = dy;
        bestY = a.y;
      }
    }
    point = { x: snapCoord(cursor.x, grid), y: bestY };
  } else {
    let bestX = poly[0]!.x;
    let bestDx = Infinity;
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i]!;
      const b = poly[i + 1]!;
      if (Math.abs(a.x - b.x) > 0.6) continue;
      const dx = Math.abs(cursor.x - a.x);
      if (dx < bestDx) {
        bestDx = dx;
        bestX = a.x;
      }
    }
    point = { x: bestX, y: snapCoord(cursor.y, grid) };
  }

  // Keep the attach point on the rail. Column/row snap can land inside the
  // bbox but off a segment (L-shaped buses); projecting avoids a tip that
  // sits beside the wire and a rubber band that starts offset.
  point = closestPointOnPolylineRaw(poly, point);

  const extended = extendEdgeThroughPoint(nodes, edges, edgeId, point, axis);
  return {
    edgeId,
    point,
    busAxis: axis,
    nodes: extended.nodes,
    edges: extended.edges,
  };
}

/** Stretch a bus so `point` lies on it (move free TIP end or add waypoint). */
export function extendEdgeThroughPoint(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  edgeId: string,
  point: Point,
  axis: "h" | "v",
): { nodes: Node<ComponentData>[]; edges: Edge[] } {
  const edge = edges.find((e) => e.id === edgeId);
  if (!edge) return { nodes, edges };
  const poly = computeEdgePolyline(nodes, edge);
  if (poly.length < 2) return { nodes, edges };
  if (distToPolyline(poly, point) <= 1.5) return { nodes, edges };

  const nodesById = new Map(nodes.map((n) => [n.id, n] as const));
  let nextNodes = nodes;
  let nextEdges = edges;

  const moveTip = (id: string, at: Point) => {
    nextNodes = nextNodes.map((n) =>
      n.id === id
        ? { ...n, position: { x: at.x, y: at.y - TIP_SIZE / 2 } }
        : n,
    );
  };

  if (axis === "h") {
    const xs = poly.map((p) => p.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const y = point.y;
    if (point.x < minX - 0.5) {
      const src = nodesById.get(edge.source);
      const tgt = nodesById.get(edge.target);
      if (src?.data.kind === "TIP" && Math.abs(tipPos(src).x - minX) < 1) {
        moveTip(edge.source, { x: point.x, y });
      } else if (tgt?.data.kind === "TIP" && Math.abs(tipPos(tgt).x - minX) < 1) {
        moveTip(edge.target, { x: point.x, y });
      } else {
        const wps = ((edge.data as { waypoints?: Point[] } | undefined)?.waypoints ?? []).slice();
        wps.unshift({ x: point.x, y });
        nextEdges = nextEdges.map((e) =>
          e.id === edgeId ? { ...e, data: { ...(e.data as object), waypoints: wps } } : e,
        );
      }
    } else if (point.x > maxX + 0.5) {
      const src = nodesById.get(edge.source);
      const tgt = nodesById.get(edge.target);
      if (src?.data.kind === "TIP" && Math.abs(tipPos(src).x - maxX) < 1) {
        moveTip(edge.source, { x: point.x, y });
      } else if (tgt?.data.kind === "TIP" && Math.abs(tipPos(tgt).x - maxX) < 1) {
        moveTip(edge.target, { x: point.x, y });
      } else {
        const wps = ((edge.data as { waypoints?: Point[] } | undefined)?.waypoints ?? []).slice();
        wps.push({ x: point.x, y });
        nextEdges = nextEdges.map((e) =>
          e.id === edgeId ? { ...e, data: { ...(e.data as object), waypoints: wps } } : e,
        );
      }
    }
  } else {
    const ys = poly.map((p) => p.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const x = point.x;
    if (point.y < minY - 0.5) {
      const src = nodesById.get(edge.source);
      const tgt = nodesById.get(edge.target);
      if (src?.data.kind === "TIP" && Math.abs(tipPos(src).y - minY) < 1) {
        moveTip(edge.source, { x, y: point.y });
      } else if (tgt?.data.kind === "TIP" && Math.abs(tipPos(tgt).y - minY) < 1) {
        moveTip(edge.target, { x, y: point.y });
      } else {
        const wps = ((edge.data as { waypoints?: Point[] } | undefined)?.waypoints ?? []).slice();
        wps.unshift({ x, y: point.y });
        nextEdges = nextEdges.map((e) =>
          e.id === edgeId ? { ...e, data: { ...(e.data as object), waypoints: wps } } : e,
        );
      }
    } else if (point.y > maxY + 0.5) {
      const src = nodesById.get(edge.source);
      const tgt = nodesById.get(edge.target);
      if (src?.data.kind === "TIP" && Math.abs(tipPos(src).y - maxY) < 1) {
        moveTip(edge.source, { x, y: point.y });
      } else if (tgt?.data.kind === "TIP" && Math.abs(tipPos(tgt).y - maxY) < 1) {
        moveTip(edge.target, { x, y: point.y });
      } else {
        const wps = ((edge.data as { waypoints?: Point[] } | undefined)?.waypoints ?? []).slice();
        wps.push({ x, y: point.y });
        nextEdges = nextEdges.map((e) =>
          e.id === edgeId ? { ...e, data: { ...(e.data as object), waypoints: wps } } : e,
        );
      }
    }
  }

  return { nodes: nextNodes, edges: nextEdges };
}
