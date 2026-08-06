/**
 * Step-4 fleet hookup.
 *
 * Contract (adjust only here when the real sim_api.php shape is confirmed):
 *   POST ./sim_api.php
 *   body: { netlist: string, engine: "D1SPICE" | "D2SPICE", action: "simulate" }
 *   success: JSON with plot series (see normalizeSeries)
 *
 * If the API is missing, errors, or returns unusable data → demo plot.
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

const FETCH_TIMEOUT_MS = 60_000;

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
      ? `${reason} — showing demo plot`
      : "Demo waveform (fleet offline) — showing demo plot",
    series: [{ name: "V(out)", x, y }],
  };
}

export interface RunSimulationOptions {
  engine?: SimEngine;
  /** AbortSignal from the panel (e.g. unmount / new Run). */
  signal?: AbortSignal;
}

/**
 * Call sim_api.php with the current netlist.
 * On any failure → demoWaveform (safe fallback; does not break the app).
 */
export async function runSimulation(
  netlist: string,
  opts: RunSimulationOptions = {},
): Promise<SimResult> {
  const engine = opts.engine ?? "D2SPICE";
  const trimmed = netlist.trim();
  if (!trimmed) {
    return demoWaveform("Empty netlist");
  }

  const url = simApiUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onOuterAbort);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        netlist: trimmed,
        engine,
        action: "simulate",
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return demoWaveform(`Fleet unavailable (HTTP ${res.status})`);
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return demoWaveform("Fleet returned non-JSON");
    }

    // Explicit API error payload
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      if (d.ok === false || d.error) {
        const err = String(d.error ?? d.message ?? "simulation failed");
        return demoWaveform(`Fleet error: ${err}`);
      }
    }

    const series = normalizeSeries(data);
    if (!series.length) {
      return demoWaveform("Fleet response had no plot series");
    }

    return {
      ok: true,
      source: "fleet",
      message: `Simulation complete (${engine})`,
      series,
      engine,
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      if (opts.signal?.aborted) {
        return {
          ok: false,
          source: "demo",
          message: "Simulation cancelled",
          series: [],
        };
      }
      return demoWaveform("Fleet timed out");
    }
    const msg = e instanceof Error ? e.message : "network error";
    return demoWaveform(`Fleet unavailable (${msg})`);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/** Accept a few common fleet / demo JSON shapes. */
export function normalizeSeries(data: unknown): SimSeries[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;

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
