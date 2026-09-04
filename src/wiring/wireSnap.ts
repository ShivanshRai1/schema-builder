import type { Edge, Node } from "@xyflow/react";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import type { ComponentData, ComponentKind } from "../model/types";
import { pinWorldPoint } from "./pinGeometry";
import type { Point } from "./orthogonal";
import {
  closestPointOnPolylineRaw,
  computeEdgePolyline,
  distToPolyline,
} from "./wireGeometry";

/** Magnetic pull of a pin onto a nearby wire (LTspice-like). */
export const WIRE_PIN_SNAP = 10;

/**
 * Nudge a part so the nearest pin sits exactly on a nearby wire.
 * Corrects only the dominant axis (H wire → Y, V wire → X) so the part
 * does not slide along the rail — fixes "crossing / falling short" misses.
 */
export function snapPositionToWires(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  movingId: string,
  position: Point,
  threshold = WIRE_PIN_SNAP,
): Point {
  const moving = nodes.find((n) => n.id === movingId);
  if (!moving || moving.data.kind === "TIP") return position;
  const { internals, ...rest } = { ...moving, position } as Node<ComponentData> & {
    internals?: unknown;
  };
  void internals;
  const ghost = rest as Node<ComponentData>;
  return snapGhostToWires(ghost, position, nodes, edges, movingId, threshold);
}

export function snapDropPositionToWires(
  kind: ComponentKind,
  position: Point,
  nodes: Node<ComponentData>[],
  edges: Edge[],
  threshold = WIRE_PIN_SNAP,
): Point {
  if (kind === "TIP") return position;
  const ghost: Node<ComponentData> = {
    id: "__palette_drop__",
    type: "component",
    position,
    data: { kind, refdes: "", params: {} },
  };
  return snapGhostToWires(ghost, position, nodes, edges, null, threshold);
}

function snapGhostToWires(
  ghost: Node<ComponentData>,
  position: Point,
  nodes: Node<ComponentData>[],
  edges: Edge[],
  excludeId: string | null,
  threshold: number,
): Point {
  let best: { dx: number; dy: number; dist: number } | null = null;

  for (const pin of COMPONENT_SPECS[ghost.data.kind].pins) {
    const pt = pinWorldPoint(ghost, pin.id);
    if (!pt) continue;
    for (const edge of edges) {
      if (excludeId && (edge.source === excludeId || edge.target === excludeId)) {
        continue;
      }
      const poly = computeEdgePolyline(nodes, edge);
      if (poly.length < 2) continue;
      const d = distToPolyline(poly, pt);
      if (d > threshold || (best && d >= best.dist)) continue;
      const proj = closestPointOnPolylineRaw(poly, pt);
      const dx = proj.x - pt.x;
      const dy = proj.y - pt.y;
      // Axis lock: only pull perpendicular to the wire.
      if (Math.abs(dx) >= Math.abs(dy)) {
        best = { dx, dy: 0, dist: d };
      } else {
        best = { dx: 0, dy, dist: d };
      }
    }
  }

  if (!best) return position;
  return { x: position.x + best.dx, y: position.y + best.dy };
}
