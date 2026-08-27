/**
 * Regression: a wire leaving a pin must never double back across its own part.
 *
 * Reproduces the reported graph exactly (from __dumpWires):
 *   n3 kind=C pos=(480,144)   pins a=(480,160) b=(544,160)
 *   n4 kind=GND pos=(280,360) pin  g=(296,360)
 *   edge n3b-n4g routed (544,160) (560,160) (296,160) (296,344) (296,360)
 * which passes through (480,160) — C1's own left pin — producing a hollow
 * different-nets crossing ring there.
 */
import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { autorouteWiresForMovedParts } from "../src/wiring/wireMove";
import { computeEdgePolyline } from "../src/wiring/wireGeometry";
import { findWireJunctions } from "../src/wiring/junctions";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const node = (
  id: string,
  kind: ComponentData["kind"],
  x: number,
  y: number,
): Node<ComponentData> =>
  ({
    id,
    type: "component",
    position: { x, y },
    data: { kind, refdes: id, params: {}, rotation: 0 },
  }) as Node<ComponentData>;

const nodes: Node<ComponentData>[] = [
  node("n1", "V", 40, 180),
  node("n2", "R", 160, 144),
  node("n3", "C", 480, 144),
  node("n4", "GND", 280, 360),
];

const edges: Edge[] = [
  { id: "n1p-n2a", source: "n1", sourceHandle: "p", target: "n2", targetHandle: "a" },
  { id: "n2b-n3a", source: "n2", sourceHandle: "b", target: "n3", targetHandle: "a" },
  {
    id: "n3b-n4g",
    source: "n3",
    sourceHandle: "b",
    target: "n4",
    targetHandle: "g",
    // The stale waypoint that produced the backtracking route.
    data: { waypoints: [{ x: 296, y: 160 }] },
  },
  { id: "n1n-n4g", source: "n1", sourceHandle: "n", target: "n4", targetHandle: "g" },
];

// C1 (n3) was the part that moved.
const routed = autorouteWiresForMovedParts(nodes, edges, new Set(["n3"]));

const gndEdge = routed.find((e) => e.id === "n3b-n4g")!;
const poly = computeEdgePolyline(nodes, gndEdge);
console.log("  routed poly:", poly.map((p) => `(${p.x},${p.y})`).join(" "));

// The route must not pass through C1's own left pin at (480,160).
const crossesOwnPin = poly.some((p, i) => {
  if (i === 0) return false;
  const a = poly[i - 1]!;
  const b = p;
  if (Math.abs(a.y - 160) > 0.5 || Math.abs(b.y - 160) > 0.5) return false;
  return Math.min(a.x, b.x) <= 480 && 480 <= Math.max(a.x, b.x);
});
check("route does not cross C1's own left pin (480,160)", !crossesOwnPin);

// And the rendered marks must show no hollow crossing ring anywhere.
const marks = findWireJunctions(nodes, routed);
console.log(
  "  marks: filled=",
  JSON.stringify(marks.junctions.map((p) => [Math.round(p.x), Math.round(p.y)])),
  " hollow=",
  JSON.stringify(marks.crossings.map((p) => [Math.round(p.x), Math.round(p.y)])),
);
check(
  "no hollow crossing ring is produced",
  marks.crossings.length === 0,
  `got ${JSON.stringify(marks.crossings)}`,
);

process.exit(failures ? 1 : 0);
