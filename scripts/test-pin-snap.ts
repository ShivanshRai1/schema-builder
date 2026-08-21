import { findNearestPin, findNearestPinOnNode, pinWorldPoint, PIN_SNAP_RADIUS } from "../src/wiring/pinGeometry";
import { getSymbolLayout } from "../src/nodes/symbols/layout";
import { extractNets } from "../src/netlist/nets";
import { toNetlist } from "../src/netlist/toNetlist";
import type { ComponentData } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import type { Edge, Node } from "@xyflow/react";

const mk = (
  id: string,
  kind: "C" | "GND" | "R" | "TIP",
  x: number,
  y: number,
  refdes = "",
): Node<ComponentData> => ({
  id,
  type: "component",
  position: { x, y },
  data: {
    kind,
    refdes: refdes || (kind === "C" ? "C1" : kind === "R" ? "R1" : ""),
    params: kind === "TIP" ? {} : { ...defaultParams(kind === "TIP" ? "R" : kind) },
  },
  measured: kind === "TIP" ? { width: 8, height: 8 } : undefined,
  ...(kind === "TIP" ? { style: { width: 8, height: 8 } } : {}),
});

const nodes = [mk("n3", "C", 540, 180), mk("n4", "GND", 280, 360)];

const c1 = nodes[0]!;
const pinB = pinWorldPoint(c1, "b")!;
const nearMiss = { x: pinB.x + 12, y: pinB.y + 8 };
const far = { x: pinB.x + 80, y: pinB.y };

const hit = findNearestPin(nodes, nearMiss, { maxDist: PIN_SNAP_RADIUS });
if (!hit || hit.nodeId !== "n3" || hit.pinId !== "b") {
  console.error("FAIL: near-miss should snap to C1.b", hit);
  process.exit(1);
}

const miss = findNearestPin(nodes, far, { maxDist: PIN_SNAP_RADIUS });
if (miss) {
  console.error("FAIL: far cursor should not snap", miss);
  process.exit(1);
}

const c1Layout = getSymbolLayout("C")!;
// Top of the symbol body — must not auto-snap within PIN_SNAP_RADIUS.
const topOfBody = { x: c1.position.x + c1Layout.w / 2, y: c1.position.y - 3 };
const bodyHit = findNearestPin(nodes, topOfBody, { maxDist: PIN_SNAP_RADIUS });
if (bodyHit) {
  console.error("FAIL: 28px snap must not claim the top of C1 as a pin", bodyHit);
  process.exit(1);
}
const onPart = findNearestPinOnNode(c1, topOfBody);
if (!onPart || onPart.nodeId !== "n3" || (onPart.pinId !== "a" && onPart.pinId !== "b")) {
  console.error("FAIL: clicking C1 body should attach to pin a or b", onPart);
  process.exit(1);
}
const towardB = findNearestPinOnNode(c1, { x: pinB.x - 10, y: pinB.y - 4 });
if (!towardB || towardB.pinId !== "b") {
  console.error("FAIL: click toward C1 right side should pick pin b", towardB);
  process.exit(1);
}

// Netlist: a dangling tip parked on C1's outline is NOT a connection to C1.
const r1 = mk("n2", "R", 280, 90, "R1");
const tip = mk("tip1", "TIP", 586, 176);
const falseEdge: Edge = {
  id: "false",
  type: "schematic",
  source: "n2",
  sourceHandle: "b",
  target: "tip1",
  targetHandle: "t",
  data: { waypoints: [] },
};
const falseNodes = [r1, c1, tip];
const falseNets = extractNets(falseNodes, [falseEdge]);
if (falseNets.netOf("n2", "b") === falseNets.netOf("n3", "a")) {
  console.error("FAIL: dangling tip on C1 body must not put C1 on R1.b");
  process.exit(1);
}
const falseSpice = toNetlist(falseNodes, [falseEdge], { title: "false" });
if (/R1 \S+ \S+/.test(falseSpice)) {
  const rLine = falseSpice.split("\n").find((l) => l.startsWith("R1 "));
  const cLine = falseSpice.split("\n").find((l) => l.startsWith("C1 "));
  const rNets = rLine?.split(/\s+/) ?? [];
  const cNets = cLine?.split(/\s+/) ?? [];
  // R1 n+ n- value; C1 n+ n- value — C1.a (first net) must differ from R1.b (second net)
  if (rNets[2] && cNets[1] && rNets[2] === cNets[1]) {
    console.error("FAIL: netlist treated body-parked wire as C1.a connection", rLine, cLine);
    process.exit(1);
  }
}

const realEdge: Edge = {
  id: "real",
  type: "schematic",
  source: "n2",
  sourceHandle: "b",
  target: "n3",
  targetHandle: "a",
  data: { waypoints: [] },
};
const realNets = extractNets([r1, c1], [realEdge]);
if (realNets.netOf("n2", "b") !== realNets.netOf("n3", "a")) {
  console.error("FAIL: real pin-pin wire should join R1.b and C1.a");
  process.exit(1);
}

console.log("PASS pin snap + body-click + netlist false-connect", hit, onPart);
