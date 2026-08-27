/**
 * Move a part away (detach → dangling tips) then drop it back on the same spot:
 * every wire must reconnect and the netlist must match the original exactly.
 */
import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import { detachPartForMove, reconnectPartsOnTips } from "../src/wiring/cutMove";
import { extractNets } from "../src/netlist/nets";
import {
  attachFreeTipsToWires,
  autorouteWiresForMovedParts,
  planConnectedPartMove,
} from "../src/wiring/wireMove";
import { computeEdgePolyline } from "../src/wiring/wireGeometry";
import { pinWorldPoint } from "../src/wiring/pinGeometry";
import { findWireJunctions } from "../src/wiring/junctions";

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

// 4) Connected move near a T-junction must NOT consume the junction tip.
//    Old bug: drop C next to the junction rewired a random junction edge and
//    orphaned C's real connection (wire ended in a hollow tip short of C).
{
  const tip: Node<ComponentData> = {
    id: "junc",
    type: "component",
    position: { x: 400, y: 113 },
    data: { kind: "TIP", refdes: "", params: {} },
    style: { width: 8, height: 8 },
    measured: { width: 8, height: 8 },
  };
  const jNodes: Node<ComponentData>[] = [
    mk("n1", "V", 40, 180, "V1"),
    mk("n2", "R", 280, 90, "R1"),
    mk("n3", "C", 420, 90, "C1"), // close to junction — within reconnect radius
    mk("n4", "GND", 400, 280, ""),
    tip,
  ];
  const jEdges: Edge[] = [
    wire("n1", "p", "n2", "a"),
    {
      id: "r-j",
      type: "schematic",
      source: "n2",
      sourceHandle: "b",
      target: "junc",
      targetHandle: "t",
      data: { waypoints: [] },
    },
    {
      id: "j-c",
      type: "schematic",
      source: "junc",
      sourceHandle: "t",
      target: "n3",
      targetHandle: "a",
      data: { waypoints: [] },
    },
    {
      id: "j-g",
      type: "schematic",
      source: "junc",
      sourceHandle: "t",
      target: "n4",
      targetHandle: "g",
      data: { waypoints: [] },
    },
    wire("n1", "n", "n4", "g"),
  ];
  const beforeJ = extractNets(jNodes, jEdges);
  const recJ = reconnectPartsOnTips(jNodes, jEdges, ["n3"]);
  if (recJ.reconnected !== 0) {
    console.error(
      "FAIL: reconnect must ignore junction tips while C stays wired, got",
      recJ.reconnected,
    );
    process.exit(1);
  }
  if (!recJ.nodes.some((n) => n.id === "junc")) {
    console.error("FAIL: junction tip must survive a connected C nudge");
    process.exit(1);
  }
  if (!recJ.edges.some((e) => e.id === "j-c")) {
    console.error("FAIL: C↔junction edge must survive reconnect");
    process.exit(1);
  }
  const afterJ = extractNets(recJ.nodes, recJ.edges);
  if (afterJ.netOf("n3", "a") !== beforeJ.netOf("n3", "a")) {
    console.error("FAIL: moving C near a T-junction changed its net");
    process.exit(1);
  }
  console.log("PASS connected drop near T-junction leaves junction alone");

  // 5) Keep-connected move of C: junction edge must still reach C after autoroute.
  const movedC = jNodes.map((n) =>
    n.id === "n3" ? { ...n, position: { x: n.position.x + 80, y: n.position.y } } : n,
  );
  const plan = planConnectedPartMove(jNodes, jEdges, "n3");
  if (!plan || plan.moveIds.includes("junc")) {
    console.error("FAIL: junction tip must stay fixed while C moves", plan);
    process.exit(1);
  }
  if (!plan.clearWaypointEdgeIds.includes("j-c")) {
    console.error("FAIL: C↔junction wire should refresh waypoints on move", plan);
    process.exit(1);
  }
  const routed = autorouteWiresForMovedParts(movedC, jEdges, new Set(["n3"]));
  const jc = routed.find((e) => e.id === "j-c");
  if (!jc) {
    console.error("FAIL: autoroute dropped C↔junction edge");
    process.exit(1);
  }
  const poly = computeEdgePolyline(movedC, jc);
  const cPin = pinWorldPoint(movedC.find((n) => n.id === "n3")!, "a")!;
  const end = poly[poly.length - 1]!;
  if (Math.hypot(end.x - cPin.x, end.y - cPin.y) > 0.5) {
    console.error("FAIL: after move, junction wire must still end on C's pin", {
      end,
      cPin,
      poly,
    });
    process.exit(1);
  }
  const afterMove = extractNets(movedC, routed);
  if (afterMove.netOf("n3", "a") !== beforeJ.netOf("n3", "a")) {
    console.error("FAIL: moving C along the rail changed its net");
    process.exit(1);
  }
  console.log("PASS keep-connected C move keeps junction wire on C's pin");
}

// 6) A moved C carrying an old free TIP onto a rail must merge electrically.
//    Before the fix this looked connected but showed a hollow crossing circle.
{
  const r = mk("hr", "R", 280, 90, "R1");
  const c = mk("hc", "C", 500, 90, "C1");
  const g = mk("hg", "GND", 650, 280, "");
  const pin = pinWorldPoint(c, "a")!;
  const loose: Node<ComponentData> = {
    id: "loose",
    type: "component",
    position: { x: pin.x, y: pin.y - 4 },
    data: { kind: "TIP", refdes: "", params: {} },
    style: { width: 8, height: 8 },
    measured: { width: 8, height: 8 },
  };
  const railEnd: Node<ComponentData> = {
    id: "rail-end",
    type: "component",
    position: { x: 650, y: pin.y - 4 },
    data: { kind: "TIP", refdes: "", params: {} },
    style: { width: 8, height: 8 },
    measured: { width: 8, height: 8 },
  };
  const healNodes = [r, c, g, loose, railEnd];
  const healEdges: Edge[] = [
    {
      id: "rail",
      type: "schematic",
      source: "hr",
      sourceHandle: "b",
      target: "rail-end",
      targetHandle: "t",
      data: { waypoints: [] },
    },
    {
      id: "c-loose",
      type: "schematic",
      source: "hc",
      sourceHandle: "a",
      target: "loose",
      targetHandle: "t",
      data: { waypoints: [] },
    },
  ];
  const beforeHeal = extractNets(healNodes, healEdges);
  if (beforeHeal.netOf("hc", "a") === beforeHeal.netOf("hr", "b")) {
    console.error("FAIL: fixture should start as visually touching different nets");
    process.exit(1);
  }
  const healed = attachFreeTipsToWires(
    healNodes,
    healEdges,
    new Set(["loose"]),
  );
  if (healed.attached !== 1) {
    console.error("FAIL: moved free tip should attach to rail", healed);
    process.exit(1);
  }
  const afterHeal = extractNets(healed.nodes, healed.edges);
  if (afterHeal.netOf("hc", "a") !== afterHeal.netOf("hr", "b")) {
    console.error("FAIL: C pin and rail should share a net after healing");
    process.exit(1);
  }
  const marks = findWireJunctions(healed.nodes, healed.edges);
  if (
    marks.crossings.some(
      (point) => Math.hypot(point.x - pin.x, point.y - pin.y) < 2,
    )
  ) {
    console.error("FAIL: healed C-to-rail join must not show a hollow crossing");
    process.exit(1);
  }
  console.log("PASS moved free tip merges into rail without hollow crossing");
}
