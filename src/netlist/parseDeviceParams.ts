import type { ComponentKind } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";

/**
 * Step-2 netlist parsing helpers.
 * Used for param patch (B), add/delete (C), and rewire (D).
 */

/** How many leading net tokens toSpice emits before value/model. */
export function netTokenCount(kind: ComponentKind): number {
  // NMOS/PMOS emit bulk tied to source: D G S S
  if (kind === "NMOS" || kind === "PMOS") return 4;
  return COMPONENT_SPECS[kind].pins.length;
}

/**
 * Pin ids in the same order as toSpice net arguments.
 * Duplicate "s" for MOSFET matches the 4-token emission (D G S S).
 */
export function spicePinOrder(kind: ComponentKind): string[] {
  switch (kind) {
    case "R":
    case "L":
    case "C":
    case "CSENSE":
    case "IPROBE":
      return ["a", "b"];
    case "V":
    case "I":
      return ["p", "n"];
    case "D":
      return ["a", "k"];
    case "NMOS":
    case "PMOS":
      return ["d", "g", "s", "s"];
    case "SICMOS":
    case "GANHEMT":
      return ["d", "g", "s"];
    case "SICMOS_K":
      return ["d", "g", "s", "sk"];
    case "IGBT":
      return ["c", "g", "e"];
    case "IGBT_K":
      return ["c", "g", "e", "ek"];
    case "NPN":
    case "PNP":
      return ["c", "b", "e"];
    case "SCR":
      return ["a", "k", "g"];
    case "GATEDRV":
      return ["in", "out", "vdd", "gnd"];
    case "COMP":
    case "EAMP":
      return ["inp", "inn", "out"];
    default:
      return COMPONENT_SPECS[kind].pins.map((p) => p.id);
  }
}

/** Index first-token refdes → remaining tokens (nets + params). */
export function indexDeviceLines(text: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("*") || line.startsWith(".")) continue;
    const tokens = line.split(/\s+/);
    if (tokens.length < 2) continue;
    const [refdes, ...rest] = tokens;
    map.set(refdes, rest);
  }
  return map;
}

export interface ParsedDevice {
  refdes: string;
  /** All tokens after refdes. */
  rest: string[];
}

export function parseDeviceLines(text: string): ParsedDevice[] {
  const out: ParsedDevice[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("*") || line.startsWith(".")) continue;
    const tokens = line.split(/\s+/);
    if (tokens.length < 2) continue;
    const [refdes, ...rest] = tokens;
    out.push({ refdes, rest });
  }
  return out;
}

/**
 * Infer component kind from refdes prefix.
 * Shared prefixes: M → NMOS, Q → NPN (existing graph kind wins if caller passes hint).
 */
export function inferKindFromRefdes(
  refdes: string,
  hint?: ComponentKind,
): ComponentKind | null {
  if (hint && COMPONENT_SPECS[hint]?.emits) return hint;

  if (/^M\d+$/i.test(refdes)) return "NMOS";
  if (/^Q\d+$/i.test(refdes)) return "NPN";

  const candidates = Object.values(COMPONENT_SPECS)
    .filter((s) => s.emits && s.refdesPrefix)
    .sort((a, b) => b.refdesPrefix.length - a.refdesPrefix.length);

  for (const s of candidates) {
    const p = s.refdesPrefix;
    if (refdes.startsWith(p) && /^\d+$/.test(refdes.slice(p.length))) {
      return s.kind;
    }
  }
  return null;
}

/** Split rest tokens into nets + param tokens for a known kind. */
export function splitNetsAndParams(
  kind: ComponentKind,
  rest: string[],
): { nets: string[]; paramTokens: string[] } | null {
  const n = netTokenCount(kind);
  if (rest.length < n) return null;
  return { nets: rest.slice(0, n), paramTokens: rest.slice(n) };
}

/** Pull editable params from tokens after the net list. */
export function extractParamsFromRest(
  kind: ComponentKind,
  rest: string[],
): Record<string, string> {
  const keys = new Set(COMPONENT_SPECS[kind].attributes.map((a) => a.key));
  if (!keys.size) return {};

  const out: Record<string, string> = {};
  const icTok = rest.find((t) => /^ic=/i.test(t));
  const withoutIc = rest.filter((t) => !/^ic=/i.test(t));

  if (icTok && keys.has("ic")) {
    out.ic = icTok.replace(/^ic=/i, "");
  }

  if (keys.has("value")) {
    const value = withoutIc.join(" ").trim();
    if (value !== "") out.value = value;
  } else if (keys.has("model") && withoutIc.length > 0) {
    out.model = withoutIc[withoutIc.length - 1]!;
  }

  return out;
}

/**
 * `.model` / `.tran` / `.options` etc. — not `.save` / `.end`.
 * Empty array means "caller should keep previous directives".
 */
export function extractDirectives(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.startsWith(".") &&
        !/^\.save\b/i.test(l) &&
        !/^\.end\b/i.test(l),
    );
}
