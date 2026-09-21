/**
 * Any permutation of devices / directives / library must Apply + regenerate cleanly.
 */
import { toNetlist } from "../src/netlist/toNetlist";
import {
  detectNetlistSectionOrder,
  normalizeNetlistSectionOrder,
  trimNetlistAfterEnd,
  type NetlistSectionId,
} from "../src/netlist/netlistSectionOrder";
import {
  extractDirectives,
  extractSubcktLibraryText,
  parseDeviceLines,
} from "../src/netlist/parseDeviceParams";
import { applyNetlistToGraph } from "../src/netlist/applyNetlistToGraph";
import type { Edge, Node } from "@xyflow/react";
import type { ComponentData, ComponentKind } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function node(
  id: string,
  kind: ComponentKind,
  refdes: string,
  x: number,
  y: number,
): Node<ComponentData> {
  return {
    id,
    type: "component",
    position: { x, y },
    data: { kind, refdes, params: defaultParams(kind) },
  };
}

const devices = "R1 mid 0 4.7k\nV1 mid 0 DC 12";
const directives = "* --- directives (pass-through / editable region) ---\n.tran 1u 10m\n.options reltol=1e-3";
const library = "* --- .subckt library (user-attached) ---\n.model DZEN D (BV=33)";

function deck(order: NetlistSectionId[]): string {
  const map: Record<NetlistSectionId, string> = {
    devices,
    directives,
    library,
  };
  return `${order.map((id) => map[id]).join("\n\n")}\n.end\n`;
}

const permutations: NetlistSectionId[][] = [
  ["devices", "directives", "library"],
  ["devices", "library", "directives"],
  ["directives", "devices", "library"],
  ["directives", "library", "devices"],
  ["library", "devices", "directives"],
  ["library", "directives", "devices"],
];

for (const order of permutations) {
  const text = deck(order);
  const detected = detectNetlistSectionOrder(text);
  assert(
    detected.join(",") === normalizeNetlistSectionOrder(order).join(","),
    `detect failed for ${order.join("→")}: got ${detected.join("→")}`,
  );

  assert(parseDeviceLines(text).some((d) => d.refdes === "R1"), `devices parse ${order}`);
  assert(extractDirectives(text).some((d) => /^\.tran\b/i.test(d)), `dirs parse ${order}`);
  assert(/DZEN/i.test(extractSubcktLibraryText(text)), `lib parse ${order}`);

  const nodes = [
    node("v", "BATTERY", "V1", 0, 100),
    node("r", "R", "R1", 200, 0),
    node("g", "GND", "", 200, 300),
  ];
  const edges: Edge[] = [
    { id: "a", type: "schematic", source: "v", sourceHandle: "p", target: "r", targetHandle: "a", data: { waypoints: [] } },
    { id: "b", type: "schematic", source: "r", sourceHandle: "b", target: "g", targetHandle: "g", data: { waypoints: [] } },
    { id: "c", type: "schematic", source: "v", sourceHandle: "n", target: "g", targetHandle: "g", data: { waypoints: [] } },
  ];
  const result = applyNetlistToGraph(nodes, edges, text);
  assert(!result.rejected, `Apply rejected for ${order}: ${result.rejected}`);
  const r1 = result.nodes.find((n) => n.data.refdes === "R1");
  assert(r1?.data.params.value === "4.7k", `R1 value for ${order}`);

  const nl = toNetlist(result.nodes, result.edges, {
    directives: extractDirectives(text),
    library: extractSubcktLibraryText(text),
    sectionOrder: order,
    autoModels: false,
  });
  assert(nl.trimEnd().endsWith(".end"), `.end last for ${order}`);
  const iDev = nl.search(/^R1\b/m);
  const iDir = nl.indexOf("* --- directives");
  const iLib = nl.indexOf("* --- .subckt library");
  const iEnd = nl.lastIndexOf(".end");
  const pos: Record<NetlistSectionId, number> = {
    devices: iDev,
    directives: iDir,
    library: iLib,
  };
  for (let i = 0; i < order.length - 1; i++) {
    const a = pos[order[i]!];
    const b = pos[order[i + 1]!];
    assert(a >= 0 && b >= 0 && a < b, `emit order ${order} failed at ${order[i]}→${order[i + 1]}`);
  }
  assert(Math.max(iDev, iDir, iLib) < iEnd, `.end after body for ${order}`);
}

// Mid-deck .end must not leave ghost content for Apply
{
  const messy = `${devices}\n.end\n.tran 1u 99\nRghost 1 0 1\n`;
  const trimmed = trimNetlistAfterEnd(messy);
  assert(!/Rghost/.test(trimmed), "trim after .end");
  assert(!extractDirectives(trimmed).some((d) => /99/.test(d)), "no ghost .tran");
}

console.log("PASS netlist section order (all permutations)");
