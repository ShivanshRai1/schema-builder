import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import { findWireJunctions } from "../src/wiring/junctions";

const mk = (
  id: string,
  kind: "R" | "C" | "GND" | "V" | "TIP",
  x: number,
  y: number,
): Node<ComponentData> => ({
  id,
  type: "component",
  position: { x, y },
  data:
    kind === "TIP"
      ? { kind: "TIP", refdes: "", params: {} }
      : {
          kind,
          refdes: kind === "GND" ? "" : `${kind}1`,
          params: { ...defaultParams(kind) },
        },
  ...(kind === "TIP"
    ? { style: { width: 8, height: 8 }, measured: { width: 8, height: 8 } }
    : {}),
});

const tipAt = (id: string, x: number, y: number): Node<ComponentData> => ({
  id,
  type: "component",
  position: { x, y: y - 4 },
  data: { kind: "TIP", refdes: "", params: {} },
  style: { width: 8, height: 8 },
  measured: { width: 8, height: 8 },
});

const wire = (
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

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

// Shared TIP junction (degree 2) → filled junction mark.
{
  const tip = tipAt("tip", 200, 100);
  const nodes: Node<ComponentData>[] = [mk("r", "R", 40, 88), mk("c", "C", 320, 88), tip];
  const edges: Edge[] = [
    wire("e1", "r", "b", "tip", "t"),
    wire("e2", "tip", "t", "c", "a"),
  ];
  const marks = findWireJunctions(nodes, edges);
  assert(marks.junctions.length >= 1, "shared TIP should mark a junction");
}

// Single wire → no invented marks.
{
  const nodes: Node<ComponentData>[] = [mk("r", "R", 0, 0), mk("c", "C", 200, 0)];
  const edges: Edge[] = [wire("h", "r", "b", "c", "a")];
  const marks = findWireJunctions(nodes, edges);
  assert(marks.junctions.length === 0, "single wire should not invent junctions");
  assert(marks.crossings.length === 0, "single wire should not invent crossings");
}

// Different-net: free tip of a vertical sits on a horizontal → hollow crossing.
{
  const hL = tipAt("hL", 0, 100);
  const hR = tipAt("hR", 200, 100);
  const vT = tipAt("vT", 100, 100); // tip parked on the horizontal
  const vB = tipAt("vB", 100, 200);
  const nodes = [hL, hR, vT, vB];
  const edges = [wire("H", "hL", "t", "hR", "t"), wire("V", "vT", "t", "vB", "t")];
  const marks = findWireJunctions(nodes, edges);
  assert(
    marks.crossings.length >= 1,
    `different-net tip-on-wire should be a crossing, got j=${marks.junctions.length} c=${marks.crossings.length}`,
  );
  assert(marks.junctions.length === 0, "different-net should not be a filled junction");
}

// Mid-mid cross of two free wires → hop.
{
  const nodes = [
    tipAt("hL", 0, 100),
    tipAt("hR", 200, 100),
    tipAt("vT", 100, 0),
    tipAt("vB", 100, 200),
  ];
  const edges = [wire("H", "hL", "t", "hR", "t"), wire("V", "vT", "t", "vB", "t")];
  const marks = findWireJunctions(nodes, edges);
  assert(marks.crossings.length >= 1, "mid-mid free cross should hop");
  assert(marks.junctions.length === 0, "mid-mid free cross should not join");
}

// One wire that snakes over itself → hop (not a join square).
{
  const a = tipAt("a", 0, 0);
  const b = tipAt("b", 0, 200);
  const nodes = [a, b];
  const edges: Edge[] = [
    {
      id: "snake",
      type: "schematic",
      source: "a",
      sourceHandle: "t",
      target: "b",
      targetHandle: "t",
      data: {
        waypoints: [
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 50, y: 100 },
          { x: 50, y: 50 },
          { x: 150, y: 50 },
          { x: 150, y: 200 },
        ],
      },
    },
  ];
  const marks = findWireJunctions(nodes, edges);
  assert(
    marks.crossings.length >= 1,
    `self-cross should hop, got j=${marks.junctions.length} c=${marks.crossings.length}`,
  );
}

// Wire ends on its own earlier rail (self-T) → filled square.
{
  const nodes = [tipAt("A", 0, 0), tipAt("B", 100, 100)];
  const edges: Edge[] = [
    {
      id: "selfT",
      type: "schematic",
      source: "A",
      sourceHandle: "t",
      target: "B",
      targetHandle: "t",
      data: {
        directPath: true,
        waypoints: [
          { x: 0, y: 100 },
          { x: 200, y: 100 },
        ],
      },
    },
  ];
  const marks = findWireJunctions(nodes, edges);
  assert(
    marks.junctions.some((p) => Math.abs(p.x - 100) < 2 && Math.abs(p.y - 100) < 2),
    `self-T needs square, got ${JSON.stringify(marks)}`,
  );
}

console.log("PASS wire junctions");
