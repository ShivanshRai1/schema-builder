/**
 * Normalize numeric property fields for SPICE (engineering suffixes + simple math).
 *
 * Safe by design: if the input is not a plain number / suffix / arithmetic
 * expression, the original string is returned unchanged (models, names,
 * PULSE(...), placeholders like "V" / "R", etc.).
 */

const PLACEHOLDER = /^(R|L|C|V|I|F|A|H|Hz|W|Ohm|Ω)$/i;

/** Full SPICE stimulus / non-scalar text — never rewrite. */
function looksLikeStimulusOrName(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  if (PLACEHOLDER.test(t)) return true;
  if (/^(PULSE|SIN|SINE|EXP|PWL|SFFM|AM|TRNOISE|TRRANDOM|DAY)\s*\(/i.test(t)) {
    return true;
  }
  if (/^(DC|AC)\s+/i.test(t) && /[()]/.test(t)) return true;
  // Model / identifier-ish (no digits as the value core)
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t) && !/^\d/.test(t)) return true;
  return false;
}

function suffixMultiplier(sufRaw: string): number | null {
  const suf = sufRaw.toUpperCase().replace(/µ|μ/g, "U");
  if (!suf) return 1;
  if (suf.startsWith("MEG") || suf === "X") return 1e6;
  const table: Record<string, number> = {
    T: 1e12,
    G: 1e9,
    K: 1e3,
    M: 1e-3,
    U: 1e-6,
    N: 1e-9,
    P: 1e-12,
    F: 1e-15,
  };
  const m = table[suf[0]!];
  return m ?? null;
}

/** Parse a single SPICE number token: 10, 1.2, 1e-3, 10k, 2.2u, 1Meg. */
export function parseSpiceNumberToken(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;

  // Plain / scientific (no unit letter)
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) {
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  const m =
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([a-zA-Zµμ]+)$/.exec(t);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  const mult = suffixMultiplier(m[2]!);
  if (mult == null) return null;
  return base * mult;
}

/**
 * Format a finite number as a compact SPICE-friendly literal.
 * Prefer plain decimals in a human-friendly band (1/1000 → 0.001);
 * use engineering suffixes for very small/large values (10e-9 → 10n).
 */
export function formatSpiceNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "0";

  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);

  // 0.001 … 999.999 → plain decimal (matches “1/1000 → 0.001”).
  if (abs >= 1e-3 && abs < 1e3) {
    return `${sign}${trimmedDecimal(abs)}`;
  }

  const scales: { s: number; u: string }[] = [
    { s: 1e12, u: "T" },
    { s: 1e9, u: "G" },
    { s: 1e6, u: "Meg" },
    { s: 1e3, u: "k" },
    { s: 1e-3, u: "m" },
    { s: 1e-6, u: "u" },
    { s: 1e-9, u: "n" },
    { s: 1e-12, u: "p" },
    { s: 1e-15, u: "f" },
  ];

  for (const { s, u } of scales) {
    const scaled = abs / s;
    if (scaled >= 1 && scaled < 1000) {
      return `${sign}${trimmedDecimal(roundNice(scaled))}${u}`;
    }
  }
  return `${sign}${trimmedDecimal(abs)}`;
}

function roundNice(x: number): number {
  return Math.round(x * 1e9) / 1e9;
}

function trimmedDecimal(x: number): string {
  if (Number.isInteger(x)) return String(x);
  // Avoid 0.0010000000002-style noise; keep enough SPICE precision.
  let s = x.toFixed(12).replace(/\.?0+$/, "");
  if (s === "-0") s = "0";
  return s;
}

/**
 * Evaluate a simple arithmetic expression with SPICE suffixes, e.g.
 * `1/1000`, `2*1k`, `(10+5)*1m`. Returns null if unsafe / not an expression.
 */
export function evalSpiceNumericExpr(raw: string): number | null {
  const compact = raw.trim().replace(/\s+/g, "");
  if (!compact) return null;
  if (!/[+\-*/()]/.test(compact)) return null;
  // Allow digits, operators, parentheses, and SPICE unit letters only.
  if (/[^0-9.eE+\-*/()a-zA-Zµμ]/.test(compact)) return null;

  // Normalize Meg before single-letter M (milli).
  let s = compact.replace(/Meg/gi, "MEG");

  s = s.replace(
    /([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(MEG|[a-zA-Zµμ])?/g,
    (all, num: string, suf?: string) => {
      const v = parseSpiceNumberToken(suf ? `${num}${suf}` : num);
      if (v == null) return all;
      // Wrap so `2*1k` → `2*(1000)` and unary minus stays valid.
      return `(${v})`;
    },
  );

  if (!/^[0-9.eE+\-*/()]+$/.test(s)) return null;

  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict"; return (${s});`)();
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * If `raw` is a SPICE number or simple expression, return a normalized
 * engineering literal. Otherwise return `raw` unchanged.
 */
export function normalizeSpiceNumericInput(raw: string): string {
  const t = raw.trim();
  if (!t) return raw;
  if (looksLikeStimulusOrName(t)) return raw;

  // Optional LTspice-style braces: {1/1000}
  const braced = /^\{(.+)\}$/.exec(t);
  const body = braced ? braced[1]!.trim() : t;

  if (/[+\-*/()]/.test(body)) {
    const v = evalSpiceNumericExpr(body);
    if (v == null) return raw;
    return formatSpiceNumber(v);
  }

  const v = parseSpiceNumberToken(body);
  if (v == null) return raw;
  return formatSpiceNumber(v);
}

const NUMERIC_KEYS = new Set([
  "value",
  "dc",
  "ac",
  "vinitial",
  "von",
  "tdelay",
  "trise",
  "tfall",
  "ton",
  "tperiod",
  "ic",
  "gain",
  "freq",
  "ioffset",
  "iamp",
  "theta",
  "phi",
  "rser",
  "cpara",
]);

/** True when this attribute should run through numeric normalization. */
export function isNumericParamKey(
  key: string,
  opts?: { unit?: string; type?: string },
): boolean {
  if (opts?.type === "select" || opts?.type === "checkbox") return false;
  if (
    key === "model" ||
    key === "name" ||
    key === "signs" ||
    key === "ops" ||
    key === "op" ||
    key === "bulk" ||
    key === "state" ||
    key === "throw" ||
    key === "inputs"
  ) {
    return false;
  }
  if (opts?.unit) return true;
  return NUMERIC_KEYS.has(key);
}
