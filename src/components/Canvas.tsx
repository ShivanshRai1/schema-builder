import { useMemo } from "react";
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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ComponentNode } from "../nodes/ComponentNode";
import type { ComponentData } from "../model/types";

// The schematic canvas. ConnectionMode.Loose lets any pin wire to any pin
// (a schematic has no source/target direction), which is what we want here.
export function Canvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
}: {
  nodes: Node<ComponentData>[];
  edges: Edge[];
  onNodesChange: OnNodesChange<Node<ComponentData>>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
}) {
  const nodeTypes = useMemo(() => ({ component: ComponentNode }), []);

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
      >
        <Background gap={16} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
