import { useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ConnectionMode,
  ConnectionLineType,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type ReactFlowInstance,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ComponentNode } from "../nodes/ComponentNode";
import type { ComponentData, ComponentKind } from "../model/types";
import { isPaletteDrag, PALETTE_DND_MIME } from "../dnd";
import { COMPONENT_SPECS } from "../model/componentSpecs";

/** Match Background gap — snap placement and orthogonal wire stubs to this grid. */
export const SCHEMATIC_GRID = 16;

// The schematic canvas. ConnectionMode.Loose lets any pin wire to any pin
// (a schematic has no source/target direction), which is what we want here.
export function Canvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onReplace,
  onAddAt,
}: {
  nodes: Node<ComponentData>[];
  edges: Edge[];
  onNodesChange: OnNodesChange<Node<ComponentData>>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  onReplace: (nodeId: string, kind: ComponentKind) => void;
  onAddAt: (kind: ComponentKind, x: number, y: number) => void;
}) {
  const rfRef = useRef<ReactFlowInstance<Node<ComponentData>> | null>(null);
  // Node drop runs first; if it handled replace, skip pane "add at position".
  const replaceHandledRef = useRef(false);

  const handleReplace = useMemo(() => {
    return (nodeId: string, kind: ComponentKind) => {
      replaceHandledRef.current = true;
      onReplace(nodeId, kind);
    };
  }, [onReplace]);

  // Inject replace handler without putting it on node.data (keeps model clean).
  const nodeTypes = useMemo(
    () => ({
      component: (props: NodeProps<Node<ComponentData>>) => (
        <ComponentNode {...props} onReplace={handleReplace} />
      ),
    }),
    [handleReplace],
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      type: "smoothstep" as const,
      pathOptions: { borderRadius: 0 },
    }),
    [],
  );

  return (
    <div className="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.SmoothStep}
        defaultEdgeOptions={defaultEdgeOptions}
        snapToGrid
        snapGrid={[SCHEMATIC_GRID, SCHEMATIC_GRID]}
        fitView
        proOptions={{ hideAttribution: true }}
        onInit={(instance) => {
          rfRef.current = instance;
        }}
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
          const kind = e.dataTransfer.getData(PALETTE_DND_MIME) as ComponentKind;
          if (!kind || !COMPONENT_SPECS[kind] || !rfRef.current) return;
          const pos = rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          onAddAt(kind, pos.x, pos.y);
        }}
      >
        <Background gap={SCHEMATIC_GRID} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
