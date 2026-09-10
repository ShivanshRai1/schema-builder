import type { ComponentKind } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";

/**
 * Step-2 netlist parsing helpers.
 * Used for param patch (B), add/delete (C), and rewire (D).
 */

/** How many leading net tokens toSpice emits before value/model. */
export function netTokenCount(kind: ComponentKind): number {
  // NMOS/PMOS (+ depletion) emit bulk tied to source: D G S S
  if (
    kind === "NMOS" ||
    kind === "PMOS" ||
    kind === "NMOS_D" ||
    kind === "PMOS_D"
  ) {
    return 4;
  }
  return COMPONENT_SPECS[kind].pins.length;
}

/**
 * Pin ids in the same order as toSpice net arguments.
 * Duplicate "s" for MOSFET matches the 4-token emission (D G S S).
 */
export function spicePinOrder(kind: ComponentKind): string[] {
  switch (kind) {
    case "D":
    case "DZ":
    case "DS":
    case "LED":
    case "DTVS":
    case "DTVSBI":
      return ["a", "k"];
    case "V":
    case "I":
    case "BATTERY":
    case "VAC":
    case "IAC":
    case "VPULSE":
      return ["p", "n"];
    case "R":
    case "RBOX":
    case "RVAR":
    case "RVARBOX":
    case "L":
    case "LVAR":
    case "C":
    case "CPOL":
    case "CFIXED":
    case "CVAR":
    case "CSENSE":
    case "IPROBE":
    case "THERM":
    case "LDR":
    case "FBEAD":
    case "XTAL":
    case "SPST":
    case "PB":
      return ["a", "b"];
    case "NMOS":
    case "PMOS":
    case "NMOS_D":
    case "PMOS_D":
      return ["d", "g", "s", "s"];
    case "NJFET":
    case "PJFET":
      return ["d", "g", "s"];
    case "UJT":
      return ["b2", "e", "b1"];
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
    case "OPAMP":
      return ["inp", "inn", "out"];
    case "OPAMP5":
      return ["inp", "inn", "out", "vplus", "vminus"];
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
  let inSubckt = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("*")) continue;
    // Library blocks belong in Models — never invent schematic parts from them.
    if (/^\.subckt\b/i.test(line)) {
      inSubckt = true;
      continue;
    }
    if (/^\.ends\b/i.test(line)) {
      inSubckt = false;
      continue;
    }
    if (inSubckt) continue;
    if (line.startsWith(".") || line.startsWith("+")) continue;
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
  if (/^J\d+$/i.test(refdes)) return "NJFET";

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

/**
 * Infer kind using refdes + device-line tokens (nets + model / stimulus).
 * Fixes X1/X2 → XTAL when the line is really a 2-pin TVS/subckt
 * (e.g. `X1 vs mid XFD11K33CA`).
 * Voltage sources: prefer PULSE/SINE/PWL/DC in the line over a stale canvas hint.
 */
export function inferKindFromDevice(
  refdes: string,
  rest: string[],
  hint?: ComponentKind,
): ComponentKind | null {
  const joined = rest.join(" ");

  // V* stimulus keywords beat an existing VPULSE/BATTERY hint from the starter.
  if (/^V\d+$/i.test(refdes)) {
    if (/\bPULSE\s*\(/i.test(joined)) return "VPULSE";
    if (/\bSINE\s*\(/i.test(joined)) return "VAC";
    // PWL / EXP (e.g. ISO load dump) → AC-source glyph; stimulus kept as raw SPICE
    if (/\bPWL\s*\(/i.test(joined) || /\bEXP\s*\(/i.test(joined)) return "VAC";
    if (/\bDC\b/i.test(joined)) return "BATTERY";
    // Bare `V1 n1 n2 12` numeric DC
    if (rest.length >= 3 && /^[+\-]?\d/.test(rest[2]!) && !/[A-Za-z(]/.test(rest[2]!)) {
      return "BATTERY";
    }
  }

  if (hint && COMPONENT_SPECS[hint]?.emits) return hint;

  // Bare Xn + two nets + model → vendor subckt / TVS, not crystal (unless model is XTAL).
  if (/^X\d+$/i.test(refdes) && rest.length >= 3) {
    const model = rest[rest.length - 1] ?? "";
    const netCount = rest.length - 1;
    if (netCount === 2) {
      if (/^XTAL$/i.test(model) || /^CRYSTAL/i.test(model)) return "XTAL";
      // Unidirectional automotive / SMA TVS families
      if (/SM8S|SM5S|1\.5KE|P6KE|SMAJ|SMBJ|SMCJ|uni.?dir/i.test(model)) {
        return "DTVS";
      }
      // Bidirectional / XClampR / *CA TVS
      if (/XFD|XCLAMP|BIDIR|TVS|CA$/i.test(model)) {
        return "DTVSBI";
      }
      // Unknown 2-pin X-subckt: bidirectional TVS glyph (closest 2-terminal clamp)
      return "DTVSBI";
    }
  }

  return inferKindFromRefdes(refdes, hint);
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

/** Extract `NAME(...)` with balanced parentheses from a token string. */
function extractSpiceCall(text: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*\\(`, "i");
  const m = re.exec(text);
  if (!m || m.index == null) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < text.length && depth > 0) {
    const ch = text[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    i++;
  }
  if (depth !== 0) return null;
  return text.slice(m.index, i).trim();
}

/** Pull editable params from tokens after the net list. */
export function extractParamsFromRest(
  kind: ComponentKind,
  rest: string[],
): Record<string, string> {
  const keys = new Set(COMPONENT_SPECS[kind].attributes.map((a) => a.key));
  if (!keys.size) return {};

  const out: Record<string, string> = {};
  const joined = rest.join(" ").trim();
  const icTok = rest.find((t) => /^ic=/i.test(t));
  const withoutIc = rest.filter((t) => !/^ic=/i.test(t));

  if (icTok && keys.has("ic")) {
    out.ic = icTok.replace(/^ic=/i, "");
  }

  // PWL / EXP on VAC — keep full call so toSpice round-trips the load-dump wave
  if (kind === "VAC" && keys.has("stimulus")) {
    const raw =
      extractSpiceCall(joined, "PWL") ??
      extractSpiceCall(joined, "EXP") ??
      extractSpiceCall(joined, "SFFM");
    if (raw) {
      out.stimulus = raw;
      return out;
    }
  }

  // Structured stimuli
  const pulse = extractSpiceCall(joined, "PULSE");
  if (pulse && kind === "VPULSE") {
    const inner = pulse.replace(/^PULSE\s*\(/i, "").replace(/\)\s*$/, "");
    const p = inner.trim().split(/\s+/);
    const names = ["vinitial", "von", "tdelay", "trise", "tfall", "ton", "tperiod"] as const;
    for (let i = 0; i < names.length && i < p.length; i++) {
      if (keys.has(names[i]!)) out[names[i]!] = p[i]!;
    }
    return out;
  }

  const sine = extractSpiceCall(joined, "SINE");
  if (sine && (kind === "VAC" || kind === "IAC")) {
    const inner = sine.replace(/^SINE\s*\(/i, "").replace(/\)\s*$/, "");
    const p = inner.trim().split(/\s+/);
    const names =
      kind === "VAC"
        ? (["voffset", "vamp", "freq", "tdelay", "theta", "phi"] as const)
        : (["ioffset", "iamp", "freq", "tdelay", "theta", "phi"] as const);
    for (let i = 0; i < names.length && i < p.length; i++) {
      if (keys.has(names[i]!)) out[names[i]!] = p[i]!;
    }
    return out;
  }

  if (kind === "BATTERY") {
    const dc = /\bDC\s+([^\s]+)/i.exec(joined);
    if (dc && keys.has("dc")) out.dc = dc[1]!;
    else if (withoutIc[0] && /^[+\-]?\d/.test(withoutIc[0]) && keys.has("dc")) {
      out.dc = withoutIc[0];
    }
    const rser = /\bRser\s*=\s*([^\s]+)/i.exec(joined);
    if (rser && keys.has("rser")) out.rser = rser[1]!;
    return out;
  }

  // PWL / free-form on legacy V
  if (keys.has("value")) {
    const value = withoutIc.join(" ").trim();
    if (value !== "") out.value = value;
  } else if (keys.has("model") && withoutIc.length > 0) {
    out.model = withoutIc[withoutIc.length - 1]!;
  }

  return out;
}

/**
 * `.model` / `.tran` / `.options` etc. — not `.save` / `.end` / inside `.subckt`.
 * Empty array means "caller should keep previous directives".
 * Duplicate analyses (two `.tran`) are collapsed — last one wins (QSPICE fatal otherwise).
 */
export function extractDirectives(text: string): string[] {
  const raw: string[] = [];
  let inSubckt = false;
  for (const line of text.split(/\r?\n/).map((l) => l.trim())) {
    if (!line || line.startsWith("*")) continue;
    if (/^\.subckt\b/i.test(line)) {
      inSubckt = true;
      continue;
    }
    if (/^\.ends\b/i.test(line)) {
      inSubckt = false;
      continue;
    }
    if (inSubckt) continue;
    if (!line.startsWith(".")) continue;
    if (/^\.save\b/i.test(line) || /^\.end\b/i.test(line)) continue;
    // .include/.lib need files on the sim host; Models panel inlines .sub text instead.
    if (/^\.(include|inc|lib)\b/i.test(line)) continue;
    // .model / .param / .meas / .options / analyses stay; analyses deduped below
    raw.push(line);
  }
  return dedupeAnalysisDirectives(raw);
}

/** Keep one of .tran / .ac / .dc / .op (last wins); leave other directives alone. */
export function dedupeAnalysisDirectives(dirs: string[]): string[] {
  const analysis = /^\.(tran|ac|dc|op|tf|noise|four)\b/i;
  const lastByKind = new Map<string, string>();
  const other: string[] = [];
  for (const d of dirs) {
    const m = analysis.exec(d);
    if (m) lastByKind.set(m[1]!.toLowerCase(), d);
    else other.push(d);
  }
  return [...other, ...lastByKind.values()];
}
