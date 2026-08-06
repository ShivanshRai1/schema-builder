import { useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ConnectionMode,
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
        <Background gap={16} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
