import { extractNets } from "../src/netlist/nets";
import { toNetlist } from "../src/netlist/toNetlist";
import { detachPartForMove } from "../src/wiring/cutMove";
import { clearTipStubsOnPins, pruneOrphanTips } from "../src/wiring/tipCleanup";
import type { ComponentData, ComponentKind } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import type { Edge, Node } from "@xyflow/react";

const mk = (
  id: string,
  kind: ComponentKind,
  refdes: string,
  x: number,
  y: number,
): Node<ComponentData> => ({
  id,
  type: "component",
  position: { x, y },
  data: { kind, refdes, params: { ...defaultParams(kind) } },
});

const wire = (s: string, sh: string, t: string, th: string): Edge => ({
  id: `${s}${sh}-${t}${th}`,
  type: "schematic",
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
  data: { waypoints: [] },
});

let nodes: Node<ComponentData>[] = [
  mk("n1", "V", "V1", 40, 180),
  mk("n2", "R", "R1", 280, 90),
  mk("n3", "C", "C1", 540, 180),
  mk("n4", "GND", "", 280, 360),
];
let edges: Edge[] = [
  wire("n1", "p", "n2", "a"),
  wire("n2", "b", "n3", "a"),
  wire("n3", "b", "n4", "g"),
  wire("n1", "n", "n4", "g"),
];

const deviceLines = (nl: string) =>
  nl.split("\n").filter((l) => /^[CRVI]/.test(l));

const nl0 = toNetlist(nodes, edges, { title: "t" });
console.log("--- initial ---");
console.log(deviceLines(nl0).join("\n"));
const v0 = deviceLines(nl0).find((l) => l.startsWith("V1")) ?? "";
if (!/\b0\b/.test(v0)) {
  console.error("FAIL: initial V1 should use net 0:", v0);
  process.exit(1);
}

let id = 100;
const det = detachPartForMove(nodes, edges, "n4", () => `n${++id}`, { x: 280, y: 360 });
nodes = det.nodes;
edges = det.edges;
console.log("--- after move GND ---");
console.log("tips", nodes.filter((n) => n.data.kind === "TIP").length);
console.log(deviceLines(toNetlist(nodes, edges, { title: "t" })).join("\n"));

// Simulate reconnect like onWire: clear tip stubs, then direct wires to GND
const cleared = clearTipStubsOnPins(nodes, edges, [
  { nodeId: "n4", handle: "g" },
  { nodeId: "n1", handle: "n" },
  { nodeId: "n3", handle: "b" },
]);
const pruned = pruneOrphanTips(cleared.nodes, cleared.edges);
nodes = pruned.nodes;
edges = [
  ...pruned.edges.filter(
    (e) =>
      !(
        (e.source === "n1" && e.sourceHandle === "n") ||
        (e.target === "n1" && e.targetHandle === "n") ||
        (e.source === "n3" && e.sourceHandle === "b") ||
        (e.target === "n3" && e.targetHandle === "b") ||
        (e.source === "n4" && e.sourceHandle === "g") ||
        (e.target === "n4" && e.targetHandle === "g")
      ),
  ),
  wire("n1", "n", "n4", "g"),
  wire("n3", "b", "n4", "g"),
];

const nl2 = toNetlist(nodes, edges, { title: "t" });
console.log("--- after reconnect to GND ---");
console.log(deviceLines(nl2).join("\n"));
const vLine = deviceLines(nl2).find((l) => l.startsWith("V1")) ?? "";
const cLine = deviceLines(nl2).find((l) => l.startsWith("C1")) ?? "";
if (!/\b0\b/.test(vLine)) {
  console.error("FAIL: V1 missing net 0 after reconnect:", vLine);
  process.exit(1);
}
if (!/\b0\b/.test(cLine)) {
  console.error("FAIL: C1 missing net 0 after reconnect:", cLine);
  process.exit(1);
}
console.log("nets", extractNets(nodes, edges).nets);
console.log("PASS");
