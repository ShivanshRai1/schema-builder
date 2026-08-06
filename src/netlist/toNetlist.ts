import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import { extractNets } from "./nets";

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
}

const DEFAULT_DIRECTIVES = [
  ".model NMOS_GEN NMOS (level=1 Vto=2 Kp=20u)",
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

  const lib = opts.library?.trim();
  if (lib) {
    lines.push("* --- .subckt library (user-attached) ---");
    lines.push(lib);
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
  for (const d of opts.directives ?? DEFAULT_DIRECTIVES) lines.push(d);
  lines.push(".end");

  return lines.join("\n");
}
