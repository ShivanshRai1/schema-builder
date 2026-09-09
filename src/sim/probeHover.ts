import type { SimSeries } from "./runSimulation";
import { cleanSignalName } from "./runSimulation";

/** Last Y sample of a waveform (DC-ish readout for probes). */
export function lastSample(s: SimSeries | undefined | null): number | null {
  if (!s?.y.length) return null;
  const v = s.y[s.y.length - 1];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function formatProbeValue(v: number, unit: "V" | "A"): string {
  const a = Math.abs(v);
  if (a >= 1e3) return `${(v / 1e3).toPrecision(4)} k${unit}`;
  if (a >= 1 || a === 0) return `${v.toPrecision(4)} ${unit}`;
  if (a >= 1e-3) return `${(v * 1e3).toPrecision(4)} m${unit}`;
  if (a >= 1e-6) return `${(v * 1e6).toPrecision(4)} µ${unit}`;
  return `${v.toExponential(3)} ${unit}`;
}

function seriesByName(series: readonly SimSeries[], name: string): SimSeries | undefined {
  const want = cleanSignalName(name).toUpperCase();
  return series.find((s) => cleanSignalName(s.name).toUpperCase() === want);
}

/** Public lookup used by click-to-probe chart resolution. */
export function seriesByNameLoose(
  series: readonly SimSeries[],
  name: string,
): SimSeries | undefined {
  return seriesByName(series, name);
}

/** Match V(net) / v(net) in sim results. */
export function voltageAtNet(
  series: readonly SimSeries[],
  net: string,
): { name: string; value: number } | null {
  const n = net.trim();
  if (!n) return null;
  if (n === "0" || /^gnd$/i.test(n)) {
    return { name: "V(0)", value: 0 };
  }
  const hit =
    seriesByName(series, `V(${n})`) ??
    seriesByName(series, `V(${n.toUpperCase()})`);
  const v = lastSample(hit);
  if (v == null || !hit) return null;
  return { name: cleanSignalName(hit.name), value: v };
}

/** Match I(refdes) branch current. */
export function currentThrough(
  series: readonly SimSeries[],
  refdes: string,
): { name: string; value: number } | null {
  const r = refdes.trim();
  if (!r) return null;
  const hit =
    seriesByName(series, `I(${r})`) ??
    seriesByName(series, `I(${r.toUpperCase()})`);
  const v = lastSample(hit);
  if (v == null || !hit) return null;
  return { name: cleanSignalName(hit.name), value: v };
}
