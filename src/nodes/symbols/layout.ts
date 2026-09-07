import type { ComponentKind } from "../../model/types";
import { normalizeRotation } from "../../model/rotation";
import { WIRE_GRID } from "../../wiring/orthogonal";

/** Parts rendered as schematic SVG symbols instead of HTML cards. */
export const SYMBOL_KINDS = new Set<ComponentKind>([
  "R",
  "RBOX",
  "RVAR",
  "RVARBOX",
  "POT",
  "POTBOX",
  "THERM",
  "LDR",
  "C",
  "CPOL",
  "CFIXED",
  "CVAR",
  "L",
  "LVAR",
  "XFMR",
  "CMMC",
  "FBEAD",
  "ANT",
  "XTAL",
  "V",
  "BATTERY",
  "VAC",
  "I",
  "IAC",
  "VPULSE",
  "GND",
  "GND_SIG",
  "GND_CH",
  "D",
  "DZ",
  "DS",
  "LED",
  "DTVS",
  "DTVSBI",
  "NMOS",
  "PMOS",
  "NMOS_D",
  "PMOS_D",
  "NJFET",
  "PJFET",
  "NPN",
  "PNP",
  "UJT",
  "SICMOS",
  "SICMOS_K",
  "GANHEMT",
  "IGBT",
  "IGBT_K",
  "SCR",
  "SCS",
  "TRIAC",
  "DIAC",
  "GTO",
  "SCR_PH",
  "SIDAC",
  "GATEDRV",
  "COMP",
  "EAMP",
  "OPAMP",
  "OPAMP5",
  "DIFFAMP",
  "MATH_CONST",
  "MATH_SUM",
  "MATH_PROD",
  "MATH_GAIN",
  "MATH_REL",
  "MATH_LOGIC",
  "AND",
  "OR",
  "NAND",
  "NOR",
  "XOR",
  "XNOR",
  "NOT",
  "SRFF",
  "JKFF",
  "TFF",
  "DFF",
  "SPST",
  "SPDT",
  "PB",
  "CSENSE",
  "VSENSE",
  "IPROBE",
  "VPROBE",
  "NODE",
  "WIRELABEL",
]);

/**
 * Path-space size of each glyph (viewBox). SVGs are drawn in these units and
 * stretched to the grid-aligned layout box below.
 */
export const NATIVE_SIZE: Partial<Record<ComponentKind, SymbolLayout>> = {
  R: { w: 48, h: 24 },
  RBOX: { w: 48, h: 24 },
  RVAR: { w: 48, h: 28 },
  RVARBOX: { w: 48, h: 28 },
  POT: { w: 48, h: 32 },
  POTBOX: { w: 48, h: 32 },
  THERM: { w: 48, h: 28 },
  LDR: { w: 48, h: 32 },
  C: { w: 48, h: 24 },
  CPOL: { w: 48, h: 28 },
  CFIXED: { w: 48, h: 24 },
  CVAR: { w: 48, h: 28 },
  L: { w: 48, h: 24 },
  LVAR: { w: 48, h: 32 },
  XFMR: { w: 56, h: 48 },
  CMMC: { w: 56, h: 48 },
  FBEAD: { w: 48, h: 24 },
  ANT: { w: 36, h: 40 },
  XTAL: { w: 48, h: 24 },
  D: { w: 48, h: 24 },
  DZ: { w: 48, h: 24 },
  DS: { w: 48, h: 24 },
  LED: { w: 48, h: 28 },
  DTVS: { w: 48, h: 24 },
  DTVSBI: { w: 48, h: 24 },
  V: { w: 40, h: 64 },
  BATTERY: { w: 40, h: 64 },
  VAC: { w: 40, h: 64 },
  I: { w: 40, h: 64 },
  IAC: { w: 40, h: 64 },
  VPULSE: { w: 40, h: 64 },
  GND: { w: 36, h: 28 },
  GND_SIG: { w: 36, h: 28 },
  GND_CH: { w: 36, h: 28 },
  SPST: { w: 48, h: 24 },
  SPDT: { w: 48, h: 32 },
  PB: { w: 48, h: 32 },
  AND: { w: 56, h: 40 },
  OR: { w: 56, h: 40 },
  NAND: { w: 56, h: 40 },
  NOR: { w: 56, h: 40 },
  XOR: { w: 56, h: 40 },
  XNOR: { w: 56, h: 40 },
  NOT: { w: 56, h: 40 },
  SRFF: { w: 64, h: 48 },
  JKFF: { w: 64, h: 48 },
  TFF: { w: 64, h: 48 },
  DFF: { w: 64, h: 48 },
  NMOS: { w: 96, h: 128 },
  PMOS: { w: 96, h: 128 },
  NMOS_D: { w: 96, h: 128 },
  PMOS_D: { w: 96, h: 128 },
  NJFET: { w: 96, h: 128 },
  PJFET: { w: 96, h: 128 },
  NPN: { w: 96, h: 128 },
  PNP: { w: 96, h: 128 },
  UJT: { w: 96, h: 128 },
  SICMOS: { w: 96, h: 128 },
  SICMOS_K: { w: 96, h: 128 },
  GANHEMT: { w: 96, h: 128 },
  IGBT: { w: 96, h: 128 },
  IGBT_K: { w: 96, h: 128 },
  SCR: { w: 64, h: 96 },
  SCS: { w: 64, h: 96 },
  TRIAC: { w: 64, h: 96 },
  DIAC: { w: 48, h: 24 },
  GTO: { w: 64, h: 96 },
  SCR_PH: { w: 64, h: 96 },
  SIDAC: { w: 48, h: 28 },
  GATEDRV: { w: 56, h: 48 },
  COMP: { w: 56, h: 40 },
  EAMP: { w: 56, h: 40 },
  OPAMP: { w: 56, h: 40 },
  OPAMP5: { w: 56, h: 56 },
  DIFFAMP: { w: 56, h: 40 },
  MATH_CONST: { w: 48, h: 40 },
  MATH_SUM: { w: 48, h: 48 },
  MATH_PROD: { w: 40, h: 64 },
  MATH_GAIN: { w: 48, h: 40 },
  MATH_REL: { w: 56, h: 40 },
  MATH_LOGIC: { w: 56, h: 40 },
  CSENSE: { w: 48, h: 24 },
  VSENSE: { w: 48, h: 28 },
  IPROBE: { w: 40, h: 40 },
  VPROBE: { w: 28, h: 40 },
  NODE: { w: 36, h: 24 },
  /** Tiny join box — name text is drawn as a label, not path ink. */
  WIRELABEL: { w: 16, h: 16 },
};

/**
 * Flow-space node box. Width/height are multiples of the wire grid so that:
 * - top-left snap keeps top/left pins on-grid
 * - center pins (offset 0.5) land on-grid when the box side is a multiple of 2×grid
 *
 * Old 1.5× scale (e.g. V = 60×120) put pins at +30 / +120 — off-grid — which
 * caused micro-bends and made V2 impossible to align with V1 on a shared rail.
 */
const LAYOUT: Partial<Record<ComponentKind, SymbolLayout>> = {
  R: { w: 64, h: 32 },
  RBOX: { w: 64, h: 32 },
  RVAR: { w: 64, h: 32 },
  RVARBOX: { w: 64, h: 32 },
  // Extra height so the top wiper pin sits on-grid above the body.
  POT: { w: 64, h: 48 },
  POTBOX: { w: 64, h: 48 },
  THERM: { w: 64, h: 32 },
  LDR: { w: 64, h: 48 },
  C: { w: 64, h: 32 },
  CPOL: { w: 64, h: 32 },
  CFIXED: { w: 64, h: 32 },
  CVAR: { w: 64, h: 32 },
  L: { w: 64, h: 32 },
  LVAR: { w: 64, h: 48 },
  XFMR: { w: 80, h: 64 },
  CMMC: { w: 80, h: 64 },
  FBEAD: { w: 64, h: 32 },
  ANT: { w: 32, h: 48 },
  XTAL: { w: 64, h: 32 },
  D: { w: 64, h: 32 },
  DZ: { w: 64, h: 32 },
  DS: { w: 64, h: 32 },
  LED: { w: 64, h: 32 },
  DTVS: { w: 64, h: 32 },
  DTVSBI: { w: 64, h: 32 },
  V: { w: 64, h: 96 },
  BATTERY: { w: 64, h: 96 },
  VAC: { w: 64, h: 96 },
  I: { w: 64, h: 96 },
  IAC: { w: 64, h: 96 },
  VPULSE: { w: 64, h: 96 },
  GND: { w: 32, h: 32 },
  GND_SIG: { w: 32, h: 32 },
  GND_CH: { w: 32, h: 32 },
  SPST: { w: 64, h: 32 },
  SPDT: { w: 64, h: 48 },
  PB: { w: 64, h: 48 },
  AND: { w: 64, h: 64 },
  OR: { w: 64, h: 64 },
  NAND: { w: 64, h: 64 },
  NOR: { w: 64, h: 64 },
  XOR: { w: 64, h: 64 },
  XNOR: { w: 64, h: 64 },
  NOT: { w: 64, h: 64 },
  SRFF: { w: 80, h: 64 },
  JKFF: { w: 80, h: 64 },
  TFF: { w: 80, h: 64 },
  DFF: { w: 80, h: 64 },
  NMOS: { w: 96, h: 128 },
  PMOS: { w: 96, h: 128 },
  NMOS_D: { w: 96, h: 128 },
  PMOS_D: { w: 96, h: 128 },
  NJFET: { w: 96, h: 128 },
  PJFET: { w: 96, h: 128 },
  NPN: { w: 96, h: 128 },
  PNP: { w: 96, h: 128 },
  UJT: { w: 96, h: 128 },
  SICMOS: { w: 96, h: 128 },
  SICMOS_K: { w: 96, h: 128 },
  GANHEMT: { w: 96, h: 128 },
  IGBT: { w: 96, h: 128 },
  IGBT_K: { w: 96, h: 128 },
  // Gate at left offset 2/3 → y=64 on a 96-tall box (on-grid).
  SCR: { w: 64, h: 96 },
  SCS: { w: 64, h: 96 },
  TRIAC: { w: 64, h: 96 },
  DIAC: { w: 64, h: 32 },
  GTO: { w: 64, h: 96 },
  SCR_PH: { w: 64, h: 96 },
  SIDAC: { w: 64, h: 32 },
  GATEDRV: { w: 80, h: 64 },
  COMP: { w: 64, h: 64 },
  // 0.25 / 0.75 offsets → on-grid at h=64.
  EAMP: { w: 64, h: 64 },
  OPAMP: { w: 64, h: 64 },
  // Tall box so V+/V− stubs clear the triangle; left pins at 32/64 (see specs).
  OPAMP5: { w: 64, h: 96 },
  DIFFAMP: { w: 64, h: 64 },
  MATH_CONST: { w: 64, h: 48 },
  MATH_SUM: { w: 64, h: 64 },
  MATH_PROD: { w: 48, h: 80 },
  MATH_GAIN: { w: 64, h: 48 },
  MATH_REL: { w: 64, h: 64 },
  MATH_LOGIC: { w: 64, h: 64 },
  CSENSE: { w: 64, h: 32 },
  VSENSE: { w: 64, h: 32 },
  IPROBE: { w: 48, h: 48 },
  VPROBE: { w: 32, h: 48 },
  NODE: { w: 48, h: 32 },
  /**
   * Tiny join hit-box only — net text overflows above/ beside it.
   * A large box (was 64×48) kept labels from sitting next to parts.
   */
  WIRELABEL: { w: 16, h: 16 },
};

export type SymbolLayout = { w: number; h: number };

/** @deprecated Prefer layout sizes; kept for any callers still scaling paths. */
export const SYMBOL_SCALE = 1.5;

export function hasSymbol(kind: ComponentKind): boolean {
  return SYMBOL_KINDS.has(kind);
}

/**
 * Intrinsic SVG size, swapped at 90°/270° so pins sit on the leads after rotate
 * instead of on the circle/body.
 */
export function getSymbolLayout(
  kind: ComponentKind,
  rotation: unknown = 0,
): SymbolLayout | null {
  const base = LAYOUT[kind];
  if (!base) return null;
  // Net name: fixed box; text spins around the join — don't swap w/h.
  if (kind === "WIRELABEL") return base;
  const r = normalizeRotation(rotation);
  if (r === 90 || r === 270) return { w: base.h, h: base.w };
  return base;
}

/**
 * Right edge of visible ink as a fraction of layout width (0–1).
 * Labels anchor here instead of the grid box edge so text hugs the glyph.
 */
const INK_RIGHT: Partial<Record<ComponentKind, number>> = {
  V: 0.9,
  I: 0.9,
  GND: 0.78,
  GND_SIG: 0.78,
  GND_CH: 0.78,
  BATTERY: 0.9,
  VAC: 0.9,
  IAC: 0.9,
  VPULSE: 0.88,
  NMOS: 0.8,
  PMOS: 0.84,
  NMOS_D: 0.8,
  PMOS_D: 0.84,
  NJFET: 0.76,
  PJFET: 0.8,
  NPN: 0.76,
  PNP: 0.8,
  UJT: 0.76,
  XFMR: 0.9,
  SICMOS: 0.76,
  SICMOS_K: 0.76,
  GANHEMT: 0.76,
  IGBT: 0.72,
  IGBT_K: 0.72,
  SCR: 1,
  SCS: 1,
  TRIAC: 1,
  GTO: 1,
  SCR_PH: 1,
  DIAC: 0.9,
  SIDAC: 0.9,
  DIFFAMP: 0.88,
  GATEDRV: 0.92,
  OPAMP5: 0.88,
  /** Flag fills most of the box — push text past the glyph. */
  NODE: 1.02,
  WIRELABEL: 0.5,
  IPROBE: 0.85,
  VPROBE: 0.85,
};

export function getLabelInkAnchorX(kind: ComponentKind): number {
  return INK_RIGHT[kind] ?? 0.82;
}

/** Assert layout keeps center-style pins on the wire grid (dev / tests). */
export function layoutPinsOnGrid(kind: ComponentKind): boolean {
  const box = LAYOUT[kind];
  if (!box) return false;
  const g = WIRE_GRID;
  // Center of width / height must be an integer number of grid steps.
  return box.w % (2 * g) === 0 && box.h % g === 0;
}
