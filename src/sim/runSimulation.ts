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
 * Add .print on the submitted copy only — do not rewrite the editor text.
 */
function withBatchPrint(netlist: string): string {
  if (/\.(print|plot|fourier)\b/i.test(netlist)) return netlist;
  const line = ".print tran all";
  if (/\.end\s*$/im.test(netlist)) {
    return netlist.replace(/\.end\s*$/im, `${line}\n.end`);
  }
  return `${netlist.replace(/\s*$/, "")}\n${line}\n.end`;
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
 * On any failure → demoWaveform (safe fallback; does not break the app).
 */
export async function runSimulation(
  netlist: string,
  opts: RunSimulationOptions = {},
): Promise<SimResult> {
  const engine = opts.engine ?? "D2SPICE";
  const job = await runFleetJob(netlist, opts);
  if (!job.ok) {
    if (job.aborted) {
      return { ok: false, source: "demo", message: job.error, series: [] };
    }
    const err = job.error;
    return demoWaveform(err.startsWith("Simulation") ? err : `Simulation error: ${err}`);
  }
  const series = normalizeSeries(job.data);
  if (!series.length) return demoWaveform("Simulation returned no waveform data");
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

  if (Array.isArray(d.columns) && Array.isArray(d.rows)) {
    const table = tableToSeries(d.columns, d.rows);
    if (table.length) return table;
  }

  if (Array.isArray(d.analyses) && d.analyses[0]) {
    const inner = normalizeSeries(d.analyses[0]);
    if (inner.length) return inner;
  }

  // { series: [{ name, x, y }] }
  if (Array.isArray(d.series)) {
    return (d.series as unknown[])
      .map(coerceSeries)
      .filter((s): s is SimSeries => s !== null);
  }

  // { data: { series: [...] } } or { result: { series } }
  for (const nest of [d.data, d.result, d.payload]) {
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
