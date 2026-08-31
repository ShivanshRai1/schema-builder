/**
 * 1-grid stair between facing R↔C pins should plan a part nudge so the run
 * can be truly horizontal.
 */
import type { Edge, Node } from "@xyflow/react";
import { defaultParams } from "../src/model/componentSpecs";
import type { ComponentData } from "../src/model/types";
import { pinWorldPoint } from "../src/wiring/pinGeometry";
import {
  finalizeConnectedPartMove,
  planNearAlignPartNudge,
  straightenWire,
} from "../src/wiring/wireMove";
import { WIRE_GRID } from "../src/wiring/orthogonal";

const mk = (
  id: string,
  kind: "R" | "C",
  x: number,
  y: number,
): Node<ComponentData> => ({
  id,
  type: "component",
  position: { x, y },
  data: { kind, refdes: kind === "R" ? "R1" : "C1", params: defaultParams(kind) },
});

// R and C facing left/right, C two grids above R → still a "small" stair.
const r = mk("r", "R", 200, 160);
const c = mk("c", "C", 360, 160 - WIRE_GRID * 2);
const edge: Edge = {
  id: "rc",
  type: "schematic",
  source: "r",
  sourceHandle: "b",
  target: "c",
  targetHandle: "a",
  data: { waypoints: [] },
};
const nodes = [r, c];
const edges = [edge];

const rb = pinWorldPoint(r, "b")!;
const ca = pinWorldPoint(c, "a")!;
if (Math.abs(rb.y - ca.y) !== WIRE_GRID * 2) {
  console.error("setup: expected 2-grid Y offset", rb, ca);
  process.exit(1);
}

const nudge = planNearAlignPartNudge(nodes, edges, edge, { preferMoveId: "c" });
if (!nudge || nudge.id !== "c") {
  console.error("FAIL: should nudge C", nudge);
  process.exit(1);
}
if (Math.abs(nudge.y - (c.position.y + WIRE_GRID * 2)) > 0.5) {
  console.error("FAIL: C should drop two grids", nudge, c.position);
  process.exit(1);
}

const straight = straightenWire(nodes, edge, undefined, edges);
if (!straight?.tipMoves?.length) {
  console.error("FAIL: straightenWire should nudge a part", straight);
  process.exit(1);
}
const moved = straight.tipMoves[0]!;
if (moved.id !== "r" && moved.id !== "c") {
  console.error("FAIL: unexpected nudge target", moved);
  process.exit(1);
}

const finalized = finalizeConnectedPartMove(nodes, edges, new Set(["c"]));
const c2 = finalized.nodes.find((n) => n.id === "c")!;
const r2 = finalized.nodes.find((n) => n.id === "r")!;
const y1 = pinWorldPoint(r2, "b")!.y;
const y2 = pinWorldPoint(c2, "a")!.y;
if (Math.abs(y1 - y2) > 0.5) {
  console.error("FAIL: finalize should align pin Y", y1, y2, c2.position);
  process.exit(1);
}

console.log("OK near-align stair → straight");
