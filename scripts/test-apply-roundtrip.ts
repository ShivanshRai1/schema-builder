/**
 * Problem B smoke: Edit as text → Apply must stick (values, directives, models,
 * multi-line PWL), and regenerate must keep devices → directives → models order.
 */
import type { Edge, Node } from "@xyflow/react";
import type { ComponentData, ComponentKind } from "../src/model/types";
import { defaultParams } from "../src/model/componentSpecs";
import { applyNetlistToGraph } from "../src/netlist/applyNetlistToGraph";
import { toNetlist } from "../src/netlist/toNetlist";
import {
  extractDirectives,
  extractSubcktLibraryText,
  foldSpiceContinuations,
  looksLikeFullNetlistDeck,
  upsertSpiceLibrary,
} from "../src/netlist/parseDeviceParams";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function node(
  id: string,
  kind: ComponentKind,
  refdes: string,
  x: number,
  y: number,
  params?: Record<string, string>,
): Node<ComponentData> {
  return {
    id,
    type: "component",
    position: { x, y },
    data: { kind, refdes, params: { ...defaultParams(kind), ...params } },
  };
}

function edge(
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): Edge {
  return {
    id,
    type: "schematic",
    source,
    sourceHandle,
    target,
    targetHandle,
    data: { waypoints: [] },
  };
}

// --- fold + continuations -------------------------------------------------
{
  const folded = foldSpiceContinuations(
    "V1 1 0 PWL(\n+ 0 13.5\n+ 1m 100\n+)",
  );
  assert(!folded.includes("\n+"), "continuations must join");
  assert(/PWL\(\s*0 13\.5\s+1m 100\s*\)/i.test(folded.replace(/\s+/g, " ")), "PWL body kept");
}

// --- value Apply sticks ---------------------------------------------------
{
  const nodes = [
    node("v", "BATTERY", "V1", 0, 100, { dc: "12" }),
    node("r", "R", "R1", 200, 0, { value: "10k" }),
    node("g", "GND", "", 200, 300),
  ];
  const edges = [
    edge("v-r", "v", "p", "r", "a"),
    edge("r-g", "r", "b", "g", "g"),
    edge("v-g", "v", "n", "g", "g"),
  ];
  const draft =
    "V1 mid 0 DC 12\nR1 mid 0 4.7k\n.tran 1u 10m\n.options reltol=1e-3\n.end";
  const result = applyNetlistToGraph(nodes, edges, draft);
  assert(result.updated.includes("R1"), "R1 must update");
  const r1 = result.nodes.find((n) => n.data.refdes === "R1");
  assert(r1?.data.params.value === "4.7k", `R1 value stuck, got ${r1?.data.params.value}`);

  const dirs = extractDirectives(draft);
  assert(dirs.some((d) => /^\.tran\b/i.test(d) && /10m/i.test(d)), ".tran 10m extracted");
  assert(looksLikeFullNetlistDeck(draft), "full deck detected");

  const nl = toNetlist(result.nodes, result.edges, {
    title: "rt",
    directives: dirs,
    library: "",
    autoModels: false,
  });
  assert(/R1\b.*4\.7k/i.test(nl), "regenerated netlist shows 4.7k");
  const iDir = nl.indexOf("* --- directives");
  const iEnd = nl.lastIndexOf(".end");
  assert(iDir > 0 && iDir < iEnd, "directives before .end");
  assert(nl.indexOf("R1") < iDir, "devices before directives");
}

// --- multi-line PWL sticks on VAC ----------------------------------------
{
  const nodes = [
    node("v", "VAC", "V1", 0, 100),
    node("r", "R", "R1", 200, 0, { value: "1k" }),
    node("g", "GND", "", 200, 300),
  ];
  const edges = [
    edge("v-r", "v", "p", "r", "a"),
    edge("r-g", "r", "b", "g", "g"),
    edge("v-g", "v", "n", "g", "g"),
  ];
  const draft = [
    "V1 n1 0 PWL(",
    "+ 0 13.5",
    "+ 50m 13.5",
    "+ 50.1m 100",
    "+)",
    "R1 n1 0 1k",
    ".tran 1u 100m",
    ".end",
  ].join("\n");
  const result = applyNetlistToGraph(nodes, edges, draft);
  const v1 = result.nodes.find((n) => n.data.refdes === "V1");
  assert(v1?.data.kind === "VAC", "PWL → VAC");
  assert(
    /PWL\s*\(/i.test(v1?.data.params.stimulus ?? "") && /100/i.test(v1?.data.params.stimulus ?? ""),
    `PWL stimulus stuck, got ${v1?.data.params.stimulus}`,
  );
  const nl = toNetlist(result.nodes, result.edges, {
    directives: extractDirectives(draft),
    autoModels: false,
  });
  assert(/PWL\s*\(/i.test(nl) && /100/i.test(nl), "regenerated keeps PWL");
}

// --- .model upsert (edit sticks, no silent keep-old) ---------------------
{
  const prev = ".model DZEN D (BV=5)\n";
  const extracted = extractSubcktLibraryText(
    "R1 1 0 1k\n.model DZEN D (BV=33)\n.tran 1u 1m\n.end",
  );
  const merged = upsertSpiceLibrary(prev, extracted);
  assert(/BV=33/i.test(merged), "edited .model must replace");
  assert(!/BV=5/i.test(merged), "old .model must not remain");
  assert(
    !extractDirectives("R1 1 0 1k\n.model DZEN D (BV=33)\n.tran 1u 1m\n.end").some((d) =>
      /^\.model\b/i.test(d),
    ),
    ".model must not stay in directives",
  );
}

// --- section order with library ------------------------------------------
{
  const nl = toNetlist([], [], {
    title: "order",
    directives: [".tran 1u 1m"],
    library: ".model DZEN D (Is=1e-14)",
    autoModels: false,
  });
  const iDir = nl.indexOf("* --- directives");
  const iLib = nl.indexOf("* --- .subckt library");
  const iMod = nl.indexOf(".model DZEN");
  const iEnd = nl.lastIndexOf(".end");
  assert(iDir < iLib && iLib < iEnd, "directives → library → .end");
  assert(iMod > iDir && iMod < iEnd, ".model after directives");
}

console.log("PASS apply round-trip (Problem B)");
