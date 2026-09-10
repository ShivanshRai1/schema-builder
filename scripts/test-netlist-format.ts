/**
 * ExpressPCB convert + Apply, and ensure plain SPICE Apply still works.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Edge, Node } from "@xyflow/react";
import type { ComponentData, ComponentKind } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import { applyNetlistToGraph } from "../src/netlist/applyNetlistToGraph";
import { classifyNetlistText } from "../src/netlist/netlistFormat";
import {
  convertExpressPcbText,
  parseExpressPcb,
} from "../src/netlist/expresspcb";
import { toNetlist } from "../src/netlist/toNetlist";

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

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const expressPath = resolve("examples/hbridge-expresspcb.net");
const express = readFileSync(expressPath, "utf8");

{
  const c = classifyNetlistText(express);
  assert(c.kind === "expresspcb", "detect ExpressPCB");
}

{
  const spice = `* demo\nV1 in 0 PULSE(0 10 0 10n 10n 50u 100u)\nR1 in out 2\n`;
  assert(classifyNetlistText(spice).kind === "spice", "plain SPICE ok");
}

{
  const parsed = parseExpressPcb(express);
  assert(parsed, "parse ok");
  assert(parsed!.netNames.get(1) === "Vin" || [...parsed!.netNames.values()].includes("Vin"), "Vin named");
  // Net Names index points at first connection; net 2 should be G_Q1
  const gq1 = [...parsed!.netNames.entries()].find(([, n]) => n === "G_Q1");
  assert(gq1, "G_Q1 present");
}

{
  const conv = convertExpressPcbText(express);
  assert(!("error" in conv), "convert ok");
  if ("error" in conv) throw new Error(conv.error);
  const refs = new Set(conv.devices.map((d) => d.refdes));
  assert(refs.has("Q1") && refs.has("Q4"), "FETs mapped");
  assert(refs.has("Vin") && refs.has("Lout") && refs.has("R"), "passives mapped");
  const q1 = conv.devices.find((d) => d.refdes === "Q1")!;
  assert(q1.kind === "SICMOS", "Q1 → SICMOS");
  assert(q1.pins.d === "Vin", "Q1.d on Vin");
  assert(q1.pins.s === "A", "Q1.s on A");
  const v1 = conv.devices.find((d) => d.refdes === "V1")!;
  assert(v1.kind === "VPULSE", "V1 → VPULSE");
}

{
  const nodes = [
    node("n1", "VPULSE", "V1", 0, 0),
    node("n2", "R", "R1", 100, 0),
  ];
  const edges: Edge[] = [];
  const result = applyNetlistToGraph(nodes, edges, express);
  assert(!result.rejected, "ExpressPCB apply not rejected");
  assert(result.convertedFrom === "expresspcb", "flag set");
  assert(result.added.includes("Q1") || result.updated.includes("Q1") || result.nodes.some((n) => n.data.refdes === "Q1"), "Q1 on canvas");
  assert(result.nodes.some((n) => n.data.kind === "SICMOS"), "SICMOS present");
  assert(result.nodes.some((n) => n.data.refdes === "Vin"), "Vin present");
  assert(result.rewired, "rewired");
  // Old starter R1 should be gone (not in ExpressPCB)
  assert(!result.nodes.some((n) => n.data.refdes === "R1"), "R1 removed");

  const nl = toNetlist(result.nodes as Node<ComponentData>[], result.edges, {
    title: "expresspcb",
    directives: [".tran 1u 500u"],
  });
  assert(nl.includes("SIC_MOS"), "netlist has SIC_MOS");
  assert(/PULSE\(/i.test(nl), "netlist has PULSE");
  assert(!/V=if/i.test(nl), "no behavioral if in netlist");
}

{
  // Valid SPICE apply still works (unchanged path).
  const nodes = [node("n1", "R", "R1", 0, 0)];
  const edges: Edge[] = [];
  const result = applyNetlistToGraph(
    nodes,
    edges,
    `R1 a b 10k\nV1 a 0 DC 5\n`,
  );
  assert(!result.rejected, "SPICE not rejected");
  assert(!result.convertedFrom, "not expresspcb");
  assert(result.nodes.some((n) => n.data.refdes === "R1"), "R1 kept/updated");
  assert(result.nodes.some((n) => n.data.refdes === "V1"), "V1 added");
}

{
  // Foreign quoted garbage still refused.
  const junk = `"foo"\n"bar"\n"baz"\n"qux"\n"one"\n"two"\n"three"\n`;
  const nodes = [node("n1", "R", "R1", 0, 0)];
  const result = applyNetlistToGraph(nodes, [], junk);
  assert(result.rejected, "foreign refused");
  assert(result.nodes === nodes, "unchanged");
}

console.log("test-netlist-format: ok");
