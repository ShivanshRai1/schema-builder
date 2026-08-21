import { detachPartForMove } from "../src/wiring/cutMove";
import { defaultParams } from "../src/model/componentSpecs";
import type { ComponentData } from "../src/model/types";
import type { Edge, Node } from "@xyflow/react";

const mk = (
  id: string,
  kind: "V" | "R" | "GND",
  refdes: string,
  x: number,
  y: number,
): Node<ComponentData> => ({
  id,
  type: "component",
  position: { x, y },
  data: { kind, refdes, params: { ...defaultParams(kind) } },
});

const wire = (
  s: string,
  sh: string,
  t: string,
  th: string,
  wps: { x: number; y: number }[],
): Edge => ({
  id: `${s}${sh}-${t}${th}`,
  type: "schematic",
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
  data: { waypoints: wps },
});

const nodes = [
  mk("n1", "V", "V1", 40, 180),
  mk("n2", "R", "R1", 280, 90),
  mk("n4", "GND", "", 280, 360),
];
const edges = [
  wire("n1", "p", "n2", "a", [
    { x: 160, y: 180 },
    { x: 160, y: 117 },
  ]),
  wire("n1", "n", "n4", "g", [
    { x: 86, y: 300 },
    { x: 280, y: 300 },
  ]),
];

let id = 10;
const r = detachPartForMove(nodes, edges, "n1", () => `n${++id}`, { x: 40, y: 200 });

// Detach must FREEZE the wire in place: every wire that touched the moved part
// now ends at a TIP and keeps its rendered geometry (waypoints), so the wire does
// not shift by a single pixel when the part leaves.
const tipIds = new Set(
  r.nodes.filter((n) => n.data.kind === "TIP").map((n) => n.id),
);
if (tipIds.size !== r.cutCount) {
  console.error("FAIL expected one tip per cut", tipIds.size, r.cutCount);
  process.exit(1);
}
const detached = r.edges.filter(
  (e) => tipIds.has(e.source) || tipIds.has(e.target),
);
if (detached.length !== r.cutCount) {
  console.error("FAIL detached edge count", detached.length, r.cutCount);
  process.exit(1);
}
for (const e of detached) {
  const w = (e.data as { waypoints?: unknown[] } | undefined)?.waypoints ?? [];
  if (!w.length) {
    console.error("FAIL frozen wire lost its geometry", e.id, w);
    process.exit(1);
  }
}
console.log(
  "PASS frozen waypoints preserved, tips",
  tipIds.size,
  "cuts",
  r.cutCount,
);
