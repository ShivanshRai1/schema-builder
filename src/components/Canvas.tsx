import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ConnectionMode,
  useViewport,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type ReactFlowInstance,
  type NodeProps,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ComponentNode } from "../nodes/ComponentNode";
import type { ComponentData, ComponentKind } from "../model/types";
import { isPaletteDrag, PALETTE_DND_MIME } from "../dnd";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import {
  SchematicWireEdge,
  type SchematicWireData,
} from "../edges/SchematicWireEdge";
import {
  dist,
  pointsEqual,
  polylinePath,
  projectOrthogonal,
  snapPoint,
  WIRE_GRID,
  type Point,
} from "../wiring/orthogonal";

/** Match Background gap — snap placement and wire corners to this grid. */
export const SCHEMATIC_GRID = WIRE_GRID;

export type WireCompletePayload = Connection & {
  waypoints: Point[];
};

/** Esc with locked bends — keep the drawn segments ending at `end`. */
export type WirePartialPayload = {
  source: string;
  sourceHandle: string;
  waypoints: Point[];
  end: Point;
};

type WiringDraft = {
  sourceNodeId: string;
  sourceHandle: string;
  start: Point;
  waypoints: Point[];
  preview: Point | null;
};

function handleCenter(
  rf: ReactFlowInstance<Node<ComponentData>>,
  nodeId: string,
  handleId: string,
): Point | null {
  const node = rf.getInternalNode(nodeId);
  if (!node) return null;
  const bounds =
    node.internals.handleBounds?.source?.find((h) => h.id === handleId) ??
    node.internals.handleBounds?.target?.find((h) => h.id === handleId);
  if (!bounds) return null;
  const origin = node.internals.positionAbsolute;
  return {
    x: origin.x + bounds.x + bounds.width / 2,
    y: origin.y + bounds.y + bounds.height / 2,
  };
}

function lastLocked(draft: WiringDraft): Point {
  return draft.waypoints.length
    ? draft.waypoints[draft.waypoints.length - 1]!
    : draft.start;
}

/** Draft polyline lives in flow coords; transform with the viewport. */
function WireDraftOverlay({
  lockedPath,
  rubberPath,
}: {
  lockedPath: string;
  rubberPath: string;
}) {
  const { x, y, zoom } = useViewport();
  if (!lockedPath && !rubberPath) return null;
  return (
    <svg
      className="wire-draft-overlay"
      width="100%"
      height="100%"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "visible",
        pointerEvents: "none",
        zIndex: 4,
        transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        transformOrigin: "0 0",
      }}
    >
      {lockedPath ? (
        <path className="wire-draft-locked" d={lockedPath} fill="none" />
      ) : null}
      {rubberPath ? (
        <path className="wire-draft-rubber" d={rubberPath} fill="none" />
      ) : null}
    </svg>
  );
}

// The schematic canvas. Custom click wiring (LTspice-style), not drag-auto-route.
export function Canvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onWire,
  onWirePartial,
  onTrimWire,
  onReplace,
  onAddAt,
}: {
  nodes: Node<ComponentData>[];
  edges: Edge[];
  onNodesChange: OnNodesChange<Node<ComponentData>>;
  onEdgesChange: OnEdgesChange;
  onWire: (payload: WireCompletePayload) => void;
  onWirePartial: (payload: WirePartialPayload) => void;
  onTrimWire: () => boolean;
  onReplace: (nodeId: string, kind: ComponentKind) => void;
  onAddAt: (kind: ComponentKind, x: number, y: number) => void;
}) {
  const rfRef = useRef<ReactFlowInstance<Node<ComponentData>> | null>(null);
  const replaceHandledRef = useRef(false);
  const wiringRef = useRef<WiringDraft | null>(null);
  const [wiring, setWiring] = useState<WiringDraft | null>(null);

  const onReplaceRef = useRef(onReplace);
  const onWireRef = useRef(onWire);
  const onWirePartialRef = useRef(onWirePartial);
  const onTrimWireRef = useRef(onTrimWire);
  onReplaceRef.current = onReplace;
  onWireRef.current = onWire;
  onWirePartialRef.current = onWirePartial;
  onTrimWireRef.current = onTrimWire;

  const finishOrKeepPartial = useCallback(() => {
    const draft = wiringRef.current;
    if (!draft) return;
    if (draft.waypoints.length > 0) {
      onWirePartialRef.current({
        source: draft.sourceNodeId,
        sourceHandle: draft.sourceHandle,
        waypoints: draft.waypoints.slice(0, -1),
        end: draft.waypoints[draft.waypoints.length - 1]!,
      });
    }
    wiringRef.current = null;
    setWiring(null);
  }, []);

  // Stable forever — prevents remounting every node while the rubber-band moves.
  const nodeTypes = useMemo(
    () => ({
      component: (props: NodeProps<Node<ComponentData>>) => (
        <ComponentNode
          {...props}
          onReplace={(nodeId, kind) => {
            replaceHandledRef.current = true;
            onReplaceRef.current(nodeId, kind);
          }}
          onPinClick={(nodeId, pinId) => {
            const rf = rfRef.current;
            if (!rf) return;
            const center = handleCenter(rf, nodeId, pinId);
            if (!center) return;

            const draft = wiringRef.current;
            if (!draft) {
              wiringRef.current = {
                sourceNodeId: nodeId,
                sourceHandle: pinId,
                start: center,
                waypoints: [],
                preview: null,
              };
              setWiring(wiringRef.current);
              return;
            }

            if (draft.sourceNodeId === nodeId && draft.sourceHandle === pinId) {
              if (draft.waypoints.length > 0) {
                onWirePartialRef.current({
                  source: draft.sourceNodeId,
                  sourceHandle: draft.sourceHandle,
                  waypoints: draft.waypoints.slice(0, -1),
                  end: draft.waypoints[draft.waypoints.length - 1]!,
                });
              }
              wiringRef.current = null;
              setWiring(null);
              return;
            }

            onWireRef.current({
              source: draft.sourceNodeId,
              sourceHandle: draft.sourceHandle,
              target: nodeId,
              targetHandle: pinId,
              waypoints: draft.waypoints,
            });
            wiringRef.current = null;
            setWiring(null);
          }}
        />
      ),
    }),
    [],
  );

  const edgeTypes = useMemo(() => ({ schematic: SchematicWireEdge }), []);

  const defaultEdgeOptions = useMemo(
    () => ({
      type: "schematic" as const,
      data: { waypoints: [] } satisfies SchematicWireData,
    }),
    [],
  );

  const routedEdges = useMemo(
    () =>
      edges.map((e) =>
        e.type === "schematic" ? e : { ...e, type: "schematic" as const },
      ),
    [edges],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest('input, textarea, select, [contenteditable="true"], .monaco-editor')) {
        return;
      }
      // While drawing: Esc keeps/cancels the draft — never peels an existing wire.
      if (wiringRef.current) {
        e.preventDefault();
        e.stopPropagation();
        finishOrKeepPartial();
        return;
      }
      // Idle: Esc peels a selected wire one bend at a time.
      if (onTrimWireRef.current()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Capture so React Flow cannot clear selection before we peel.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [finishOrKeepPartial]);

  const onPaneMouseMove = useCallback((e: React.MouseEvent) => {
    const draft = wiringRef.current;
    const rf = rfRef.current;
    if (!draft || !rf) return;
    const cursor = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const preview = projectOrthogonal(lastLocked(draft), cursor, SCHEMATIC_GRID);
    if (draft.preview && pointsEqual(draft.preview, preview)) return;
    const next = { ...draft, preview };
    wiringRef.current = next;
    setWiring(next);
  }, []);

  const onPaneClick = useCallback((e: React.MouseEvent) => {
    const draft = wiringRef.current;
    const rf = rfRef.current;
    if (!draft || !rf) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.(".component-pin, .react-flow__handle, .tip-node")) return;

    const cursor = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const corner = projectOrthogonal(lastLocked(draft), cursor, SCHEMATIC_GRID);
    if (dist(lastLocked(draft), corner) < SCHEMATIC_GRID * 0.4) return;
    if (draft.waypoints.some((p) => pointsEqual(p, corner))) return;

    const next = {
      ...draft,
      waypoints: [...draft.waypoints, corner],
      preview: null as Point | null,
    };
    wiringRef.current = next;
    setWiring(next);
  }, []);

  const rubberPath = useMemo(() => {
    if (!wiring) return "";
    const from = lastLocked(wiring);
    const to = wiring.preview;
    if (!to || pointsEqual(from, to)) return "";
    return polylinePath([from, to]);
  }, [wiring]);

  const lockedPath = useMemo(() => {
    if (!wiring || wiring.waypoints.length === 0) return "";
    return polylinePath([wiring.start, ...wiring.waypoints]);
  }, [wiring]);

  return (
    <div className={`canvas${wiring ? " canvas-wiring" : ""}`}>
      <ReactFlow
        nodes={nodes}
        edges={routedEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        elementsSelectable
        nodesConnectable={false}
        deleteKeyCode={null}
        connectionMode={ConnectionMode.Loose}
        defaultEdgeOptions={defaultEdgeOptions}
        snapToGrid
        snapGrid={[SCHEMATIC_GRID, SCHEMATIC_GRID]}
        fitView
        proOptions={{ hideAttribution: true }}
        onInit={(instance) => {
          rfRef.current = instance;
        }}
        onPaneClick={onPaneClick}
        onPaneMouseMove={onPaneMouseMove}
        onDragOver={(e) => {
          if (!isPaletteDrag(e.dataTransfer)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (replaceHandledRef.current) {
            replaceHandledRef.current = false;
            return;
          }
          if (wiringRef.current) return;
          const kind = e.dataTransfer.getData(PALETTE_DND_MIME) as ComponentKind;
          if (!kind || !COMPONENT_SPECS[kind] || kind === "TIP" || !rfRef.current) return;
          const pos = snapPoint(
            rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
            SCHEMATIC_GRID,
          );
          onAddAt(kind, pos.x, pos.y);
        }}
      >
        <Background gap={SCHEMATIC_GRID} />
        <Controls />
        <WireDraftOverlay lockedPath={lockedPath} rubberPath={rubberPath} />
      </ReactFlow>
      {wiring && (
        <div className="wire-draft-hint">
          Wiring… click to bend, click a pin to finish, Esc keeps drawn bends
        </div>
      )}
    </div>
  );
}
