import type { SimSeries } from "./runSimulation";
import { cleanSignalName } from "./runSimulation";
import { currentThrough, seriesByNameLoose } from "./probeHover";
import { evaluateProbeExpression } from "./probeExpressions";

/** User-selected LTspice-style probes (click-to-plot). */
export type ProbeSpec =
  | { kind: "V"; net: string }
  | { kind: "I"; refdes: string }
  | { kind: "Vd"; a: string; b: string }
  | { kind: "Expr"; expr: string; id: string };

export function probeKey(p: ProbeSpec): string {
  if (p.kind === "V") return `V(${p.net})`;
  if (p.kind === "I") return `I(${p.refdes})`;
  if (p.kind === "Expr") return p.expr.trim().replace(/\s+/g, "") || p.id;
  return `V(${p.a},${p.b})`;
}

export function probeLabel(p: ProbeSpec): string {
  return probeKey(p);
}

/** Stable LTspice-like colors so schematic pins match plot traces. */
export const PROBE_TRACE_COLORS = [
  "#00e676",
  "#40c4ff",
  "#ff5252",
  "#ffd740",
  "#e040fb",
  "#64ffda",
  "#ffab40",
  "#82b1ff",
] as const;

export function colorForSignalName(name: string): string {
  const s = name.trim().toUpperCase();
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)!;
    h = Math.imul(h, 16777619);
  }
  return PROBE_TRACE_COLORS[(h >>> 0) % PROBE_TRACE_COLORS.length]!;
}

export function sameProbe(a: ProbeSpec, b: ProbeSpec): boolean {
  if (a.kind === "Expr" && b.kind === "Expr") return a.id === b.id;
  return probeKey(a).toUpperCase() === probeKey(b).toUpperCase();
}

/** Subtract two same-length (or overlapping) voltage waveforms → V(a,b). */
export function differentialVoltage(
  va: SimSeries,
  vb: SimSeries,
  a: string,
  b: string,
): SimSeries | null {
  const n = Math.min(va.x.length, va.y.length, vb.x.length, vb.y.length);
  if (n < 2) return null;
  const sameX =
    n > 0 &&
    va.x.length === vb.x.length &&
    Math.abs((va.x[0] ?? 0) - (vb.x[0] ?? 0)) < 1e-18 &&
    Math.abs((va.x[n - 1] ?? 0) - (vb.x[n - 1] ?? 0)) < 1e-12;

  const x: number[] = [];
  const y: number[] = [];
  if (sameX) {
    for (let i = 0; i < n; i++) {
      x.push(va.x[i]!);
      y.push((va.y[i] ?? 0) - (vb.y[i] ?? 0));
    }
  } else {
    for (let i = 0; i < va.x.length; i++) {
      const xi = va.x[i]!;
      const yi = va.y[i] ?? 0;
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < vb.x.length; j++) {
        const d = Math.abs(vb.x[j]! - xi);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      x.push(xi);
      y.push(yi - (vb.y[best] ?? 0));
    }
  }
  return { name: `V(${a},${b})`, x, y };
}

export type ResolveProbesResult = {
  series: SimSeries[];
  missing: string[];
};

/** Build chart series for the active probe list (empty probes → caller shows all). */
export function resolveProbedSeries(
  all: readonly SimSeries[],
  probes: readonly ProbeSpec[],
): ResolveProbesResult {
  const series: SimSeries[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const p of probes) {
    const key = probeKey(p);
    const uk = key.toUpperCase();
    if (seen.has(uk)) continue;

    if (p.kind === "V") {
      const full = seriesByNameLoose(all, `V(${p.net})`);
      if (full) {
        seen.add(uk);
        series.push({ ...full, name: cleanSignalName(full.name) });
      } else if (p.net === "0" || /^gnd$/i.test(p.net)) {
        const any = all[0];
        if (any) {
          seen.add(uk);
          series.push({
            name: "V(0)",
            x: any.x.slice(),
            y: any.x.map(() => 0),
          });
        } else {
          missing.push(key);
        }
      } else {
        missing.push(`V(${p.net})`);
      }
      continue;
    }

    if (p.kind === "I") {
      const full = seriesByNameLoose(all, `I(${p.refdes})`);
      if (full) {
        seen.add(uk);
        series.push({ ...full, name: cleanSignalName(full.name) });
      } else {
        missing.push(`I(${p.refdes})`);
      }
      continue;
    }

    if (p.kind === "Expr") {
      const ev = evaluateProbeExpression(p.expr, all);
      if (ev.series) {
        seen.add(uk);
        series.push(ev.series);
      } else {
        missing.push(ev.error || key);
      }
      continue;
    }

    const fa = seriesByNameLoose(all, `V(${p.a})`);
    const fb =
      p.b === "0" || /^gnd$/i.test(p.b)
        ? (() => {
            const any = all[0];
            if (!any) return null;
            return {
              name: "V(0)",
              x: any.x.slice(),
              y: any.x.map(() => 0),
            } satisfies SimSeries;
          })()
        : seriesByNameLoose(all, `V(${p.b})`);
    const faOrGnd =
      !fa && (p.a === "0" || /^gnd$/i.test(p.a))
        ? (() => {
            const any = all[0];
            if (!any) return null;
            return {
              name: "V(0)",
              x: any.x.slice(),
              y: any.x.map(() => 0),
            } satisfies SimSeries;
          })()
        : fa;
    if (faOrGnd && fb) {
      const d = differentialVoltage(faOrGnd, fb, p.a, p.b);
      if (d) {
        seen.add(uk);
        series.push(d);
      } else {
        missing.push(key);
      }
    } else {
      if (!faOrGnd) missing.push(`V(${p.a})`);
      if (!fb) missing.push(`V(${p.b})`);
    }
  }

  return { series, missing };
}

export function isVoltageSignalName(name: string): boolean {
  return /^V\(/i.test(cleanSignalName(name));
}

export function isCurrentSignalName(name: string): boolean {
  return /^I\(/i.test(cleanSignalName(name));
}

export function probeAvailable(all: readonly SimSeries[], p: ProbeSpec): boolean {
  if (p.kind === "V") {
    if (p.net === "0" || /^gnd$/i.test(p.net)) return true;
    return Boolean(seriesByNameLoose(all, `V(${p.net})`));
  }
  if (p.kind === "I") {
    return Boolean(currentThrough(all, p.refdes));
  }
  if (p.kind === "Expr") {
    return !evaluateProbeExpression(p.expr, all).error;
  }
  return Boolean(
    (seriesByNameLoose(all, `V(${p.a})`) ||
      p.a === "0" ||
      /^gnd$/i.test(p.a)) &&
      (seriesByNameLoose(all, `V(${p.b})`) ||
        p.b === "0" ||
        /^gnd$/i.test(p.b)),
  );
}

/**
 * User-facing text when a probe cannot be built from the current result series.
 */
export function formatProbeMissingHint(
  missing: readonly string[],
  opts?: { fromSavedCondition?: boolean },
): string {
  const list = missing.filter(Boolean);
  const onlyGround =
    list.length > 0 &&
    list.every((s) => /^V\(0\)$/i.test(s) || /^V\(gnd\)$/i.test(s));
  if (onlyGround) {
    return "Ground is the 0 V reference (always 0) — click a live wire for voltage, or drag two wires for V(a,b).";
  }
  const signals =
    list.length === 0
      ? "Probed signal"
      : list.length === 1
        ? list[0]!
        : list.slice(0, 3).join(", ") + (list.length > 3 ? "…" : "");
  if (opts?.fromSavedCondition) {
    return `${signals} not in this saved plot — click Run, then probe again.`;
  }
  return `${signals} not in results — click Run, or probe a net that appears under Simulation results.`;
}
