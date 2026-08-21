import { addEdge, type Edge, type Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";

/** Two dangling tips + an orthogonal wire between them (empty-canvas start). */
function floatingWire(
  start: { x: number; y: number },
  end: { x: number; y: number },
  waypoints: { x: number; y: number }[],
): { nodes: Node<ComponentData>[]; edges: Edge[] } {
  const tip = (id: string, p: { x: number; y: number }): Node<ComponentData> => ({
    id,
    type: "component",
    position: { x: p.x, y: p.y - 4 },
    data: { kind: "TIP", refdes: "", params: {} },
    style: { width: 8, height: 8 },
    measured: { width: 8, height: 8 },
  });
  const nodes = [tip("a", start), tip("b", end)];
  const edges = addEdge(
    {
      id: "e1",
      type: "schematic",
      source: "a",
      sourceHandle: "t",
      target: "b",
      targetHandle: "t",
      data: { waypoints },
    },
    [] as Edge[],
  );
  return { nodes, edges };
}

const placed = floatingWire({ x: 0, y: 0 }, { x: 80, y: 64 }, [{ x: 80, y: 0 }]);
if (placed.nodes.length !== 2 || placed.edges.length !== 1) {
  console.error("FAIL: free wire should be tip↔tip", placed);
  process.exit(1);
}
if (placed.nodes.some((n) => n.data.kind !== "TIP")) {
  console.error("FAIL: free wire ends must be tips");
  process.exit(1);
}
const e = placed.edges[0]!;
if (e.source !== "a" || e.target !== "b") {
  console.error("FAIL: edge endpoints", e);
  process.exit(1);
}
console.log("PASS free-floating wire");
