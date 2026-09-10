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

// ---------------------------------------------------------------------------
// graph -> SPICE netlist. PURE FUNCTION: (nodes, edges) -> string.
//
// This is the derived projection. Because it is pure and deterministic it is
// trivially unit-testable and re-runs on every graph change to drive the live
// (read-only in step 1) Monaco panel.
//
// The trailing directive block is a pass-through region: in step 1 it is a
// static template; later it becomes the user-editable area that survives
// round-tripping (models, .tran, .options), since it never maps to graph nodes.
// ---------------------------------------------------------------------------

export interface NetlistOptions {
  title?: string;
  /** Extra directive lines appended verbatim (models, analyses, options). */
  directives?: string[];
  /** Raw .subckt / .model library text inserted before device lines. */
  library?: string;
  /** When true (default), inject built-in models for any missing references. */
  autoModels?: boolean;
}

const DEFAULT_DIRECTIVES = [
  ".tran 1u 1m",
  ".options reltol=1e-3",
];

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

  const userLib = opts.library?.trim() ?? "";
  const directiveBlock = (opts.directives ?? DEFAULT_DIRECTIVES).join("\n");
  const autoModels = opts.autoModels !== false;

  if (autoModels) {
    const required = collectRequiredModelNames(nodes);
    const defined = parseDefinedSpiceNames(`${userLib}\n${directiveBlock}`);
    const builtin = buildMissingBuiltinLibrary(required, defined);
    if (builtin) {
      lines.push(builtin);
      lines.push("");
    }
  }

  if (userLib) {
    lines.push("* --- .subckt library (user-attached) ---");
    lines.push(userLib);
    lines.push("");
  }

  // One line per emitting device, ordered by refdes for stable output.
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
    if (line) lines.push(line);
  }

  // Probes / senses -> a .save line (know what to measure).
  const probes: string[] = [];
  for (const node of nodes) {
    const spec = COMPONENT_SPECS[node.data.kind];
    if (!spec.toProbes) continue;
    probes.push(...spec.toProbes(node.data.refdes, (pinId) => netOf(node.id, pinId), node.data.params));
  }
  if (probes.length) {
    lines.push("");
    lines.push(`.save ${probes.join(" ")}`);
  }

  lines.push("");
  lines.push("* --- directives (pass-through / editable region) ---");
  let dirs = dedupeAnalysisDirectives(opts.directives ?? DEFAULT_DIRECTIVES).filter(
    // Fleet rejects .include unless files are uploaded; user Models library is inlined above.
    (d) => !/^\.(include|inc|lib)\b/i.test(d),
  );
  // QSPICE fatals with zero analyses — keep a default .tran if the user deleted all.
  if (!dirs.some((d) => /^\.tran\b/i.test(d))) {
    dirs = [...dirs, DEFAULT_DIRECTIVES[0]!];
  }
  for (const d of dirs) lines.push(d);
  lines.push(".end");

  return lines.join("\n");
}
