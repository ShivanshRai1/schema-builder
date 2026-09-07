import type { ComponentKind, PinSpec } from "./types";

const MAX_MATH_INPUTS = 8;

function pin(id: string, label: string, side: PinSpec["side"], offset = 0.5): PinSpec {
  return { id, label, side, offset };
}

/** Simulink-style sum signs: keep only + / −; `|` and spaces are spacers. */
export function parseSumSigns(raw: string): ("+" | "-")[] {
  const out: ("+" | "-")[] = [];
  for (const ch of raw) {
    if (ch === "+" || ch === "-") out.push(ch);
    if (out.length >= MAX_MATH_INPUTS) break;
  }
  return out.length ? out : ["+", "-"];
}

/** Product ops: `*` multiply, `/` divide. */
export function parseProductOps(raw: string): ("*" | "/")[] {
  const out: ("*" | "/")[] = [];
  for (const ch of raw) {
    if (ch === "*" || ch === "/") out.push(ch);
    if (out.length >= MAX_MATH_INPUTS) break;
  }
  return out.length ? out : ["*", "*"];
}

function evenly(n: number, i: number): number {
  return (i + 1) / (n + 1);
}

export function sumPinsFromSigns(signsRaw: string): PinSpec[] {
  const signs = parseSumSigns(signsRaw);
  const pins: PinSpec[] = signs.map((s, i) =>
    pin(`u${i + 1}`, s, "left", evenly(signs.length, i)),
  );
  pins.push(pin("y", "Y", "right", 0.5));
  return pins;
}

export function productPinsFromOps(opsRaw: string): PinSpec[] {
  const ops = parseProductOps(opsRaw);
  const pins: PinSpec[] = ops.map((op, i) =>
    pin(`u${i + 1}`, op === "*" ? "×" : "÷", "left", evenly(ops.length, i)),
  );
  pins.push(pin("y", "Y", "right", 0.5));
  return pins;
}

export function logicPinsFromOp(opRaw: string, inputsRaw?: string): PinSpec[] {
  const op = (opRaw || "AND").toUpperCase();
  if (op === "NOT") {
    return [pin("u1", "1", "left", 0.5), pin("y", "Y", "right", 0.5)];
  }
  let n = Math.round(Number(inputsRaw ?? "2"));
  if (!Number.isFinite(n) || n < 2) n = 2;
  if (n > MAX_MATH_INPUTS) n = MAX_MATH_INPUTS;
  // XOR / XNOR are typically binary; still allow n≥2 for Simulink-like flexibility.
  const pins: PinSpec[] = [];
  for (let i = 0; i < n; i++) {
    pins.push(pin(`u${i + 1}`, String(i + 1), "left", evenly(n, i)));
  }
  pins.push(pin("y", "Y", "right", 0.5));
  return pins;
}

export function isMathKind(kind: ComponentKind): boolean {
  return (
    kind === "MATH_CONST" ||
    kind === "MATH_SUM" ||
    kind === "MATH_PROD" ||
    kind === "MATH_GAIN" ||
    kind === "MATH_REL" ||
    kind === "MATH_LOGIC"
  );
}
