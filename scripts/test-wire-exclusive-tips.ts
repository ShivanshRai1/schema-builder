import { detachWireForMove } from "../src/wiring/wireMove";
import type { ComponentData } from "../src/model/types";
import type { Edge, Node } from "@xyflow/react";

const tip = (id: string, x: number, y: number): Node<ComponentData> => ({
  id,
  type: "component",
  position: { x, y: y - 4 },
  data: { kind: "TIP", refdes: "", params: {} },
  style: { width: 8, height: 8 },
  measured: { width: 8, height: 8 },
});

const part = (id: string, x: number, y: number): Node<ComponentData> => ({
  id,
  type: "component",
  position: { x, y },
  data: { kind: "R", refdes: "R1", params: { value: "10k" } },
  measured: { width: 92, height: 54 },
});

const edge = (
  id: string,
  s: string,
  sh: string,
  t: string,
  th: string,
  wps: { x: number; y: number }[] = [],
): Edge => ({
  id,
  type: "schematic",
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
  data: { waypoints: wps },
});

// T-junction: tipJ shared by wire e1 (moving) and e2 (stays).
const nodes: Node<ComponentData>[] = [
  tip("tipJ", 200, 200),
  tip("tipA", 100, 200),
  tip("tipB", 300, 120),
  part("n2", 400, 90),
];
const edges: Edge[] = [
  edge("e1", "tipA", "t", "tipJ", "t", [{ x: 150, y: 200 }]),
  edge("e2", "tipJ", "t", "n2", "a", [{ x: 280, y: 200 }, { x: 280, y: 117 }]),
];

let id = 50;
const cut = detachWireForMove(nodes, edges, "e1", () => `n${++id}`);
if (!cut) {
  console.error("FAIL: null");
  process.exit(1);
}

const moving = cut.edges.find((e) => e.id === "e1")!;
const staying = cut.edges.find((e) => e.id === "e2")!;
if (!moving || !staying) {
  console.error("FAIL: edges missing");
  process.exit(1);
}

// Moving wire must use brand-new exclusive tips.
if (moving.source === "tipJ" || moving.target === "tipJ") {
  console.error("FAIL: moving wire still uses shared tipJ", moving);
  process.exit(1);
}
if (cut.moveIds.includes("tipJ")) {
  console.error("FAIL: tipJ should not be in moveIds");
  process.exit(1);
}

// Other wire must still be attached to tipJ (junction stays).
if (staying.source !== "tipJ" && staying.target !== "tipJ") {
  console.error("FAIL: e2 lost tipJ", staying);
  process.exit(1);
}

const moveTips = cut.nodes.filter((n) => cut.moveIds.includes(n.id));
if (moveTips.length !== 2 || moveTips.some((n) => n.data.kind !== "TIP")) {
  console.error("FAIL: need 2 exclusive tips", cut.moveIds);
  process.exit(1);
}

console.log("PASS exclusive tips — no sticky junction");
