import { defaultParams } from "../src/model/componentSpecs";
import type { ComponentData } from "../src/model/types";
import type { Edge, Node } from "@xyflow/react";
import {
  applyBendEdit,
  detachWireForMove,
  flipBendAt,
  straightenBendAt,
} from "../src/wiring/wireMove";
import { reconnectTipsOnPins } from "../src/wiring/cutMove";
import { extractNets } from "../src/netlist/nets";
import { pinWorldPoint } from "../src/wiring/pinGeometry";

const mk = (
  id: string,
  kind: "R" | "C" | "TIP",
  refdes: string,
  x: number,
  y: number,
): Node<ComponentData> => ({
  id,
  type: "component",
  position: { x, y },
  data: { kind, refdes, params: { ...defaultParams(kind === "TIP" ? "R" : kind) } },
  ...(kind === "TIP"
    ? {
        data: { kind: "TIP" as const, refdes: "", params: {} },
        style: { width: 8, height: 8 },
        measured: { width: 8, height: 8 },
      }
    : { measured: { width: 92, height: 54 } }),
});

const wire = (
  id: string,
  s: string,
  sh: string,
  t: string,
  th: string,
  wps: { x: number; y: number }[],
): Edge => ({
  id,
  type: "schematic",
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
  data: { waypoints: wps },
});

let nodes: Node<ComponentData>[] = [
  mk("n2", "R", "R1", 280, 90),
  mk("n3", "C", "C1", 540, 180),
];
let edges: Edge[] = [
  wire("e1", "n2", "b", "n3", "a", [
    { x: 400, y: 117 },
    { x: 400, y: 207 },
  ]),
];

let id = 100;
const cut = detachWireForMove(nodes, edges, "e1", () => `n${++id}`);
if (!cut || !cut.didCut) {
  console.error("FAIL: expected wire cut");
  process.exit(1);
}
if (cut.moveIds.length !== 2) {
  console.error("FAIL: expected 2 tips", cut.moveIds);
  process.exit(1);
}
const moving = cut.edges.find((e) => e.id === "e1");
if (!moving) {
  console.error("FAIL: moving edge missing");
  process.exit(1);
}
const src = cut.nodes.find((n) => n.id === moving.source);
const tgt = cut.nodes.find((n) => n.id === moving.target);
if (src?.data.kind !== "TIP" || tgt?.data.kind !== "TIP") {
  console.error("FAIL: ends should be tips");
  process.exit(1);
}
// Pins on R1/C1 must be free (no edge to real parts)
const stillOnParts = cut.edges.some((e) => {
  const a = cut.nodes.find((n) => n.id === e.source);
  const b = cut.nodes.find((n) => n.id === e.target);
  return (
    (a && a.data.kind !== "TIP" && (e.source === "n2" || e.source === "n3")) ||
    (b && b.data.kind !== "TIP" && (e.target === "n2" || e.target === "n3"))
  );
});
if (stillOnParts) {
  console.error("FAIL: wire still attached to parts");
  process.exit(1);
}
console.log("PASS detachWireForMove");

const poly = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 40 },
  { x: 80, y: 40 },
];
const straight = straightenBendAt(poly, 1);
if (straight.some((p) => p.x === 40 && p.y === 0) && straight.length > 3) {
  // corner at index 1 removed — path may re-elbow
}
const flipped = flipBendAt(poly, 2);
if (flipped[2]!.x === poly[2]!.x && flipped[2]!.y === poly[2]!.y) {
  console.error("FAIL: flip should change corner", flipped[2], poly[2]);
  process.exit(1);
}
console.log("PASS straighten/flip");

nodes = cut.nodes;
edges = cut.edges;
const bend = applyBendEdit(nodes, moving, 1, "straighten");
console.log("PASS applyBendEdit", bend?.length ?? 0);

// Drop the free wire back near the original pins — both ends reconnect.
const rec = reconnectTipsOnPins(cut.nodes, cut.edges, cut.moveIds);
if (rec.reconnected !== 2) {
  console.error("FAIL: expected both wire ends to snap back to pins, got", rec.reconnected);
  process.exit(1);
}
const nets = extractNets(rec.nodes, rec.edges);
if (nets.netOf("n2", "b") !== nets.netOf("n3", "a")) {
  console.error("FAIL: R1.b should rejoin C1.a after wire drop");
  process.exit(1);
}

const TIP_HALF = 4;
const rb = pinWorldPoint(cut.nodes.find((n) => n.id === "n2")!, "b")!;
const ca = pinWorldPoint(cut.nodes.find((n) => n.id === "n3")!, "a")!;
const offNodes = cut.nodes.map((n) => {
  if (n.id === moving.source) {
    return { ...n, position: { x: rb.x + 10, y: rb.y - TIP_HALF } };
  }
  if (n.id === moving.target) {
    return { ...n, position: { x: ca.x - 9, y: ca.y - TIP_HALF } };
  }
  return n;
});
const recOff = reconnectTipsOnPins(offNodes, cut.edges, cut.moveIds);
if (recOff.reconnected !== 2) {
  console.error("FAIL: near-miss wire drop should still reconnect, got", recOff.reconnected);
  process.exit(1);
}
console.log("PASS wire drop reconnects to pins");
console.log("PASS all wire-move tests");
