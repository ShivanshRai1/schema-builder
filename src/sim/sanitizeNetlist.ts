/**
 * Accuracy helpers applied immediately before a fleet Run.
 * Fixes common netlist mistakes that produce flat/zero or truncated waveforms
 * (bare PWL points, .tran shorter than the PWL horizon, missing TVS stubs).
 */

function parseSpiceTime(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "");
  if (!t) return null;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([a-zA-Zµμ]*)$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const suf = (m[2] ?? "").toUpperCase().replace(/µ|μ/g, "U");
  if (!suf) return n;
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
    S: 1,
  };
  const f = mult[suf[0]!];
  return f != null ? n * f : null;
}

function formatSpiceTime(seconds: number): string {
  if (seconds >= 1) return String(Number(seconds.toPrecision(6)));
  if (seconds >= 1e-3) return `${Number((seconds * 1e3).toPrecision(6))}m`;
  if (seconds >= 1e-6) return `${Number((seconds * 1e6).toPrecision(6))}u`;
  return `${Number((seconds * 1e9).toPrecision(6))}n`;
}

function isNumericToken(tok: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[a-zA-Zµμ]*$/.test(tok);
}

/** Largest time coordinate inside any PWL(...) on V* lines (or bare pairs). */
export function pwlHorizonSeconds(netlist: string): number | null {
  let maxT: number | null = null;
  const considerPairs = (tokens: string[]) => {
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      const t = parseSpiceTime(tokens[i]!);
      if (t == null) continue;
      maxT = maxT == null ? t : Math.max(maxT, t);
    }
  };

  for (const raw of netlist.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("*") || line.startsWith(".")) continue;
    if (!/^[Vv]\S*/.test(line)) continue;

    const pwl = /PWL\s*\(([^)]*)\)/i.exec(line);
    if (pwl) {
      considerPairs(pwl[1]!.trim().split(/\s+/).filter(Boolean));
      continue;
    }

    const m = /^[Vv]\S*\s+\S+\s+\S+\s+(.+)$/.exec(line);
    if (!m) continue;
    const rest = m[1]!.trim();
    if (/^(PULSE|SIN|SINE|EXP|SFFM|DC|AC)\b/i.test(rest)) continue;
    const parts = rest.split(/\s+/).filter(Boolean);
    if (parts.length >= 4 && parts.length % 2 === 0 && parts.every(isNumericToken)) {
      considerPairs(parts);
    }
  }
  return maxT;
}

/** `V1 1 0 0 27.8 0.01 151…` → `V1 1 0 PWL(0 27.8 0.01 151…)` */
export function wrapBarePwlSources(netlist: string): { text: string; fixed: string[] } {
  const fixed: string[] = [];
  const text = netlist
    .split(/\r?\n/)
    .map((raw) => {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith(".")) return raw;
      const m = /^([Vv]\S+)\s+(\S+)\s+(\S+)\s+(.+)$/.exec(trimmed);
      if (!m) return raw;
      const rest = m[4]!.trim();
      if (/^(PWL|PULSE|SIN|SINE|EXP|SFFM|DC|AC)\b/i.test(rest)) return raw;
      const parts = rest.split(/\s+/).filter(Boolean);
      if (
        parts.length >= 4 &&
        parts.length % 2 === 0 &&
        parts.every(isNumericToken)
      ) {
        fixed.push(m[1]!);
        const indent = raw.match(/^\s*/)?.[0] ?? "";
        return `${indent}${m[1]} ${m[2]} ${m[3]} PWL(${rest})`;
      }
      return raw;
    })
    .join("\n");
  return { text, fixed };
}

/**
 * If .tran stop is shorter than the PWL horizon, extend stop (and soften step)
 * so load-dump / long PWLs are not truncated to a straight ramp.
 */
export function ensureTranCoversPwl(netlist: string): { text: string; note?: string } {
  const horizon = pwlHorizonSeconds(netlist);
  if (horizon == null || horizon <= 0) return { text: netlist };

  const tranRe = /^\s*\.tran\b(.*)$/im;
  const m = tranRe.exec(netlist);
  if (!m) {
    const line = `.tran ${formatSpiceTime(horizon / 1000)} ${formatSpiceTime(horizon)}`;
    const note = `Inserted ${line} to cover PWL (t≈${formatSpiceTime(horizon)})`;
    if (/\.end\s*$/im.test(netlist)) {
      return { text: netlist.replace(/\.end\s*$/im, `${line}\n.end`), note };
    }
    return { text: `${netlist.replace(/\s*$/, "")}\n${line}\n`, note };
  }

  const args = m[1]!.trim().split(/\s+/).filter(Boolean);
  // Common forms: .tran step stop | .tran tstep tstop [tstart [tmax]]
  const stepTok = args[0] ?? "1u";
  const stopTok = args[1] ?? "1m";
  const stop = parseSpiceTime(stopTok);
  if (stop == null) return { text: netlist };
  // Allow 2% slack; only extend when clearly too short (e.g. 1m vs 1s pulse).
  if (stop >= horizon * 0.98) return { text: netlist };

  const newStop = formatSpiceTime(horizon);
  const stepSec = parseSpiceTime(stepTok);
  let newStep = stepTok;
  // Keep ~1k–4k points across the horizon when the old step was meant for 1ms.
  if (stepSec != null && horizon / stepSec > 20000) {
    newStep = formatSpiceTime(horizon / 2000);
  }
  const newTran = `.tran ${newStep} ${newStop}`;
  const text = netlist.replace(tranRe, newTran);
  return {
    text,
    note: `Extended .tran to ${newStep} → ${newStop} (PWL ends ~${formatSpiceTime(horizon)}; was ${stepTok} → ${stopTok})`,
  };
}

/** Model / subckt names defined in the deck. */
export function definedSpiceNames(netlist: string): Set<string> {
  const out = new Set<string>();
  for (const raw of netlist.split(/\r?\n/)) {
    const t = raw.trim();
    const model = /^\.model\s+(\S+)/i.exec(t);
    if (model) out.add(model[1]!.toUpperCase());
    const sub = /^\.subckt\s+(\S+)/i.exec(t);
    if (sub) out.add(sub[1]!.toUpperCase());
  }
  return out;
}

/**
 * Device lines that reference a model/subckt. Returns missing names.
 * Skips V/I/R/C/L/K and pure numeric values.
 */
export function missingModelRefs(netlist: string): string[] {
  const defined = definedSpiceNames(netlist);
  const missing = new Set<string>();
  for (const raw of netlist.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith("*") || t.startsWith(".")) continue;
    // D/Q/J/M/X … last token is usually the model
    const m = /^([DQJMX]\S*)\s+(.+)$/i.exec(t);
    if (!m) continue;
    const toks = m[2]!.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) continue;
    const last = toks[toks.length - 1]!;
    if (/^(PULSE|SIN|SINE|EXP|PWL|DC|AC)\b/i.test(last)) continue;
    if (isNumericToken(last) && !/^[A-Za-z_]/.test(last)) continue;
    if (/[=]/.test(last)) continue; // param=value
    const key = last.toUpperCase();
    if (!defined.has(key)) missing.add(last);
  }
  return [...missing];
}

/**
 * If the deck has vendor TVS .subckts but diodes still say DTVSBI/DTVS,
 * rewrite those instances to X… <subckt> so the uploaded models are used.
 */
export function bindTvsPlaceholdersToLibrary(netlist: string): {
  text: string;
  notes: string[];
} {
  const subNames = new Map<string, string>(); // upper → original
  for (const line of netlist.split(/\r?\n/)) {
    const s = /^\.subckt\s+(\S+)/i.exec(line.trim());
    if (s) subNames.set(s[1]!.toUpperCase(), s[1]!);
  }

  let biName: string | null = null;
  let uniName: string | null = null;
  for (const [upper, orig] of subNames) {
    if (/^XFD/i.test(upper) || /TVSBI|BIDIR/i.test(upper)) biName = biName ?? orig;
    if (/^SM\d/i.test(upper) || /SM8S|SM5S/i.test(upper)) uniName = uniName ?? orig;
  }
  if (!biName && !uniName) return { text: netlist, notes: [] };

  const notes: string[] = [];
  const text = netlist
    .split(/\r?\n/)
    .map((raw) => {
      const t = raw.trim();
      if (!t || t.startsWith("*") || t.startsWith(".")) return raw;
      const m = /^([Dd]\S+)\s+(\S+)\s+(\S+)\s+(DTVSBI|DTVS)\s*$/i.exec(t);
      if (!m) return raw;
      const placeholder = m[4]!.toUpperCase();
      const target = placeholder === "DTVSBI" ? biName : uniName ?? biName;
      if (!target) return raw;
      const xref = /^x/i.test(m[1]!) ? m[1]! : `X${m[1]}`;
      const indent = raw.match(/^\s*/)?.[0] ?? "";
      notes.push(`${m[1]} ${placeholder} → ${xref} … ${target}`);
      return `${indent}${xref} ${m[2]} ${m[3]} ${target}`;
    })
    .join("\n");

  return { text, notes: [...new Set(notes)] };
}

/**
 * Map instance model tokens onto defined .subckt names (case / P_ prefix).
 * QSPICE treats subckt names as case-sensitive; UI often uses SM8S36A while
 * the file defines sm8s36a.
 */
export function remapModelRefsToDefinedSubckts(netlist: string): {
  text: string;
  notes: string[];
} {
  const defined = new Map<string, string>(); // upper → original spelling
  for (const line of netlist.split(/\r?\n/)) {
    const s = /^\.subckt\s+(\S+)/i.exec(line.trim());
    if (s) defined.set(s[1]!.toUpperCase(), s[1]!);
  }
  if (!defined.size) return { text: netlist, notes: [] };

  const resolve = (want: string): string | null => {
    const key = want.toUpperCase();
    if (defined.has(key)) return defined.get(key)!;
    const stripped = key.replace(/^P_/, "");
    if (defined.has(stripped)) return defined.get(stripped)!;
    for (const [upper, orig] of defined) {
      if (upper.includes(stripped) || stripped.includes(upper)) return orig;
    }
    return null;
  };

  const notes: string[] = [];
  const text = netlist
    .split(/\r?\n/)
    .map((raw) => {
      const t = raw.trim();
      if (!t || t.startsWith("*") || t.startsWith(".")) return raw;
      const m = /^([DQJMX]\S*)\s+(.+)$/i.exec(t);
      if (!m) return raw;
      const toks = m[2]!.trim().split(/\s+/).filter(Boolean);
      if (!toks.length) return raw;
      const last = toks[toks.length - 1]!;
      if (/^(PULSE|SIN|SINE|EXP|PWL|DC|AC)\b/i.test(last)) return raw;
      if (isNumericToken(last) && !/^[A-Za-z_]/.test(last)) return raw;
      if (/[=]/.test(last)) return raw;
      const resolved = resolve(last);
      if (!resolved || resolved === last) return raw;
      toks[toks.length - 1] = resolved;
      const indent = raw.match(/^\s*/)?.[0] ?? "";
      notes.push(`${last} → ${resolved}`);
      return `${indent}${m[1]} ${toks.join(" ")}`;
    })
    .join("\n");

  return { text, notes: [...new Set(notes)] };
}

export interface SanitizeNetlistResult {
  netlist: string;
  notes: string[];
  /** Hard problems that likely yield wrong / empty results. */
  warnings: string[];
}

/**
 * Full pre-Run pass for accuracy. Safe to apply on every simulation.
 */
export function sanitizeNetlistForAccuracy(netlist: string): SanitizeNetlistResult {
  const notes: string[] = [];
  const warnings: string[] = [];
  let text = netlist;

  const pwl = wrapBarePwlSources(text);
  text = pwl.text;
  if (pwl.fixed.length) {
    notes.push(`Wrapped bare PWL on ${pwl.fixed.join(", ")}`);
  }

  const tvs = bindTvsPlaceholdersToLibrary(text);
  text = tvs.text;
  notes.push(...tvs.notes);

  const remap = remapModelRefsToDefinedSubckts(text);
  text = remap.text;
  notes.push(...remap.notes);

  const tran = ensureTranCoversPwl(text);
  text = tran.text;
  if (tran.note) notes.push(tran.note);

  if (/delay\s*\(|\bTABLE\s*\(/i.test(text)) {
    warnings.push(
      "Library uses LTspice-only constructs (delay/TABLE) — D2SPICE/QSPICE may reject those .subckt bodies",
    );
  }

  const missing = missingModelRefs(text);
  if (missing.length) {
    warnings.push(
      `Missing .model / .subckt: ${missing.join(", ")} — drop the PN files into Models (e.g. P_XFD11K54CA.txt, SM8S36A.txt)`,
    );
  }

  return { netlist: text, notes, warnings };
}
