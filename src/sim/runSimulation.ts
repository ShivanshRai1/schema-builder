/**
 * Fleet hookup via sim_api.php (same contract as sic_demo.html).
 *
 *   POST form: action=submit, engine=D1SPICE|D2SPICE, netlist=<canvas netlist>
 *   → { job_id }
 *   POST form: action=poll, job_id=...
 *   → { status: "done", result: { columns, rows } }  (or error)
 *
 * The netlist is whatever the schematic generated — not a fixed demo circuit.
 * If the API is missing, errors, or returns no traces → demo plot.
 * Never throws to the UI.
 */

export type SimEngine = "D1SPICE" | "D2SPICE";

export interface SimSeries {
  name: string;
  x: number[];
  y: number[];
}

export interface SimResult {
  ok: boolean;
  source: "fleet" | "demo";
  message: string;
  series: SimSeries[];
  engine?: SimEngine;
}

/** Override with VITE_SIM_API_URL when the API is not at ./sim_api.php. */
export function simApiUrl(): string {
  const fromEnv = (import.meta.env.VITE_SIM_API_URL as string | undefined)?.trim();
  return fromEnv || "./sim_api.php";
}

const FETCH_TIMEOUT_MS = 180_000;
const POLL_MS = 800;
const MAX_POLLS = 150;

/** Demo RC charge curve — used whenever the fleet call cannot succeed. */
export function demoWaveform(reason?: string): SimResult {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i <= 100; i++) {
    const t = i * 1e-5;
    x.push(t);
    y.push(12 * (1 - Math.exp(-t / 2e-4)));
  }
  return {
    ok: true,
    source: "demo",
    message: reason
      ? `${reason} — showing a demo waveform`
      : "Simulation offline — showing a demo waveform",
    series: [{ name: "V(out)", x, y }],
  };
}

export interface RunSimulationOptions {
  engine?: SimEngine;
  /** AbortSignal from the panel (e.g. unmount / new Run). */
  signal?: AbortSignal;
  /** Default true: add .print if missing (schematic netlists). */
  ensurePrint?: boolean;
}

export type FleetJobResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; aborted?: boolean };

async function postForm(
  url: string,
  fields: Record<string, string>,
  signal: AbortSignal,
): Promise<{ status: number; data: unknown }> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: fd,
    signal,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = parseJsonPayload(text);
  } catch {
    const snippet = text.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(
      snippet
        ? `Simulation returned non-JSON: ${snippet}`
        : res.ok
          ? "Simulation returned empty non-JSON"
          : `HTTP ${res.status}`,
    );
  }
  return { status: res.status, data };
}

function parseJsonPayload(text: string): unknown {
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("not json");
  }
}

function payloadError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.error) return String(d.error);
  if (d.ok === false) return String(d.message ?? "simulation failed");
  return null;
}

function jobIdFrom(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.job_id === "string" && d.job_id) return d.job_id;
  if (typeof d.jobId === "string" && d.jobId) return d.jobId;
  return null;
}

/**
 * Fleet ngspice batch mode refuses a netlist with only .tran / .save.
 * `.print tran all` is the only form the fleet reliably returns as waveform data.
 * (Explicit I(XM1) lists come back with empty analyses from ngspice/QSPICE workers.)
 */
function withBatchPrint(netlist: string): string {
  if (/\.(print|plot|fourier)\b/i.test(netlist)) return netlist;
  const line = ".print tran all";
  if (/\.end\s*$/im.test(netlist)) {
    return netlist.replace(/\.end\s*$/im, `${line}\n.end`);
  }
  return `${netlist.replace(/\s*$/, "")}\n${line}\n.end`;
}

/** Remove garbled hierarchy markers the fleet sometimes returns in column names. */
export function cleanSignalName(raw: string): string {
  let s = raw
    .replace(/\uFFFD/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // ngspice branch alias: xm1#branch → I(XM1)
  const branch = /^([A-Za-z][A-Za-z0-9]*)#branch$/i.exec(s);
  if (branch) return `I(${branch[1]!.toUpperCase()})`;

  // Normalize v(1) → V(1), i(v1) → I(V1)
  const fn = /^([A-Za-z])\((.+)\)$/.exec(s);
  if (fn) {
    const fnName = fn[1]!.toUpperCase();
    const arg = fn[2]!;
    if (/^\d+$/.test(arg)) return `${fnName}(${arg})`;
    return `${fnName}(${arg.toUpperCase()})`;
  }

  return s;
}

/**
 * Keep schematic-level traces; drop MOSFET leg currents and subcircuit internals
 * (TVS .sub models dump dozens of nodes like CBVC@X1 that clutter the legend).
 */
export function shouldShowInChart(
  name: string,
  topRefs?: Set<string>,
  topNets?: Set<string>,
): boolean {
  const n = cleanSignalName(name);
  if (!n) return false;
  // Internal MOSFET leg currents (Id/Is/Ig/Ib of devices inside subcircuits).
  if (/^I[dgsb]\(/i.test(n)) return false;
  if (/@/i.test(n)) return false;

  if (!topRefs?.size || !topNets?.size) return true;

  const fn = /^([VI])\((.+)\)$/i.exec(n);
  if (fn) {
    const kind = fn[1]!.toUpperCase();
    const arg = fn[2]!;
    if (kind === "I") {
      const base = arg.replace(/#branch$/i, "").split(/[.:]/)[0]!.toUpperCase();
      return topRefs.has(base);
    }
    // V(net): only nets that appear on top-level device pins.
    if (arg === "0") return false;
    return topNets.has(arg) || topNets.has(arg.toUpperCase());
  }

  // Bare names after fleet quirks — keep only if they are a top-level refdes.
  if (topRefs.has(n.toUpperCase())) return true;
  // "90X1" / "CBVCX1" style mashups from bad legend mapping of internals.
  if (/X\d+$/i.test(n) && !/^X\d+$/i.test(n)) return false;
  return false;
}

/** Top-level refdes + pin nets from the schematic netlist (not .sub internals). */
export function topLevelSignalScope(netlist: string): {
  refs: Set<string>;
  nets: Set<string>;
} {
  const devices = parseNetlistDevices(netlist);
  const refs = new Set<string>();
  const nets = new Set<string>();
  for (const d of devices) {
    refs.add(d.refdes.toUpperCase());
    for (const p of d.pins) {
      if (!p || p === "0") continue;
      nets.add(p);
      nets.add(p.toUpperCase());
    }
  }
  return { refs, nets };
}

/** Is(M1#XM1) from QSPICE → I(XM1) (schematic refdes, not internal M1). */
function subcktInstanceCurrentAlias(raw: string): string | null {
  const bare = raw.replace(/[^\x20-\x7E]/g, "").replace(/\s/g, "");
  if (!/^Is\(/i.test(bare)) return null;
  const u = bare.toUpperCase();
  const m = /^IS\(M1(X[A-Z0-9]+)\)$/.exec(u) ?? /^IS\(M1[^A-Z0-9]*(X[A-Z0-9]+)\)$/.exec(u);
  return m ? `I(${m[1]})` : null;
}

/** Device line from a schematic netlist: refdes + pin net names (order preserved). */
export type NetlistDevice = { refdes: string; pins: string[] };

/** Typical pin arity from the leading refdes letter (SPICE convention). */
function typicalPinCount(refdes: string): number {
  const c = refdes.charAt(0).toUpperCase();
  if (c === "M") return 4;
  if (c === "Q" || c === "J" || c === "Z") return 3;
  if (c === "X") return 99; // subckt — keep reading until a value-like token
  if (c === "T") return 4;
  return 2; // R C L V I D E F G H …
}

function isSpiceKeyword(t: string): boolean {
  return /^(DC|AC|PULSE|SIN|EXP|PWL|SFFM|AM|TRNOISE|TRRANDOM|DAY|POLY|TABLE)$/i.test(t);
}

function isValueLikeToken(t: string): boolean {
  if (isSpiceKeyword(t)) return true;
  if (t.includes("=")) return true;
  // 10k, 1n, 2.2u, 1Meg — engineering suffix
  if (/^[+\-]?\d*\.?\d+[a-zA-ZµμΩ]+/.test(t)) return true;
  // 1e-6 / 1E3
  if (/^[+\-]?\d+\.?\d*[eE][+\-]?\d+/.test(t)) return true;
  return false;
}

/**
 * Parse top-level element lines (R1 / C1 / V1 / XM1 …) from a SPICE netlist.
 * Skips comments, dot-commands, and blank lines.
 */
export function parseNetlistDevices(netlist: string): NetlistDevice[] {
  const out: NetlistDevice[] = [];
  for (const raw of netlist.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("*") || line.startsWith(".")) continue;
    const toks = line.split(/\s+/);
    const refdes = toks[0];
    if (!refdes || !/^[A-Za-z][A-Za-z0-9_]*$/.test(refdes)) continue;
    const need = typicalPinCount(refdes);
    const pins: string[] = [];
    for (let i = 1; i < toks.length; i++) {
      const t = toks[i]!;
      if (isValueLikeToken(t)) break;
      // Plain number after enough pins → device value (e.g. R1 1 2 100)
      if (pins.length >= need && /^[+\-]?\d+\.?\d*$/.test(t)) break;
      // Model / subckt name after enough pins (e.g. M1 d g s b NMOS)
      if (pins.length >= need && /^[A-Za-z_]/.test(t)) break;
      pins.push(t);
    }
    if (pins.length >= 1) out.push({ refdes, pins });
  }
  return out;
}

/**
 * Map anonymous SPICE net numbers → schematic symbol names (R1, C1, V1…).
 * Named nets (non-numeric) keep their own name.
 */
export function netSymbolAliases(devices: NetlistDevice[]): Map<string, string> {
  const byNet = new Map<string, NetlistDevice[]>();
  for (const d of devices) {
    for (const p of d.pins) {
      if (!p || p === "0") continue;
      const list = byNet.get(p) ?? [];
      list.push(d);
      byNet.set(p, list);
    }
  }

  const score = (d: NetlistDevice, net: string): number => {
    const r = d.refdes.toUpperCase();
    const letter = r.charAt(0);
    const pins = d.pins;
    const onGnd = pins.some((p) => p === "0");
    // Voltage source positive pin (first net) is the usual “V1” node people mean.
    if ((letter === "V" || letter === "E") && pins[0] === net) return 100;
    if ((letter === "I" || letter === "G") && pins[0] === net) return 90;
    // Two-terminal to ground → node is “the” device node (C1, R1…).
    if (onGnd && pins.length >= 2 && pins.includes(net)) return 80;
    if (letter === "C" || letter === "L" || letter === "R") return 60;
    if (letter === "D" || letter === "Q" || letter === "M" || letter === "X") return 40;
    return 20;
  };

  const aliases = new Map<string, string>();
  for (const [net, list] of byNet) {
    if (!/^\d+$/.test(net)) {
      // Already a named net from the schematic — use as-is (preserve case from netlist).
      aliases.set(net, net);
      aliases.set(net.toUpperCase(), net);
      continue;
    }
    let best: NetlistDevice | null = null;
    let bestScore = -1;
    for (const d of list) {
      const s = score(d, net);
      if (s > bestScore) {
        bestScore = s;
        best = d;
      } else if (s === bestScore && best && d.refdes.localeCompare(best.refdes) < 0) {
        best = d;
      }
    }
    if (best) {
      aliases.set(net, best.refdes);
      aliases.set(net.toUpperCase(), best.refdes);
    }
  }
  return aliases;
}

/** Canonical refdes casing from the netlist (R1 not r1). */
function refdesCaseMap(devices: NetlistDevice[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of devices) m.set(d.refdes.toUpperCase(), d.refdes);
  return m;
}

/**
 * Chart legend labels aligned 1:1 with `series` order.
 * Maps V(1)/I(v1) onto netlist symbols (R1, C1, V1…) without changing series names
 * (probe hover still matches V(net) / I(refdes)).
 */
export function legendLabelsForSeries(series: SimSeries[], netlist?: string): string[] {
  if (!series.length) return [];
  if (!netlist?.trim()) return series.map((s) => cleanSignalName(s.name));

  const devices = parseNetlistDevices(netlist);
  if (!devices.length) return series.map((s) => cleanSignalName(s.name));

  const netAlias = netSymbolAliases(devices);
  const refCase = refdesCaseMap(devices);

  const meta = series.map((s) => {
    const cleaned = cleanSignalName(s.name);
    const fn = /^([VI])\((.+)\)$/i.exec(cleaned);
    if (!fn) return { cleaned, kind: "other" as const, arg: "" };
    return {
      cleaned,
      kind: fn[1]!.toUpperCase() as "V" | "I",
      arg: fn[2]!,
    };
  });

  const labels = meta.map((m) => m.cleaned);
  const used = new Set<string>();

  const assign = (i: number, preferred: string, fallback: string) => {
    let name = preferred;
    if (used.has(name)) name = fallback;
    if (used.has(name)) name = meta[i]!.cleaned;
    let n = name;
    let k = 2;
    while (used.has(n)) {
      n = `${name}#${k++}`;
    }
    used.add(n);
    labels[i] = n;
  };

  for (let i = 0; i < meta.length; i++) {
    const m = meta[i]!;
    if (m.kind !== "V") continue;
    const sym = netAlias.get(m.arg) ?? netAlias.get(m.arg.toUpperCase()) ?? m.arg;
    assign(i, sym, m.cleaned);
  }
  for (let i = 0; i < meta.length; i++) {
    const m = meta[i]!;
    if (m.kind !== "I") continue;
    const ref = refCase.get(m.arg.toUpperCase()) ?? m.arg.toUpperCase();
    assign(i, ref, `I(${ref})`);
  }
  for (let i = 0; i < meta.length; i++) {
    const m = meta[i]!;
    if (m.kind === "V" || m.kind === "I") continue;
    assign(i, m.cleaned, m.cleaned);
  }
  return labels;
}

/** @deprecated Prefer legendLabelsForSeries — kept for tests/callers of the mutate path. */
export function applyNetlistLegendNames(series: SimSeries[], netlist: string): SimSeries[] {
  const labels = legendLabelsForSeries(series, netlist);
  return series.map((s, i) => ({ ...s, name: labels[i] ?? s.name }));
}

/** Clean labels, map subckt source current to I(XM1), hide internal Mos legs. */
export function formatSeriesForChart(series: SimSeries[], netlist?: string): SimSeries[] {
  const scope = netlist?.trim() ? topLevelSignalScope(netlist) : null;
  const aliases: SimSeries[] = [];
  for (const s of series) {
    const alias = subcktInstanceCurrentAlias(s.name);
    if (alias) aliases.push({ ...s, name: alias });
  }
  const filtered = series
    .filter((s) =>
      shouldShowInChart(s.name, scope?.refs, scope?.nets),
    )
    .map((s) => ({ ...s, name: cleanSignalName(s.name) }));
  for (const a of aliases) {
    if (
      scope &&
      !shouldShowInChart(a.name, scope.refs, scope.nets)
    ) {
      continue;
    }
    if (!filtered.some((f) => f.name === a.name)) filtered.push(a);
  }
  // Keep V(net)/I(refdes) names so canvas probe hover still matches.
  // Legend display remapping happens in SimPanel via legendLabelsForSeries.
  return filtered;
}

/** Submit + poll. No demo fallback — schematic Run and SiC compare share this. */
export async function runFleetJob(
  netlist: string,
  opts: RunSimulationOptions = {},
): Promise<FleetJobResult> {
  const engine = opts.engine ?? "D2SPICE";
  const raw = (opts.ensurePrint === false ? netlist : withBatchPrint(netlist)).trim();
  if (!raw) return { ok: false, error: "Empty netlist" };

  const url = simApiUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onOuterAbort);

  try {
    const submitted = await postForm(
      url,
      { action: "submit", engine, netlist: raw },
      controller.signal,
    );
    const submitErr = payloadError(submitted.data);
    if (submitErr) return { ok: false, error: submitErr };

    const jobId = jobIdFrom(submitted.data);
    if (!jobId) {
      if (normalizeSeries(submitted.data).length) return { ok: true, data: submitted.data };
      return { ok: false, error: "Simulation did not return a job_id" };
    }

    for (let i = 0; i < MAX_POLLS; i++) {
      if (controller.signal.aborted) break;
      const polled = await postForm(url, { action: "poll", job_id: jobId }, controller.signal);
      const pollErr = payloadError(polled.data);
      if (pollErr) return { ok: false, error: pollErr };

      const d =
        polled.data && typeof polled.data === "object"
          ? (polled.data as Record<string, unknown>)
          : {};
      const st = String(d.status ?? "");
      if (st === "error") {
        return { ok: false, error: String(d.error ?? d.message ?? "sim failed") };
      }
      if (st === "done" || st === "complete" || st === "finished") {
        return { ok: true, data: polled.data };
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    if (opts.signal?.aborted || controller.signal.aborted) {
      return { ok: false, error: "Simulation cancelled", aborted: true };
    }
    return { ok: false, error: "Simulation timed out waiting for results" };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return {
        ok: false,
        error: opts.signal?.aborted ? "Simulation cancelled" : "Simulation timed out",
        aborted: Boolean(opts.signal?.aborted),
      };
    }
    const msg = e instanceof Error ? e.message : "network error";
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * Call sim_api.php with the current schematic netlist (submit + poll).
 * Returns an error result when the fleet call fails — no fake demo waveform.
 */
export async function runSimulation(
  netlist: string,
  opts: RunSimulationOptions = {},
): Promise<SimResult> {
  const engine = opts.engine ?? "D2SPICE";
  const job = await runFleetJob(netlist, opts);
  if (!job.ok) {
    return {
      ok: false,
      source: "demo",
      message: job.error,
      series: [],
      engine,
    };
  }
  const series = formatSeriesForChart(normalizeSeries(job.data), netlist);
  if (!series.length) {
    return {
      ok: false,
      source: "demo",
      message: "Simulation returned no waveform data",
      series: [],
      engine,
    };
  }
  return {
    ok: true,
    source: "fleet",
    message: `Simulation complete (${engine})`,
    series,
    engine,
  };
}

/** Accept fleet table JSON and a few other plot shapes. */
export function normalizeSeries(data: unknown): SimSeries[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;

  // Fleet poll envelope: { status, result: { columns | analyses } }
  if (d.result && typeof d.result === "object") {
    const fromResult = normalizeSeries(d.result);
    if (fromResult.length) return fromResult;
  }

  if (Array.isArray(d.columns) && Array.isArray(d.rows)) {
    const table = tableToSeries(d.columns, d.rows);
    if (table.length) return table;
  }

  // ngspice: one table per signal group — merge them all (not just analyses[0]).
  if (Array.isArray(d.analyses) && d.analyses.length > 0) {
    const merged: SimSeries[] = [];
    for (const a of d.analyses) {
      merged.push(...normalizeSeries(a));
    }
    if (merged.length) return merged;
  }

  // { series: [{ name, x, y }] }
  if (Array.isArray(d.series)) {
    return (d.series as unknown[])
      .map(coerceSeries)
      .filter((s): s is SimSeries => s !== null);
  }

  for (const nest of [d.data, d.payload]) {
    if (nest && typeof nest === "object") {
      const inner = normalizeSeries(nest);
      if (inner.length) return inner;
    }
  }

  // { time: number[], waveforms: { name: number[] } }
  if (Array.isArray(d.time) && d.waveforms && typeof d.waveforms === "object") {
    const time = (d.time as unknown[]).map(Number).filter((n) => Number.isFinite(n));
    return Object.entries(d.waveforms as Record<string, unknown>)
      .map(([name, ys]) => {
        if (!Array.isArray(ys)) return null;
        const y = ys.map(Number);
        if (y.length !== time.length) return null;
        return { name, x: time, y };
      })
      .filter((s): s is SimSeries => s !== null);
  }

  // { x: number[], y: number[], name?: string }
  if (Array.isArray(d.x) && Array.isArray(d.y)) {
    const s = coerceSeries({ name: d.name ?? "y", x: d.x, y: d.y });
    return s ? [s] : [];
  }

  // { traces: [{ name, x, y }] } (Chart.js-ish demos)
  if (Array.isArray(d.traces)) {
    return (d.traces as unknown[])
      .map(coerceSeries)
      .filter((s): s is SimSeries => s !== null);
  }

  return [];
}

function isTimeColumn(name: string): boolean {
  const n = name.toLowerCase().trim();
  return n === "time" || n === "t" || n === "time (s)";
}

function isMetaColumn(name: string): boolean {
  const n = name.toLowerCase().trim();
  return isTimeColumn(n) || n === "index" || n === "i" || n === "step" || n === "freq";
}

function tableToSeries(columns: unknown[], rows: unknown[]): SimSeries[] {
  const cols = columns.map((c) => String(c));
  if (cols.length < 2 || rows.length === 0) return [];

  let iT = cols.findIndex((c) => isTimeColumn(c));
  if (iT < 0) iT = cols.findIndex((c) => !isMetaColumn(c));
  if (iT < 0) iT = 0;

  const x: number[] = [];
  const ys: number[][] = cols.map(() => []);
  for (const raw of rows) {
    if (!Array.isArray(raw)) continue;
    const t = Number(raw[iT]);
    if (!Number.isFinite(t)) continue;
    x.push(t);
    for (let c = 0; c < cols.length; c++) {
      ys[c]!.push(Number(raw[c]));
    }
  }
  if (x.length === 0) return [];

  const out: SimSeries[] = [];
  for (let c = 0; c < cols.length; c++) {
    if (c === iT || isMetaColumn(cols[c]!)) continue;
    const y = ys[c]!;
    if (y.length !== x.length || y.some((n) => !Number.isFinite(n))) continue;
    out.push({ name: cols[c] || `y${c}`, x, y });
  }
  return out;
}

function coerceSeries(raw: unknown): SimSeries | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (!Array.isArray(s.x) || !Array.isArray(s.y)) return null;
  const x = s.x.map(Number);
  const y = s.y.map(Number);
  if (x.length === 0 || x.length !== y.length) return null;
  if (x.some((n) => !Number.isFinite(n)) || y.some((n) => !Number.isFinite(n))) return null;
  return {
    name: String(s.name ?? s.label ?? "signal"),
    x,
    y,
  };
}
