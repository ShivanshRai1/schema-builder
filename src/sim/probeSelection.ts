import type { SimSeries } from "./runSimulation";
import { cleanSignalName } from "./runSimulation";
import { currentThrough, seriesByNameLoose } from "./probeHover";

/** User-selected LTspice-style probes (click-to-plot). */
export type ProbeSpec =
  | { kind: "V"; net: string }
  | { kind: "I"; refdes: string }
  | { kind: "Vd"; a: string; b: string };

export function probeKey(p: ProbeSpec): string {
  if (p.kind === "V") return `V(${p.net})`;
  if (p.kind === "I") return `I(${p.refdes})`;
  return `V(${p.a},${p.b})`;
}

export function probeLabel(p: ProbeSpec): string {
  return probeKey(p);
}

export function sameProbe(a: ProbeSpec, b: ProbeSpec): boolean {
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
  // Prefer identical time base; otherwise sample vb by nearest index.
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
      // Nearest sample in vb
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
  /** Probe keys that could not be resolved from sim data. */
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

    // Differential
    const fa = seriesByNameLoose(all, `V(${p.a})`);
    const fb = seriesByNameLoose(all, `V(${p.b})`);
    if (fa && fb) {
      const d = differentialVoltage(fa, fb, p.a, p.b);
      if (d) {
        seen.add(uk);
        series.push(d);
      } else {
        missing.push(key);
      }
    } else {
      if (!fa) missing.push(`V(${p.a})`);
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

/** Whether this probe can be resolved from current sim results. */
export function probeAvailable(all: readonly SimSeries[], p: ProbeSpec): boolean {
  if (p.kind === "V") {
    if (p.net === "0" || /^gnd$/i.test(p.net)) return true;
    return Boolean(seriesByNameLoose(all, `V(${p.net})`));
  }
  if (p.kind === "I") {
    return Boolean(currentThrough(all, p.refdes));
  }
  return Boolean(
    seriesByNameLoose(all, `V(${p.a})`) && seriesByNameLoose(all, `V(${p.b})`),
  );
}
