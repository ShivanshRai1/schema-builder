import type { Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";

/**
 * Built-in SPICE models and placeholder subcircuits so Run works out of the box.
 * User library / directives override these when they define the same name first.
 */

/** Names referenced by emitting parts on the schematic. */
export function collectRequiredModelNames(nodes: Node<ComponentData>[]): Set<string> {
  const names = new Set<string>();
  for (const node of nodes) {
    const spec = COMPONENT_SPECS[node.data.kind];
    if (!spec.emits) continue;
    for (const attr of spec.attributes) {
      if (attr.key !== "model") continue;
      const name = (node.data.params.model ?? attr.default).trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/** Parse `.model` / `.subckt` names already present in SPICE text. */
export function parseDefinedSpiceNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    const model = /^\.model\s+(\S+)/i.exec(t);
    if (model) {
      names.add(model[1]!.toUpperCase());
      continue;
    }
    const sub = /^\.subckt\s+(\S+)/i.exec(t);
    if (sub) names.add(sub[1]!.toUpperCase());
  }
  return names;
}

const BUILTIN: Record<string, string> = {
  NMOS_GEN: ".model NMOS_GEN NMOS (level=1 Vto=2 Kp=20u)",
  PMOS_GEN: ".model PMOS_GEN PMOS (level=1 Vto=-2 Kp=10u)",
  NMOS_DEP: ".model NMOS_DEP NMOS (level=1 Vto=-1 Kp=20u)",
  PMOS_DEP: ".model PMOS_DEP PMOS (level=1 Vto=1 Kp=10u)",
  NJF: ".model NJF NJF (Vto=-2 Beta=1e-3 Lambda=1e-4)",
  PJF: ".model PJF PJF (Vto=2 Beta=1e-3 Lambda=1e-4)",
  NPN_GEN: ".model NPN_GEN NPN (Is=1e-14 Bf=100)",
  PNP_GEN: ".model PNP_GEN PNP (Is=1e-14 Bf=100)",
  DGEN: ".model DGEN D (Is=1e-12)",
  DZEN: ".model DZEN D (Is=1e-12 Bv=5 Ibv=1e-3)",
  SW_GEN: ".model SW_GEN SW(Ron=0.1 Roff=1Meg Vt=0.5 Vh=0.1)",

  SIC_MOS: [
    ".subckt SIC_MOS d g s",
    "M1 d g s s NMOS_GEN",
    ".ends SIC_MOS",
  ].join("\n"),

  SIC_MOS_KELVIN: [
    ".subckt SIC_MOS_KELVIN d g s sk",
    "M1 d g s s NMOS_GEN",
    "Rkel s sk 1m",
    ".ends SIC_MOS_KELVIN",
  ].join("\n"),

  GAN_HEMT: [
    ".subckt GAN_HEMT d g s",
    "M1 d g s s NMOS_GEN",
    ".ends GAN_HEMT",
  ].join("\n"),

  IGBT_GEN: [
    ".subckt IGBT_GEN c g e",
    "M1 c g e e NMOS_GEN",
    ".ends IGBT_GEN",
  ].join("\n"),

  IGBT_KELVIN: [
    ".subckt IGBT_KELVIN c g e ek",
    "M1 c g e e NMOS_GEN",
    "Rkel e ek 1m",
    ".ends IGBT_KELVIN",
  ].join("\n"),

  SCR_GEN: [
    ".subckt SCR_GEN a k g",
    "S1 a k g 0 SW_GEN",
    ".ends SCR_GEN",
  ].join("\n"),

  GATEDRV_GEN: [
    ".subckt GATEDRV_GEN in out vdd gnd",
    "E1 out gnd in gnd 1",
    ".ends GATEDRV_GEN",
  ].join("\n"),

  COMP_GEN: [
    ".subckt COMP_GEN inp inn out",
    "E1 out 0 inp inn 1e6",
    "Rout out 0 1",
    ".ends COMP_GEN",
  ].join("\n"),

  OPAMP_GEN: [
    ".subckt OPAMP_GEN inp inn out",
    "E1 out 0 inp inn 1e6",
    "Rout out 0 1",
    ".ends OPAMP_GEN",
  ].join("\n"),

  OPAMP: [
    ".subckt OPAMP inp inn out",
    "E1 out 0 inp inn 1e6",
    "Rout out 0 1",
    ".ends OPAMP",
  ].join("\n"),

  OPAMP5: [
    ".subckt OPAMP5 inp inn out vplus vminus",
    "E1 out vminus inp inn 1e6",
    "Rout out vminus 1",
    ".ends OPAMP5",
  ].join("\n"),
};

/** Dependency order: primitive models before subcircuits that reference them. */
const EMIT_ORDER = [
  "NMOS_GEN",
  "PMOS_GEN",
  "NMOS_DEP",
  "PMOS_DEP",
  "NJF",
  "PJF",
  "NPN_GEN",
  "PNP_GEN",
  "DGEN",
  "DZEN",
  "SW_GEN",
  "SIC_MOS",
  "SIC_MOS_KELVIN",
  "GAN_HEMT",
  "IGBT_GEN",
  "IGBT_KELVIN",
  "SCR_GEN",
  "GATEDRV_GEN",
  "COMP_GEN",
  "OPAMP_GEN",
  "OPAMP",
  "OPAMP5",
];

function expandWithDependencies(names: Iterable<string>): string[] {
  const want = new Set<string>();
  for (const raw of names) {
    const key = raw.trim();
    if (!key) continue;
    const hit = Object.keys(BUILTIN).find((k) => k.toUpperCase() === key.toUpperCase());
    if (hit) want.add(hit);
  }
  // Subcircuits that wrap NMOS_GEN need that model too.
  if (
    want.has("SIC_MOS") ||
    want.has("SIC_MOS_KELVIN") ||
    want.has("GAN_HEMT") ||
    want.has("IGBT_GEN") ||
    want.has("IGBT_KELVIN")
  ) {
    want.add("NMOS_GEN");
  }
  if (want.has("SCR_GEN")) want.add("SW_GEN");
  return EMIT_ORDER.filter((k) => want.has(k));
}

/**
 * Build SPICE library text for model/subckt names not already defined elsewhere.
 * Returns empty string when nothing is missing.
 */
export function buildMissingBuiltinLibrary(
  required: Set<string>,
  alreadyDefined: Set<string>,
): string {
  const missing = [...required].filter((n) => !alreadyDefined.has(n.toUpperCase()));
  if (!missing.length) return "";

  const ordered = expandWithDependencies(missing);
  const blocks: string[] = [];
  const emitted = new Set(alreadyDefined);

  for (const key of ordered) {
    if (emitted.has(key.toUpperCase())) continue;
    const body = BUILTIN[key];
    if (!body) continue;
    blocks.push(body);
    emitted.add(key.toUpperCase());
  }

  if (!blocks.length) return "";
  return [
    "* --- built-in models (auto — replace via .subckt library for vendor accuracy) ---",
    ...blocks,
  ].join("\n");
}
