import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import { extractNets } from "./nets";
import {
  buildMissingBuiltinLibrary,
  collectRequiredModelNames,
  parseDefinedSpiceNames,
} from "./builtinLibrary";
import { dedupeAnalysisDirectives } from "./parseDeviceParams";
import { ensureLoadDumpPulseLibrary } from "../sim/loadDumpPulseInc";
import {
  DEFAULT_NETLIST_SECTION_ORDER,
  normalizeNetlistSectionOrder,
  type NetlistSectionId,
} from "./netlistSectionOrder";

// ---------------------------------------------------------------------------
// graph -> SPICE netlist. PURE FUNCTION: (nodes, edges) -> string.
//
// Default section order: devices → directives → models → .end
// Users may rearrange those three body sections in “edit as text”; Apply
// remembers the order via opts.sectionOrder. `.end` is always last.
// ---------------------------------------------------------------------------

export interface NetlistOptions {
  title?: string;
  /** Extra directive lines (analyses, options, markers). */
  directives?: string[];
  /** Raw .subckt / .model library text. */
  library?: string;
  /** When true (default), inject built-in models for any missing references. */
  autoModels?: boolean;
  /**
   * Order of body sections. Any permutation of devices / directives / library.
   * Omitted sections are filled in with the default relative order.
   */
  sectionOrder?: readonly NetlistSectionId[];
}

const DEFAULT_DIRECTIVES = [
  ".tran 1u 1m",
  ".options reltol=1e-3",
];

function pushBlock(lines: string[], block: string[]) {
  if (!block.length) return;
  if (lines.length && lines[lines.length - 1] !== "") lines.push("");
  lines.push(...block);
}

export function toNetlist(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  opts: NetlistOptions = {},
): string {
  const { netOf, nets } = extractNets(nodes, edges);
  const lines: string[] = [];

  const deviceCount = nodes.filter((n) => COMPONENT_SPECS[n.data.kind].emits).length;
  lines.push(`* ${opts.title ?? "SimulAI schematic"} — generated from graph`);
  lines.push(`* ${deviceCount} devices, ${nets.length} nets`);
  lines.push("");

  const userLib = ensureLoadDumpPulseLibrary(opts.library?.trim() ?? "");
  const directiveBlock = (opts.directives ?? DEFAULT_DIRECTIVES).join("\n");
  const autoModels = opts.autoModels !== false;

  // Only auto-inject pulse profiles when a load-dump *.wc marker is present
  // (avoids changing unrelated schematics' Models panel / netlist size).
  const wantsPulseLib = /\*\s*\.wc\b/i.test(directiveBlock);
  const libForDeck = wantsPulseLib ? userLib : (opts.library?.trim() ?? "");

  // --- devices -------------------------------------------------------------
  const deviceBlock: string[] = [];
  const devices = nodes
    .filter((n) => COMPONENT_SPECS[n.data.kind].emits)
    .sort((a, b) => a.data.refdes.localeCompare(b.data.refdes, undefined, { numeric: true }));

  for (const node of devices) {
    const spec = COMPONENT_SPECS[node.data.kind];
    const line = spec.toSpice(
      node.data.refdes,
      (pinId) => netOf(node.id, pinId),
      node.data.params,
    );
    if (line) deviceBlock.push(line);
  }

  const probes: string[] = [];
  for (const node of nodes) {
    const spec = COMPONENT_SPECS[node.data.kind];
    if (!spec.toProbes) continue;
    probes.push(...spec.toProbes(node.data.refdes, (pinId) => netOf(node.id, pinId), node.data.params));
  }
  if (probes.length) {
    if (deviceBlock.length) deviceBlock.push("");
    deviceBlock.push(`.save ${probes.join(" ")}`);
  }

  // --- directives ----------------------------------------------------------
  const directiveLines: string[] = ["* --- directives (pass-through / editable region) ---"];
  let dirs = dedupeAnalysisDirectives(opts.directives ?? DEFAULT_DIRECTIVES).filter(
    // Fleet rejects .include unless files are uploaded; user Models library is inlined.
    (d) => !/^\.(include|inc|lib)\b/i.test(d),
  );
  // QSPICE fatals with zero analyses — keep a default .tran if the user deleted all.
  if (!dirs.some((d) => /^\.tran\b/i.test(d))) {
    dirs = [...dirs, DEFAULT_DIRECTIVES[0]!];
  }
  for (const d of dirs) directiveLines.push(d);

  // --- models / subcircuits ------------------------------------------------
  const modelBlocks: string[] = [];
  if (autoModels) {
    const required = collectRequiredModelNames(nodes);
    const defined = parseDefinedSpiceNames(`${libForDeck}\n${directiveBlock}`);
    const builtin = buildMissingBuiltinLibrary(required, defined);
    if (builtin) modelBlocks.push(builtin.trimEnd());
  }
  if (libForDeck) {
    modelBlocks.push(
      ["* --- .subckt library (user-attached) ---", libForDeck.trimEnd()].join("\n"),
    );
  }
  const libraryBlock = modelBlocks.length
    ? modelBlocks.join("\n\n").split("\n")
    : [];

  const byId: Record<NetlistSectionId, string[]> = {
    devices: deviceBlock,
    directives: directiveLines,
    library: libraryBlock,
  };

  const order = normalizeNetlistSectionOrder(
    opts.sectionOrder ?? DEFAULT_NETLIST_SECTION_ORDER,
  );
  for (const id of order) {
    pushBlock(lines, byId[id]);
  }

  lines.push(".end");

  return lines.join("\n");
}

export type { NetlistSectionId } from "./netlistSectionOrder";
export {
  DEFAULT_NETLIST_SECTION_ORDER,
  detectNetlistSectionOrder,
  normalizeNetlistSectionOrder,
  trimNetlistAfterEnd,
} from "./netlistSectionOrder";
