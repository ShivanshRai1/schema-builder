/**
 * Safe algebraic expressions over sim series — LTspice-style plot formulas.
 * Supports V(net), I(ref), numbers, + - * / , parentheses, and
 * abs/sqrt/pow/exp/log/ln/sin/cos/tan/min/max/pi.
 */
import type { SimSeries } from "./runSimulation";
import { cleanSignalName } from "./runSimulation";
import { seriesByNameLoose } from "./probeHover";

const FN: Record<string, (...args: number[]) => number> = {
  abs: (a) => Math.abs(a),
  sqrt: (a) => Math.sqrt(a),
  exp: (a) => Math.exp(a),
  log: (a) => Math.log10(a),
  ln: (a) => Math.log(a),
  sin: (a) => Math.sin(a),
  cos: (a) => Math.cos(a),
  tan: (a) => Math.tan(a),
  pow: (a, b) => Math.pow(a, b ?? 0),
  min: (a, b) => Math.min(a, b ?? a),
  max: (a, b) => Math.max(a, b ?? a),
};

type Tok =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" };

function tokenize(src: string): Tok[] | null {
  const s = src.trim();
  if (!s) return null;
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(") {
      out.push({ t: "lp" });
      i++;
      continue;
    }
    if (c === ")") {
      out.push({ t: "rp" });
      i++;
      continue;
    }
    if (c === ",") {
      out.push({ t: "comma" });
      i++;
      continue;
    }
    if ("+-*/".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[0-9.eE+-]/.test(s[j]!)) j++;
      const n = Number(s.slice(i, j));
      if (!Number.isFinite(n)) return null;
      out.push({ t: "num", v: n });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j]!)) j++;
      out.push({ t: "id", v: s.slice(i, j) });
      i = j;
      continue;
    }
    return null;
  }
  return out;
}

type Node =
  | { k: "num"; v: number }
  | { k: "ref"; name: string }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; name: string; args: Node[] }
  | { k: "neg"; a: Node };

function parseExpr(tokens: Tok[]): Node | null {
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];

  const parsePrimary = (): Node | null => {
    const t = peek();
    if (!t) return null;
    if (t.t === "num") {
      take();
      return { k: "num", v: t.v };
    }
    if (t.t === "op" && t.v === "-") {
      take();
      const a = parsePrimary();
      return a ? { k: "neg", a } : null;
    }
    if (t.t === "op" && t.v === "+") {
      take();
      return parsePrimary();
    }
    if (t.t === "lp") {
      take();
      const inner = parseAdd();
      if (!inner || peek()?.t !== "rp") return null;
      take();
      return inner;
    }
    if (t.t === "id") {
      take();
      const name = t.v;
      if (peek()?.t === "lp") {
        take();
        const args: Node[] = [];
        if (peek()?.t !== "rp") {
          for (;;) {
            const a = parseAdd();
            if (!a) return null;
            args.push(a);
            if (peek()?.t === "comma") {
              take();
              continue;
            }
            break;
          }
        }
        if (peek()?.t !== "rp") return null;
        take();
        // V(net) / I(ref) — treat as signal refs, not math calls.
        if (/^[vi]$/i.test(name) && args.length >= 1 && args.length <= 2) {
          const parts = args.map((a) => {
            if (a.k === "ref") return a.name;
            if (a.k === "num") return String(a.v);
            if (a.k === "call" && a.args.length === 0) return a.name;
            return null;
          });
          if (parts.every((p) => p != null)) {
            const label =
              args.length === 2
                ? `${name.toUpperCase()}(${parts[0]},${parts[1]})`
                : `${name.toUpperCase()}(${parts[0]})`;
            return { k: "ref", name: label };
          }
        }
        return { k: "call", name: name.toLowerCase(), args };
      }
      if (/^pi$/i.test(name)) return { k: "num", v: Math.PI };
      return { k: "ref", name };
    }
    return null;
  };

  const parseMul = (): Node | null => {
    let left = parsePrimary();
    if (!left) return null;
    for (;;) {
      const t = peek();
      if (!t || t.t !== "op" || (t.v !== "*" && t.v !== "/")) break;
      const op = (take() as { t: "op"; v: string }).v;
      const right = parsePrimary();
      if (!right) return null;
      left = { k: "bin", op, a: left, b: right };
    }
    return left;
  };

  const parseAdd = (): Node | null => {
    let left = parseMul();
    if (!left) return null;
    for (;;) {
      const t = peek();
      if (!t || t.t !== "op" || (t.v !== "+" && t.v !== "-")) break;
      const op = (take() as { t: "op"; v: string }).v;
      const right = parseMul();
      if (!right) return null;
      left = { k: "bin", op, a: left, b: right };
    }
    return left;
  };

  const tree = parseAdd();
  if (!tree || i !== tokens.length) return null;
  return tree;
}

function collectRefs(n: Node, into: Set<string>) {
  if (n.k === "ref") into.add(n.name);
  if (n.k === "bin") {
    collectRefs(n.a, into);
    collectRefs(n.b, into);
  }
  if (n.k === "call") n.args.forEach((a) => collectRefs(a, into));
  if (n.k === "neg") collectRefs(n.a, into);
}

function evalAt(
  n: Node,
  sample: (name: string) => number | null,
): number | null {
  if (n.k === "num") return n.v;
  if (n.k === "ref") return sample(n.name);
  if (n.k === "neg") {
    const a = evalAt(n.a, sample);
    return a == null ? null : -a;
  }
  if (n.k === "bin") {
    const a = evalAt(n.a, sample);
    const b = evalAt(n.b, sample);
    if (a == null || b == null) return null;
    if (n.op === "+") return a + b;
    if (n.op === "-") return a - b;
    if (n.op === "*") return a * b;
    if (n.op === "/") return b === 0 ? null : a / b;
    return null;
  }
  if (n.k === "call") {
    const fn = FN[n.name];
    if (!fn) return null;
    const args = n.args.map((a) => evalAt(a, sample));
    if (args.some((a) => a == null)) return null;
    const v = fn(...(args as number[]));
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

function lookupSeries(
  all: readonly SimSeries[],
  name: string,
): SimSeries | undefined {
  const cleaned = cleanSignalName(name);
  return (
    seriesByNameLoose(all, cleaned) ??
    seriesByNameLoose(all, name) ??
    seriesByNameLoose(all, cleaned.toUpperCase())
  );
}

/**
 * Evaluate `expr` against simulation series.
 * Returns null if the expression is invalid or required signals are missing.
 */
export function evaluateProbeExpression(
  expr: string,
  all: readonly SimSeries[],
): { series: SimSeries; error?: undefined } | { series?: undefined; error: string } {
  const tokens = tokenize(expr);
  if (!tokens) return { error: "Could not parse expression" };
  const tree = parseExpr(tokens);
  if (!tree) return { error: "Invalid expression syntax" };

  const refs = new Set<string>();
  collectRefs(tree, refs);
  const resolved = new Map<string, SimSeries>();
  for (const r of refs) {
    const s = lookupSeries(all, r);
    if (!s) return { error: `Signal not found: ${r}` };
    resolved.set(r.toUpperCase(), s);
  }

  // Prefer time base from first voltage-like ref, else first ref.
  let base: SimSeries | undefined;
  for (const r of refs) {
    const s = resolved.get(r.toUpperCase());
    if (s && /^V\(/i.test(cleanSignalName(s.name))) {
      base = s;
      break;
    }
  }
  if (!base) base = resolved.values().next().value;
  if (!base && all[0]) {
    // Constant-only expression (e.g. "pi") — use any time axis.
    base = all[0];
  }
  if (!base) return { error: "No time base available" };

  const x = base.x;
  const y: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const sample = (name: string): number | null => {
      const s = resolved.get(name.toUpperCase());
      if (!s) return null;
      // Same-length preferred; else nearest index.
      if (s.x.length === x.length) return s.y[i] ?? null;
      const ti = x[i]!;
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < s.x.length; j++) {
        const d = Math.abs(s.x[j]! - ti);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      return s.y[best] ?? null;
    };
    const v = evalAt(tree, sample);
    if (v == null || !Number.isFinite(v)) {
      y.push(NaN);
    } else {
      y.push(v);
    }
  }

  const label = expr.trim().replace(/\s+/g, "");
  return { series: { name: label, x: x.slice(), y } };
}
