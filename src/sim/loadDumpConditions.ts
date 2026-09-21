/**
 * ISO 16750-2-style load-dump "working conditions" ↔ netlist / graph sync.
 *
 * Canonical marker (survives round-trips):
 *   * .wc UA=27.8 Us=151 Ri=2 tr=10m td=350m stop=1 pulse=ISO16750_A
 *
 * Also updates V* PWL stimulus, R* value, and .tran stop when applying.
 */

import { formatXpulseComment } from "./loadDumpPulseInc";

/** Selectable test-pulse id (email point 3). */
export type LoadDumpPulseId = "ISO16750_A" | "ISO7637_5A";

export const LOAD_DUMP_PULSES: readonly {
  id: LoadDumpPulseId;
  label: string;
  /** Short tip for the Pulse dropdown. */
  tip: string;
}[] = [
  {
    id: "ISO16750_A",
    label: "ISO 16750-2 A",
    tip: "Us = absolute peak (Uspk). Shape = ISO16750_TESTA. Editing UA/Us/Ri keeps this profile (not Custom).",
  },
  {
    id: "ISO7637_5A",
    label: "ISO 7637-5a",
    tip: "Us = amplitude above UA (peak = UA+Us). Shape = ISO7637_5A. Editing numbers keeps this profile.",
  },
];

export type LoadDumpConditions = {
  /**
   * Peak / pulse voltage Us (V).
   * ISO16750_A: absolute peak. ISO7637_5A: amplitude above UA.
   */
  usPeak: string;
  /** Supply / battery UA (V). */
  uaSupply: string;
  /** Source resistance Ri (Ω). */
  ri: string;
  /** Rise time (ms). */
  trMs: string;
  /** Decay duration td (ms). */
  tdMs: string;
  /** Simulation stop time (ms). */
  simStopMs: string;
  /** Test pulse profile (stored in *.wc). */
  pulse: LoadDumpPulseId;
};

export const DEFAULT_LOAD_DUMP: LoadDumpConditions = {
  usPeak: "151",
  uaSupply: "27.8",
  ri: "2",
  trMs: "10",
  tdMs: "350",
  simStopMs: "1000",
  pulse: "ISO16750_A",
};

const WC_RE =
  /^\*\s*\.wc\b(.*)$/im;

function parseNumber(raw: string, fallback: number): number {
  const n = Number(String(raw).trim().replace(/,/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

/** Parse SPICE time token → seconds. */
export function spiceTimeToSeconds(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([a-zA-Zµμ]*)$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const suf = (m[2] ?? "").toUpperCase().replace(/µ|μ/g, "U");
  if (!suf || suf === "S") return n;
  if (suf.startsWith("MEG")) return n * 1e6;
  const mult: Record<string, number> = {
    T: 1e12,
    G: 1e9,
    K: 1e3,
    M: 1e-3,
    U: 1e-6,
    N: 1e-9,
    P: 1e-12,
    F: 1e-15,
  };
  const f = mult[suf[0]!];
  return f != null ? n * f : null;
}

export function secondsToMsString(sec: number): string {
  const ms = sec * 1000;
  if (Math.abs(ms - Math.round(ms)) < 1e-9) return String(Math.round(ms));
  return String(Number(ms.toPrecision(8)));
}

export function msToSpiceTime(msRaw: string): string {
  const ms = parseNumber(msRaw, 1000);
  if (ms <= 0) return "1";
  if (ms >= 1000 && ms % 1000 === 0) return String(ms / 1000);
  if (ms >= 1) return `${Number((ms / 1000).toPrecision(8))}`;
  return `${Number(ms.toPrecision(8))}m`;
}

function formatPoint(t: number, v: number): string {
  const ts =
    t >= 1
      ? String(Number(t.toPrecision(6)))
      : t >= 1e-3
        ? `${Number((t * 1e3).toPrecision(6))}m`
        : `${Number((t * 1e6).toPrecision(6))}u`;
  return `${ts} ${Number(v.toPrecision(6))}`;
}

export function normalizePulseId(raw: string | undefined | null): LoadDumpPulseId {
  const t = String(raw ?? "").trim().toUpperCase().replace(/-/g, "_");
  if (t.includes("7637")) return "ISO7637_5A";
  return "ISO16750_A";
}

/**
 * ISO load-dump PWL matching the email B-source formulas.
 * ISO16750_A: Us = absolute peak (Uspk). ISO7637_5A: Us = amplitude above UA.
 * Applied to V1; R1 still carries Ri (same electrical idea as XPULSE+internal R).
 */
export function buildLoadDumpPwl(c: LoadDumpConditions): string {
  const ua = parseNumber(c.uaSupply, 27.8);
  const us = parseNumber(c.usPeak, 151);
  const tr = parseNumber(c.trMs, 10) * 1e-3;
  const td = parseNumber(c.tdMs, 350) * 1e-3;
  const stop = parseNumber(c.simStopMs, 1000) * 1e-3;
  const ln10 = 2.302585093;
  const tpk = Math.max(1e-9, 1.25 * tr);
  const tau = Math.max(1e-9, (td - 1.125 * tr) / ln10);
  const pulse = normalizePulseId(c.pulse);
  // 16750: absolute peak → amplitude = Us-UA. 7637: Us is already amplitude.
  const usa = pulse === "ISO7637_5A" ? us : us - ua;

  const times = new Set<number>([0, tpk]);
  for (const f of [0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 1.0]) {
    times.add(Math.min(stop, tpk + f * Math.max(td - tpk, tr)));
  }
  times.add(Math.min(stop, td));
  if (stop > td) times.add(stop);

  const sorted = [...times].filter((t) => t >= 0 && t <= stop + 1e-15).sort((a, b) => a - b);
  const pts: string[] = [];
  for (const t of sorted) {
    const ramp = Math.min(t / tpk, 1);
    const decay = Math.exp(-Math.max(t - tpk, 0) / tau);
    const v = ua + usa * ramp * decay;
    pts.push(formatPoint(t, v));
  }
  return `PWL(${pts.join(" ")})`;
}

export function formatWcDirective(c: LoadDumpConditions): string {
  const pulse = normalizePulseId(c.pulse);
  const base = `* .wc UA=${c.uaSupply.trim() || "27.8"} Us=${c.usPeak.trim() || "151"} Ri=${c.ri.trim() || "2"} tr=${c.trMs.trim() || "10"}m td=${c.tdMs.trim() || "350"}m stop=${msToSpiceTime(c.simStopMs)} pulse=${pulse}`;
  return base;
}

function parseWcLine(line: string): Partial<LoadDumpConditions> | null {
  const m = WC_RE.exec(line.trim());
  if (!m) return null;
  const body = m[1] ?? "";
  const get = (key: string) => {
    const re = new RegExp(`(?:^|\\s)${key}\\s*=\\s*([^\\s]+)`, "i");
    return re.exec(body)?.[1];
  };
  const out: Partial<LoadDumpConditions> = {};
  const ua = get("UA");
  const us = get("Us") ?? get("US");
  const ri = get("Ri") ?? get("RI");
  const tr = get("tr") ?? get("Tr");
  const td = get("td") ?? get("Td");
  const stop = get("stop") ?? get("Stop");
  const pulse = get("pulse") ?? get("Pulse");
  if (ua) out.uaSupply = ua.replace(/v$/i, "");
  if (us) out.usPeak = us.replace(/v$/i, "");
  if (ri) out.ri = ri.replace(/ohm$/i, "");
  if (tr) {
    const sec = spiceTimeToSeconds(tr) ?? spiceTimeToSeconds(tr.replace(/m$/i, "") + "m");
    if (sec != null) out.trMs = secondsToMsString(sec);
    else if (/m$/i.test(tr)) out.trMs = tr.replace(/m$/i, "");
    else out.trMs = tr;
  }
  if (td) {
    const sec = spiceTimeToSeconds(td);
    if (sec != null) out.tdMs = secondsToMsString(sec);
    else if (/m$/i.test(td)) out.tdMs = td.replace(/m$/i, "");
    else out.tdMs = td;
  }
  if (stop) {
    const sec = spiceTimeToSeconds(stop);
    if (sec != null) out.simStopMs = secondsToMsString(sec);
  }
  if (pulse) out.pulse = normalizePulseId(pulse);
  return out;
}

/** Pull working conditions from netlist text (marker first, then heuristics). */
export function parseLoadDumpFromNetlist(netlist: string): LoadDumpConditions {
  const base = { ...DEFAULT_LOAD_DUMP };
  let fromMarker: Partial<LoadDumpConditions> | null = null;
  for (const line of netlist.split(/\r?\n/)) {
    const p = parseWcLine(line);
    if (p) fromMarker = { ...(fromMarker ?? {}), ...p };
  }
  if (fromMarker) Object.assign(base, fromMarker);

  // .tran stop → simStopMs (marker stop wins if already set from .wc)
  if (!fromMarker?.simStopMs) {
    const tran = /^\s*\.tran\s+(\S+)\s+(\S+)/im.exec(netlist);
    if (tran) {
      const sec = spiceTimeToSeconds(tran[2]!);
      if (sec != null) base.simStopMs = secondsToMsString(sec);
    }
  }

  // R value heuristic if Ri not from marker
  if (!fromMarker?.ri) {
    const r = /^\s*R\S*\s+\S+\s+\S+\s+(\S+)/im.exec(netlist);
    if (r && !/^(PULSE|SIN|PWL|DC)/i.test(r[1]!)) {
      base.ri = r[1]!.replace(/ohm$/i, "");
    }
  }

  // PWL endpoints if UA/Us missing from marker
  if (!fromMarker?.uaSupply || !fromMarker?.usPeak) {
    const pwl = /PWL\s*\(([^)]*)\)/i.exec(netlist);
    if (pwl) {
      const toks = pwl[1]!.trim().split(/\s+/).filter(Boolean);
      const vals: number[] = [];
      for (let i = 1; i < toks.length; i += 2) {
        const v = Number(toks[i]);
        if (Number.isFinite(v)) vals.push(v);
      }
      if (vals.length && !fromMarker?.uaSupply) base.uaSupply = String(vals[0]);
      if (vals.length && !fromMarker?.usPeak) {
        base.usPeak = String(Math.max(...vals));
      }
    }
  }

  base.pulse = normalizePulseId(base.pulse);
  return base;
}

export function setWcInDirectives(
  dirs: string[] | undefined,
  c: LoadDumpConditions,
): string[] {
  const withoutWc = [...(dirs ?? [])].filter(
    (d) => !/^\*\s*\.wc\b/i.test(d.trim()) && !/^\*\s*XPULSE\b/i.test(d.trim()),
  );
  const withoutTran = withoutWc.filter((d) => !/^\.tran\b/i.test(d.trim()));
  const step =
    parseNumber(c.simStopMs, 1000) >= 100
      ? "250u"
      : "1u";
  const stop = msToSpiceTime(c.simStopMs);
  return [
    ...withoutTran,
    formatWcDirective(c),
    formatXpulseComment(c),
    `.tran ${step} ${stop}`,
  ];
}

export function conditionsEqual(a: LoadDumpConditions, b: LoadDumpConditions): boolean {
  return (
    a.usPeak === b.usPeak &&
    a.uaSupply === b.uaSupply &&
    a.ri === b.ri &&
    a.trMs === b.trMs &&
    a.tdMs === b.tdMs &&
    a.simStopMs === b.simStopMs &&
    normalizePulseId(a.pulse) === normalizePulseId(b.pulse)
  );
}

/** One-line summary for saved-condition banners / lastSim metadata. */
export function formatLoadDumpConditionsSummary(c: LoadDumpConditions): string {
  const pulse = normalizePulseId(c.pulse);
  const pulseLab = LOAD_DUMP_PULSES.find((p) => p.id === pulse)?.label ?? pulse;
  return (
    `${pulseLab} · Us=${c.usPeak.trim() || "—"}V · Ua=${c.uaSupply.trim() || "—"}V` +
    ` · Ri=${c.ri.trim() || "—"}Ω · tr=${c.trMs.trim() || "—"}ms` +
    ` · td=${c.tdMs.trim() || "—"}ms · stop=${c.simStopMs.trim() || "—"}ms`
  );
}
