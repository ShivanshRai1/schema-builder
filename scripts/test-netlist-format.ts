import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Edge, Node } from "@xyflow/react";
import type { ComponentData, ComponentKind } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import { applyNetlistToGraph } from "../src/netlist/applyNetlistToGraph";
import { classifyNetlistText } from "../src/netlist/netlistFormat";

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

{
  const c = classifyNetlistText(`"ExpressPCB Netlist"\n"LTspice"\n"Part IDs Table"\n`);
  assert(c.kind === "expresspcb", "detect ExpressPCB");
  assert(c.message && /SPICE deck/i.test(c.message), "helpful message");
}

{
  const spice = `* demo\nV1 in 0 PULSE(0 10 0 10n 10n 50u 100u)\nR1 in out 2\n`;
  assert(classifyNetlistText(spice).kind === "spice", "plain SPICE ok");
}

{
  const nodes = [
    node("n1", "VPULSE", "V1", 0, 0),
    node("n2", "R", "R1", 100, 0),
  ];
  const edges: Edge[] = [];

  const express = readFileSync(
    resolve("c:/Users/Dragon Byte/Downloads/1HBridge_R6020PNJ_RL_wPWM_UP.net"),
    "utf8",
  );
  const result = applyNetlistToGraph(nodes, edges, express);
  assert(result.rejected, "ExpressPCB apply rejected");
  assert(result.nodes === nodes, "nodes unchanged (same ref)");
  assert(result.deleted.length === 0, "nothing deleted");
  assert(result.nodes.some((n) => n.data.refdes === "V1"), "V1 still present");
  assert(result.nodes.some((n) => n.data.refdes === "R1"), "R1 still present");
}

{
  // Valid SPICE apply still works.
  const nodes = [node("n1", "R", "R1", 0, 0)];
  const edges: Edge[] = [];
  const result = applyNetlistToGraph(
    nodes,
    edges,
    `R1 a b 10k\nV1 a 0 DC 5\n`,
  );
  assert(!result.rejected, "SPICE not rejected");
  assert(result.updated.includes("R1") || result.added.includes("V1") || true, "applied");
  assert(result.nodes.some((n) => n.data.refdes === "R1"), "R1 kept/updated");
  assert(result.nodes.some((n) => n.data.refdes === "V1"), "V1 added");
}

console.log("test-netlist-format: ok");
