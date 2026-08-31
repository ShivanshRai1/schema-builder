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
  type Point,
} from "../wiring/orthogonal";
import { computeEdgePolyline } from "../wiring/wireGeometry";
import type { ComponentData } from "../model/types";

export type SchematicWireData = {
  waypoints?: Point[];
};

export type SchematicWireEdgeType = Edge<SchematicWireData>;

export type WireBendAction = never;

function fallbackPoint(x: number, y: number): Point {
  return { x, y };
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

  const points =
    sourceNode && targetNode
      ? computeEdgePolyline(
          [sourceNode.node, targetNode.node],
          {
            id,
            type: "schematic",
            source,
            target,
            sourceHandle: sourceHandleId,
            targetHandle: targetHandleId,
            data,
          },
        )
      : orthogonalPolyline([
          fallbackPoint(sourceX, sourceY),
          fallbackPoint(targetX, targetY),
        ]);
  const path = polylinePath(points);

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      interactionWidth={32}
      style={{
        ...style,
        stroke: selected ? "#f0b429" : "#c8d1dc",
        strokeWidth: selected ? 2.6 : 1.75,
      }}
    />
  );
}
