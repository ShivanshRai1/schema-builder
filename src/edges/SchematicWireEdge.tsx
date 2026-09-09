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
  /** Click-selected H/V run only (not the whole snake). Marquee leaves this unset. */
  selectedSegIndex?: number;
  directPath?: boolean;
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
      key: `${n.position.x},${n.position.y},${n.measured?.width ?? 0},${n.measured?.height ?? 0},${n.data.rotation ?? 0},${n.data.kind}`,
    };
  }, (a, b) => a?.key === b?.key);
  const targetNode = useStore((s) => {
    const n = s.nodeLookup.get(target) as Node<ComponentData> | undefined;
    if (!n) return undefined;
    return {
      node: n,
      key: `${n.position.x},${n.position.y},${n.measured?.width ?? 0},${n.measured?.height ?? 0},${n.data.rotation ?? 0},${n.data.kind}`,
    };
  }, (a, b) => a?.key === b?.key);

  // Net-name stamps sit on the net — no visible lead (LTspice Label Net).
  if (
    sourceNode?.node.data.kind === "WIRELABEL" ||
    targetNode?.node.data.kind === "WIRELABEL"
  ) {
    return null;
  }

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
  const segIdx = data?.selectedSegIndex;
  const segmentOnly =
    selected &&
    typeof segIdx === "number" &&
    segIdx >= 0 &&
    segIdx < points.length - 1;

  if (segmentOnly) {
    const a = points[segIdx]!;
    const b = points[segIdx + 1]!;
    const segPath = polylinePath([a, b]);
    return (
      <>
        <BaseEdge
          id={id}
          path={path}
          markerEnd={markerEnd}
          interactionWidth={32}
          style={{
            ...style,
            stroke: "var(--wire)",
            strokeWidth: 1.75,
          }}
        />
        <BaseEdge
          id={`${id}-seg`}
          path={segPath}
          interactionWidth={32}
          style={{
            ...style,
            stroke: "var(--wire-selected)",
            strokeWidth: 2.6,
          }}
        />
      </>
    );
  }

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      interactionWidth={32}
      style={{
        ...style,
        stroke: selected ? "var(--wire-selected)" : "var(--wire)",
        strokeWidth: selected ? 2.6 : 1.75,
      }}
    />
  );
}
