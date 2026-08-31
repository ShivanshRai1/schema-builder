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
  "C",
  "CPOL",
  "CFIXED",
  "CVAR",
  "L",
  "LVAR",
  "V",
  "GND",
  "D",
  "DZ",
  "I",
  "NMOS",
  "PMOS",
  "NMOS_D",
  "PMOS_D",
  "NJFET",
  "PJFET",
  "NPN",
  "PNP",
  "SICMOS",
  "SICMOS_K",
  "GANHEMT",
  "IGBT",
  "IGBT_K",
  "SCR",
  "GATEDRV",
  "COMP",
  "EAMP",
  "OPAMP",
  "OPAMP5",
  "CSENSE",
  "VSENSE",
  "IPROBE",
  "VPROBE",
  "NODE",
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
  C: { w: 48, h: 24 },
  CPOL: { w: 48, h: 28 },
  CFIXED: { w: 48, h: 24 },
  CVAR: { w: 48, h: 28 },
  L: { w: 48, h: 24 },
  LVAR: { w: 48, h: 32 },
  D: { w: 48, h: 24 },
  DZ: { w: 48, h: 24 },
  V: { w: 40, h: 80 },
  I: { w: 40, h: 80 },
  GND: { w: 36, h: 28 },
  NMOS: { w: 96, h: 128 },
  PMOS: { w: 96, h: 128 },
  NMOS_D: { w: 96, h: 128 },
  PMOS_D: { w: 96, h: 128 },
  NJFET: { w: 96, h: 128 },
  PJFET: { w: 96, h: 128 },
  NPN: { w: 96, h: 128 },
  PNP: { w: 96, h: 128 },
  SICMOS: { w: 96, h: 128 },
  SICMOS_K: { w: 96, h: 128 },
  GANHEMT: { w: 96, h: 128 },
  IGBT: { w: 96, h: 128 },
  IGBT_K: { w: 96, h: 128 },
  SCR: { w: 96, h: 64 },
  GATEDRV: { w: 56, h: 48 },
  COMP: { w: 56, h: 40 },
  EAMP: { w: 56, h: 40 },
  OPAMP: { w: 56, h: 40 },
  OPAMP5: { w: 56, h: 56 },
  CSENSE: { w: 48, h: 24 },
  VSENSE: { w: 48, h: 28 },
  IPROBE: { w: 40, h: 40 },
  VPROBE: { w: 28, h: 40 },
  NODE: { w: 36, h: 24 },
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
  C: { w: 64, h: 32 },
  CPOL: { w: 64, h: 32 },
  CFIXED: { w: 64, h: 32 },
  CVAR: { w: 64, h: 32 },
  L: { w: 64, h: 32 },
  LVAR: { w: 64, h: 48 },
  D: { w: 64, h: 32 },
  DZ: { w: 64, h: 32 },
  V: { w: 64, h: 112 },
  I: { w: 64, h: 112 },
  GND: { w: 32, h: 32 },
  NMOS: { w: 96, h: 128 },
  PMOS: { w: 96, h: 128 },
  NMOS_D: { w: 96, h: 128 },
  PMOS_D: { w: 96, h: 128 },
  NJFET: { w: 96, h: 128 },
  PJFET: { w: 96, h: 128 },
  NPN: { w: 96, h: 128 },
  PNP: { w: 96, h: 128 },
  SICMOS: { w: 96, h: 128 },
  SICMOS_K: { w: 96, h: 128 },
  GANHEMT: { w: 96, h: 128 },
  IGBT: { w: 96, h: 128 },
  IGBT_K: { w: 96, h: 128 },
  // Gate at bottom offset 2/3 → x=64 on a 96-wide box (on-grid).
  SCR: { w: 96, h: 64 },
  GATEDRV: { w: 80, h: 64 },
  COMP: { w: 64, h: 64 },
  // 0.25 / 0.75 offsets → on-grid at h=64.
  EAMP: { w: 64, h: 64 },
  OPAMP: { w: 64, h: 64 },
  // Tall box so V+/V− stubs clear the triangle; left pins at 32/64 (see specs).
  OPAMP5: { w: 64, h: 96 },
  CSENSE: { w: 64, h: 32 },
  VSENSE: { w: 64, h: 32 },
  IPROBE: { w: 48, h: 48 },
  VPROBE: { w: 32, h: 48 },
  NODE: { w: 48, h: 32 },
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
  NMOS: 0.76,
  PMOS: 0.8,
  NMOS_D: 0.76,
  PMOS_D: 0.8,
  NJFET: 0.76,
  PJFET: 0.8,
  NPN: 0.76,
  PNP: 0.8,
  SICMOS: 0.76,
  SICMOS_K: 0.76,
  GANHEMT: 0.76,
  IGBT: 0.72,
  IGBT_K: 0.72,
  SCR: 1,
  GATEDRV: 0.92,
  OPAMP5: 0.88,
  /** Flag fills most of the box — push text past the glyph. */
  NODE: 1.02,
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
