import {
  BaseEdge,
  useStore,
  type EdgeProps,
  type Edge,
  type Node,
} from "@xyflow/react";
import {
  orthogonalPolyline,
  polylinePath,
  routeWirePoints,
  type PinSide,
  type Point,
} from "../wiring/orthogonal";
import { pinWorldPoint, pinWorldSide } from "../wiring/pinGeometry";
import type { ComponentData } from "../model/types";

export type SchematicWireData = {
  waypoints?: Point[];
};

export type SchematicWireEdgeType = Edge<SchematicWireData>;

export type WireBendAction = never;

function fallbackPoint(x: number, y: number): Point {
  return { x, y };
}

function asSide(side: PinSide | null, fallback: PinSide): PinSide {
  return side ?? fallback;
}

function positionPropToSide(pos: string | undefined): PinSide {
  switch (pos) {
    case "left":
      return "left";
    case "right":
      return "right";
    case "top":
      return "top";
    case "bottom":
    default:
      return "bottom";
  }
}

/** User-authored orthogonal wire; endpoints follow rotated pin geometry. */
export function SchematicWireEdge({
  id,
  source,
  target,
  sourceHandleId,
  targetHandleId,
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
  const sourceNode = useStore((s) => {
    const n = s.nodeLookup.get(source) as Node<ComponentData> | undefined;
    if (!n) return undefined;
    return {
      node: n,
      key: `${n.position.x},${n.position.y},${n.measured?.width ?? 0},${n.measured?.height ?? 0},${n.data.rotation ?? 0}`,
    };
  }, (a, b) => a?.key === b?.key);
  const targetNode = useStore((s) => {
    const n = s.nodeLookup.get(target) as Node<ComponentData> | undefined;
    if (!n) return undefined;
    return {
      node: n,
      key: `${n.position.x},${n.position.y},${n.measured?.width ?? 0},${n.measured?.height ?? 0},${n.data.rotation ?? 0}`,
    };
  }, (a, b) => a?.key === b?.key);

  const start =
    (sourceNode && sourceHandleId
      ? pinWorldPoint(sourceNode.node, sourceHandleId)
      : null) ?? fallbackPoint(sourceX, sourceY);
  const end =
    (targetNode && targetHandleId
      ? pinWorldPoint(targetNode.node, targetHandleId)
      : null) ?? fallbackPoint(targetX, targetY);

  const sourceSide = asSide(
    sourceNode && sourceHandleId ? pinWorldSide(sourceNode.node, sourceHandleId) : null,
    positionPropToSide(String(sourcePosition)),
  );
  const targetSide = asSide(
    targetNode && targetHandleId ? pinWorldSide(targetNode.node, targetHandleId) : null,
    positionPropToSide(String(targetPosition)),
  );

  const waypoints = data?.waypoints ?? [];
  const srcIsTip = sourceNode?.node.data.kind === "TIP";
  const tgtIsTip = targetNode?.node.data.kind === "TIP";
  const tipWire = srcIsTip || tgtIsTip;
  const authored = tipWire || waypoints.length > 0;

  const points =
    authored
      ? orthogonalPolyline(
          waypoints.length ? [start, ...waypoints, end] : [start, end],
        )
      : routeWirePoints(start, end, waypoints, sourceSide, targetSide, 16);
  const path = polylinePath(points);

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      interactionWidth={24}
      style={{
        ...style,
        stroke: selected ? "#f0b429" : "#c8d1dc",
        strokeWidth: selected ? 2.6 : 1.75,
      }}
    />
  );
}
