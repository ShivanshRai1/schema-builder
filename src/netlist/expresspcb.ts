/**
 * LTspice ExpressPCB .net → schematic devices (simplified).
 *
 * Net Names Table second field = 1-based index of the first connection row
 * for that net (not the net number itself).
 *
 * Behavioral V=if(...) gate drives → complementary VPULSE.
 * R6020PNJ / nmos models → SICMOS + SIC_MOS.
 * {param} tokens → built-in defaults (from the H-bridge ASC .param block).
 */

import type { ComponentKind } from "../model/types";

export type ExpressPcbPart = {
  /** 1-based part index in the file. */
  index: number;
  refdes: string;
  value: string;
};

export type ExpressPcbConnection = {
  net: number;
  part: number;
  pin: number;
};

export type ExpressPcbParse = {
  parts: ExpressPcbPart[];
  /** net number → name */
  netNames: Map<number, string>;
  connections: ExpressPcbConnection[];
};

export type MappedExpressDevice = {
  refdes: string;
  kind: ComponentKind;
  /** Pin id → net name */
  pins: Record<string, string>;
  params: Record<string, string>;
  warning?: string;
};

/** Defaults when ExpressPCB only has `{Vin}`-style placeholders. */
export const EXPRESSPCB_PARAM_DEFAULTS: Record<string, string> = {
  Vin: "48",
  Rg_Ext: "5",
  R: "10",
  Lout: "1m",
  Vgdrive: "10",
  Voff: "0",
  Ar: "0.9",
  Ac: "1",
  fs: "50",
  fsw: "20",
  Tsw: "50u",
  Tdead: "500n",
};

function parseQuoted(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1]!);
  return out;
}

export function parseExpressPcb(text: string): ExpressPcbParse | null {
  if (!/ExpressPCB\s+Netlist/i.test(text) && !/"Part IDs Table"/i.test(text)) {
    return null;
  }

  const lines = text.split(/\r?\n/);
  let section = "";
  const parts: ExpressPcbPart[] = [];
  const nameStarts: { name: string; start: number }[] = [];
  const connections: ExpressPcbConnection[] = [];

  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    if (/Part IDs Table/i.test(t)) {
      section = "parts";
      continue;
    }
    if (/Net Names Table/i.test(t)) {
      section = "nets";
      continue;
    }
    if (/Net Connections Table/i.test(t)) {
      section = "conn";
      continue;
    }

    if (section === "parts" && t.startsWith('"')) {
      const q = parseQuoted(t);
      if (q.length >= 2) {
        parts.push({
          index: parts.length + 1,
          refdes: q[0]!,
          value: q[1]!,
        });
      }
    } else if (section === "nets" && t.startsWith('"')) {
      const q = parseQuoted(t);
      const start = Number(t.replace(/^"[^"]*"\s*/, "").trim());
      if (q[0] != null && Number.isFinite(start)) {
        nameStarts.push({ name: q[0], start });
      }
    } else if (section === "conn") {
      const nums = t
        .split(/\s+/)
        .map(Number)
        .filter((n) => !Number.isNaN(n));
      if (nums.length >= 3) {
        connections.push({
          net: nums[0]!,
          part: nums[1]!,
          pin: nums[2]!,
        });
      }
    }
  }

  if (!parts.length || !connections.length) return null;

  const netNames = new Map<number, string>();
  for (const { name, start } of nameStarts) {
    const c = connections[start - 1];
    if (c) netNames.set(c.net, name);
  }

  return { parts, netNames, connections };
}

function expandToken(raw: string): string {
  const t = raw.trim();
  const m = /^\{([^{}]+)\}$/.exec(t);
  if (m) {
    const key = m[1]!.trim();
    return EXPRESSPCB_PARAM_DEFAULTS[key] ?? key;
  }
  return t;
}

function spicePinIds(kind: ComponentKind): string[] {
  switch (kind) {
    case "SICMOS":
    case "NMOS":
    case "PMOS":
    case "GANHEMT":
      return ["d", "g", "s"];
    case "R":
    case "L":
      return ["a", "b"];
    case "BATTERY":
    case "VAC":
    case "VPULSE":
    case "V":
      return ["p", "n"];
    default:
      return ["a", "b"];
  }
}

/** LTspice ExpressPCB pin numbers are 1-based in symbol SpiceOrder. */
function pinsFromConnections(
  kind: ComponentKind,
  partIndex: number,
  connections: ExpressPcbConnection[],
  netNames: Map<number, string>,
): Record<string, string> {
  const order = spicePinIds(kind);
  const pins: Record<string, string> = {};
  for (const c of connections) {
    if (c.part !== partIndex) continue;
    const pinId = order[c.pin - 1];
    if (!pinId) continue;
    pins[pinId] = netNames.get(c.net) || `N${c.net}`;
  }
  return pins;
}

function complementaryPulse(refdes: string): Record<string, string> {
  const upper = /V3|V4/i.test(refdes);
  return {
    vinitial: "0",
    von: EXPRESSPCB_PARAM_DEFAULTS.Vgdrive!,
    tdelay: upper ? "25u" : "0",
    trise: "10n",
    tfall: "10n",
    ton: "20u",
    tperiod: EXPRESSPCB_PARAM_DEFAULTS.Tsw!,
  };
}

function mapPartValue(
  refdes: string,
  value: string,
): { kind: ComponentKind; params: Record<string, string>; warning?: string } | null {
  const v = value.trim();

  if (/R6020|SIC_MOS|NMOS|PMOS|MOSFET/i.test(v) && !/^\{/.test(v)) {
    return {
      kind: "SICMOS",
      params: { model: "SIC_MOS" },
      warning: `${refdes}: ${v} → SIC_MOS (toy model)`,
    };
  }

  if (/^V\s*=\s*if\s*\(/i.test(v) || /^V=if\(/i.test(v)) {
    return {
      kind: "VPULSE",
      params: complementaryPulse(refdes),
      warning: `${refdes}: behavioral V=if(...) → complementary VPULSE`,
    };
  }

  if (/^SINE\s*\(/i.test(v)) {
    return {
      kind: "VAC",
      params: {
        voffset: "0",
        vamp: EXPRESSPCB_PARAM_DEFAULTS.Ar!,
        freq: EXPRESSPCB_PARAM_DEFAULTS.fs!,
        tdelay: "0",
        theta: "0",
        phi: "0",
      },
      warning: `${refdes}: SINE params expanded from defaults`,
    };
  }

  if (/^PULSE\s*\(/i.test(v)) {
    // Carrier triangle approximations — keep as pulse around ±Ac.
    return {
      kind: "VPULSE",
      params: {
        vinitial: `-${EXPRESSPCB_PARAM_DEFAULTS.Ac}`,
        von: EXPRESSPCB_PARAM_DEFAULTS.Ac!,
        tdelay: "0",
        trise: "25u",
        tfall: "25u",
        ton: "0",
        tperiod: EXPRESSPCB_PARAM_DEFAULTS.Tsw!,
      },
      warning: `${refdes}: PULSE with {params} → expanded VPULSE`,
    };
  }

  // Passive / DC placeholders: {Vin}, {R}, {Lout}, {Rg_Ext}, or plain number.
  const expanded = expandToken(v);
  if (/^Vin$/i.test(refdes) || (/^\d/.test(expanded) && /V/i.test(refdes))) {
    return { kind: "BATTERY", params: { dc: expanded, rser: "" } };
  }
  if (/^L/i.test(refdes) || /Lout/i.test(refdes)) {
    return { kind: "L", params: { value: expanded, ic: "" } };
  }
  if (/^R/i.test(refdes) || /Rg_/i.test(refdes) || expanded === EXPRESSPCB_PARAM_DEFAULTS.R) {
    return { kind: "R", params: { value: expanded } };
  }
  // Generic braced or numeric on a V* refdes
  if (/^V/i.test(refdes)) {
    return { kind: "BATTERY", params: { dc: expanded, rser: "" } };
  }
  if (/^L/i.test(refdes)) {
    return { kind: "L", params: { value: expanded, ic: "" } };
  }
  if (/^R/i.test(refdes)) {
    return { kind: "R", params: { value: expanded } };
  }

  return null;
}

export type ExpressPcbMapResult = {
  devices: MappedExpressDevice[];
  warnings: string[];
  directives: string[];
};

/**
 * Map a parsed ExpressPCB file to app devices + pin nets.
 * Returns null only if parse failed earlier; empty devices → caller rejects.
 */
export function mapExpressPcbToDevices(parsed: ExpressPcbParse): ExpressPcbMapResult {
  const warnings: string[] = [];
  const devices: MappedExpressDevice[] = [];

  for (const part of parsed.parts) {
    const mapped = mapPartValue(part.refdes, part.value);
    if (!mapped) {
      warnings.push(`${part.refdes}: skipped unsupported value ${JSON.stringify(part.value)}`);
      continue;
    }
    if (mapped.warning) warnings.push(mapped.warning);

    const pins = pinsFromConnections(
      mapped.kind,
      part.index,
      parsed.connections,
      parsed.netNames,
    );
    const need = spicePinIds(mapped.kind);
    if (need.some((p) => !pins[p])) {
      warnings.push(`${part.refdes}: incomplete pin nets — skipped`);
      continue;
    }

    devices.push({
      refdes: part.refdes,
      kind: mapped.kind,
      pins,
      params: mapped.params,
      warning: mapped.warning,
    });
  }

  return {
    devices,
    warnings,
    directives: [".tran 1u 500u", ".options reltol=1e-3"],
  };
}

export function convertExpressPcbText(text: string): ExpressPcbMapResult | { error: string } {
  const parsed = parseExpressPcb(text);
  if (!parsed) {
    return { error: "Could not parse ExpressPCB netlist tables." };
  }
  const mapped = mapExpressPcbToDevices(parsed);
  if (!mapped.devices.length) {
    return { error: "ExpressPCB file had no mappable devices." };
  }
  return mapped;
}
