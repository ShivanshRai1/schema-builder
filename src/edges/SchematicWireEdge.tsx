import { BaseEdge, Position, type EdgeProps, type Edge } from "@xyflow/react";
import {
  polylinePath,
  routeWirePoints,
  type PinSide,
  type Point,
} from "../wiring/orthogonal";

export type SchematicWireData = {
  waypoints?: Point[];
};

export type SchematicWireEdgeType = Edge<SchematicWireData>;

function positionToSide(pos: Position): PinSide {
  switch (pos) {
    case Position.Left:
      return "left";
    case Position.Right:
      return "right";
    case Position.Top:
      return "top";
    case Position.Bottom:
    default:
      return "bottom";
  }
}

/** User-authored orthogonal wire; endpoints are exact handle centers. */
export function SchematicWireEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
  selected,
}: EdgeProps<SchematicWireEdgeType>) {
  const start: Point = { x: sourceX, y: sourceY };
  const end: Point = { x: targetX, y: targetY };
  const waypoints = data?.waypoints ?? [];
  const points = routeWirePoints(
    start,
    end,
    waypoints,
    positionToSide(sourcePosition),
    positionToSide(targetPosition),
  );
  const path = polylinePath(points);

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      interactionWidth={24}
      style={{
        stroke: selected ? "var(--accent)" : "#c8d1dc",
        strokeWidth: selected ? 2.25 : 1.75,
        ...style,
      }}
    />
  );
}
