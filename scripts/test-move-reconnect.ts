/**
 * Move a part away (detach → dangling tips) then drop it back on the same spot:
 * every wire must reconnect and the netlist must match the original exactly.
 */
import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import { detachPartForMove, reconnectPartsOnTips } from "../src/wiring/cutMove";
import { extractNets } from "../src/netlist/nets";

const mk = (
  id: string,
  kind: "R" | "C" | "V" | "GND",
  x: number,
  y: number,
  refdes: string,
): Node<ComponentData> => ({
  id,
  type: "component",
  position: { x, y },
  data: { kind, refdes, params: { ...defaultParams(kind) } },
  measured: { width: 92, height: 54 },
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

const nodes: Node<ComponentData>[] = [
  mk("n1", "V", 40, 180, "V1"),
  mk("n2", "R", 280, 90, "R1"),
  mk("n3", "C", 540, 180, "C1"),
  mk("n4", "GND", 280, 360, ""),
];
const edges: Edge[] = [
  wire("n1", "p", "n2", "a"),
  wire("n2", "b", "n3", "a"),
  wire("n3", "b", "n4", "g"),
  wire("n1", "n", "n4", "g"),
];

const before = extractNets(nodes, edges);
const beforeNets = [...before.nets].sort();

let idc = 100;
const newId = () => `t${idc++}`;

// 1) Move R1 away → its wires detach into dangling tips.
const cut = detachPartForMove(nodes, edges, "n2", newId);
const moved = cut.nodes.map((n) =>
  n.id === "n2" ? { ...n, position: { x: 280, y: 500 } } : n,
);
const midNets = extractNets(moved, cut.edges);
if (midNets.netOf("n2", "b") === midNets.netOf("n3", "a")) {
  console.error("FAIL: R1.b should be disconnected from C1.a while moved away");
  process.exit(1);
}

// 2) Drop R1 back on its original spot → wires reconnect.
const backNodes = moved.map((n) =>
  n.id === "n2" ? { ...n, position: { x: 280, y: 90 } } : n,
);
const rec = reconnectPartsOnTips(backNodes, cut.edges, ["n2"]);
if (rec.reconnected !== 2) {
  console.error("FAIL: expected R1's two pins to reconnect, got", rec.reconnected);
  process.exit(1);
}
if (rec.nodes.some((n) => n.data.kind === "TIP")) {
  console.error("FAIL: no tips should remain after reconnect", rec.nodes);
  process.exit(1);
}

const after = extractNets(rec.nodes, rec.edges);
const afterNets = [...after.nets].sort();

// Netlist must be identical to the original.
if (
  after.netOf("n1", "p") !== after.netOf("n2", "a") ||
  after.netOf("n2", "b") !== after.netOf("n3", "a") ||
  after.netOf("n3", "b") !== after.netOf("n4", "g") ||
  after.netOf("n1", "n") !== after.netOf("n4", "g")
) {
  console.error("FAIL: connections not restored after move-back", rec.edges);
  process.exit(1);
}
if (JSON.stringify(beforeNets) !== JSON.stringify(afterNets)) {
  console.error("FAIL: net set changed", { beforeNets, afterNets });
  process.exit(1);
}

console.log("PASS move away + back reconnects wires and restores netlist");

// 3) Drop R1 back a few pixels OFF (grid-snap lands it a cell away): the part
//    should be nudged onto the frozen tips and still reconnect both pins.
const offNodes = moved.map((n) =>
  n.id === "n2" ? { ...n, position: { x: 280 + 9, y: 90 - 7 } } : n,
);
const recOff = reconnectPartsOnTips(offNodes, cut.edges, ["n2"]);
if (recOff.reconnected !== 2) {
  console.error("FAIL: off-by-a-few-pixels drop should snap+reconnect both pins, got", recOff.reconnected);
  process.exit(1);
}
const r1 = recOff.nodes.find((n) => n.id === "n2")!;
if (r1.position.x !== 280 || r1.position.y !== 90) {
  console.error("FAIL: R1 should be nudged back to align on the tips", r1.position);
  process.exit(1);
}
const afterOff = extractNets(recOff.nodes, recOff.edges);
if (
  afterOff.netOf("n1", "p") !== afterOff.netOf("n2", "a") ||
  afterOff.netOf("n2", "b") !== afterOff.netOf("n3", "a")
) {
  console.error("FAIL: connections not restored after nudged move-back", recOff.edges);
  process.exit(1);
}
console.log("PASS off-by-a-few-pixels drop snaps onto tips and reconnects");
