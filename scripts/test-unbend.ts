import {
  applyInsertBend,
  applyFlipJog,
  flattenWire,
  applyRemoveBend,
  interiorCornerIndices,
} from "../src/wiring/wireMove";
import { computeEdgePolyline } from "../src/wiring/wireGeometry";
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

const nodes: Node<ComponentData>[] = [tip("a", 0, 0), tip("b", 160, 0)];
const edge: Edge = {
  id: "e1",
  type: "schematic",
  source: "a",
  sourceHandle: "t",
  target: "b",
  targetHandle: "t",
  data: { waypoints: [] },
};

const base = computeEdgePolyline(nodes, edge);
const one = applyInsertBend(nodes, edge, 0, { x: 80, y: 32 }, base);
if (!one || one.waypoints.length < 2) {
  console.error("FAIL: first insert should add a U-jog", one);
  process.exit(1);
}

const resized = applyInsertBend(nodes, edge, 0, { x: 80, y: 64 }, base);
if (!resized || resized.waypoints.length !== one.waypoints.length) {
  console.error(
    "FAIL: dragging the same segment should resize the jog, not stack bends",
    { one: one.waypoints, resized: resized?.waypoints },
  );
  process.exit(1);
}
const oneY = Math.max(...one.waypoints.map((p) => Math.abs(p.y)));
const resizedY = Math.max(...resized.waypoints.map((p) => Math.abs(p.y)));
if (resizedY <= oneY) {
  console.error("FAIL: further drag should grow the jog", oneY, resizedY);
  process.exit(1);
}

const edge2: Edge = { ...edge, data: { waypoints: one.waypoints } };
const poly2 = computeEdgePolyline(nodes, edge2);
let extraSeg = -1;
for (let i = 0; i < poly2.length - 1; i++) {
  const a = poly2[i]!;
  const b = poly2[i + 1]!;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len >= 28) extraSeg = i;
}
if (extraSeg < 0) {
  console.error("FAIL: expected a long segment to add another jog", poly2);
  process.exit(1);
}
const two = applyInsertBend(nodes, edge2, extraSeg, { x: 20, y: -32 });
if (!two || two.waypoints.length <= one.waypoints.length) {
  console.error("FAIL: second insert on another segment should add more bends", two, one);
  process.exit(1);
}

const flat = flattenWire(nodes, { ...edge, data: { waypoints: two.waypoints } });
if (!flat || flat.waypoints.length !== 0) {
  console.error("FAIL: flatten should clear all bends", flat);
  process.exit(1);
}

const edgeU: Edge = { ...edge, data: { waypoints: one.waypoints } };
const polyU = computeEdgePolyline(nodes, edgeU);
const corners = interiorCornerIndices(polyU);
if (corners.length < 2) {
  console.error("FAIL: U-jog should have corners", polyU);
  process.exit(1);
}
const removed = applyRemoveBend(nodes, edgeU, corners[0]!);
if (!removed || removed.waypoints.length >= one.waypoints.length) {
  console.error("FAIL: clicking a U-jog corner should collapse it", removed, one);
  process.exit(1);
}

const Lnodes: Node<ComponentData>[] = [tip("a", 0, 0), tip("b", 80, 80)];
const Ledge: Edge = {
  ...edge,
  data: { waypoints: [{ x: 80, y: 0 }] },
};
const unbent = applyRemoveBend(Lnodes, Ledge, 1);
if (!unbent?.tipMoves?.length) {
  console.error("FAIL: last L on free tips should unbend by moving a tip", unbent);
  process.exit(1);
}

const stillL = applyInsertBend(Lnodes, Ledge, 0, { x: 80, y: 0 }, computeEdgePolyline(Lnodes, Ledge));
if (stillL) {
  console.error("FAIL: cursor on the segment must not insert during a live drag", stillL);
  process.exit(1);
}

const clickJog = applyInsertBend(nodes, edge, 0, { x: 80, y: 32 }, base);
if (!clickJog || clickJog.waypoints.length < 2) {
  console.error("FAIL: click-offset should add a C-jog on a straight wire", clickJog);
  process.exit(1);
}

const cNodes: Node<ComponentData>[] = [tip("a", 0, 0), tip("b", 0, 48)];
const cEdge: Edge = {
  ...edge,
  target: "b",
  data: { waypoints: [{ x: 80, y: 0 }, { x: 80, y: 48 }] },
};
const cPoly = computeEdgePolyline(cNodes, cEdge);
let bottomSeg = -1;
for (let i = 0; i < cPoly.length - 1; i++) {
  const p = cPoly[i]!;
  const q = cPoly[i + 1]!;
  if (Math.abs(p.y - 48) < 1 && Math.abs(q.y - 48) < 1) bottomSeg = i;
}
if (bottomSeg < 0) {
  console.error("FAIL: expected a bottom bar on the C", cPoly);
  process.exit(1);
}
const opposite = applyFlipJog(cNodes, cEdge, bottomSeg);
if (!opposite || opposite.waypoints.length !== 2) {
  console.error("FAIL: click bottom of C should flip to opposite C", opposite, cPoly);
  process.exit(1);
}
if (opposite.waypoints.some((p) => p.x > 0.5)) {
  console.error("FAIL: opposite C should open to the left (−x), not a staircase", opposite);
  process.exit(1);
}
const back = applyFlipJog(
  cNodes,
  { ...cEdge, data: { waypoints: opposite.waypoints } },
  bottomSeg,
);
if (!back || back.waypoints.some((p) => p.x < -0.5)) {
  console.error("FAIL: flipping again should restore the original C", back, opposite);
  process.exit(1);
}

const uEdge: Edge = { ...edge, data: { waypoints: one.waypoints } };
const uPoly = computeEdgePolyline(nodes, uEdge);
let uBar = -1;
for (let i = 0; i < uPoly.length - 1; i++) {
  const p = uPoly[i]!;
  const q = uPoly[i + 1]!;
  if (Math.abs(p.y - q.y) < 0.5 && Math.abs(p.y) > 1) uBar = i;
}
if (uBar < 0) {
  console.error("FAIL: expected U-jog bar", uPoly);
  process.exit(1);
}
const uFlip = applyFlipJog(nodes, uEdge, uBar);
const yBefore = one.waypoints.filter((p) => Math.abs(p.y) > 1).map((p) => Math.sign(p.y));
const yAfter = (uFlip?.waypoints ?? []).filter((p) => Math.abs(p.y) > 1).map((p) => Math.sign(p.y));
if (!uFlip || yAfter.length < 1 || yAfter.some((s, i) => s === yBefore[i])) {
  console.error("FAIL: click U bar should invert to the opposite side", {
    one: one.waypoints,
    uFlip: uFlip?.waypoints,
  });
  process.exit(1);
}

console.log("PASS add/resize/collapse bends + flatten + last-L unbend + opposite C");
