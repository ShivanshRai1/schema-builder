import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { resolveBranchOnEdge } from "../src/wiring/busBranch";

function tipAt(id: string, x: number, y: number): Node<ComponentData> {
  return {
    id,
    type: "component",
    position: { x, y: y - 4 },
    data: { kind: "TIP", refdes: "", params: {} },
    style: { width: 8, height: 8 },
    measured: { width: 8, height: 8 },
  };
}

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

// Finish H run onto V bus: tip Y follows draft align, not click Y.
{
  const nodes = [tipAt("a", 200, 0), tipAt("b", 200, 200)];
  const edges: Edge[] = [
    {
      id: "v",
      type: "schematic",
      source: "a",
      sourceHandle: "t",
      target: "b",
      targetHandle: "t",
      data: { waypoints: [], directPath: true },
    },
  ];
  const cursor = { x: 205, y: 130 };
  const align = { x: 40, y: 104 };
  const resolved = resolveBranchOnEdge(nodes, edges, "v", cursor, 8, { align });
  assert(resolved, "expected resolve");
  assert(
    Math.abs(resolved!.point.y - 104) < 0.5,
    `align Y should win, got ${resolved!.point.y}`,
  );
  assert(
    Math.abs(resolved!.point.x - 200) < 0.5,
    `should sit on V bus X, got ${resolved!.point.x}`,
  );
}

console.log("PASS busBranch align");
