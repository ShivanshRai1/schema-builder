import type { ComponentKind } from "../../model/types";
import { normalizeRotation } from "../../model/rotation";
import { WIRE_GRID } from "../../wiring/orthogonal";

/** Parts rendered as schematic SVG symbols instead of HTML cards. */
export const SYMBOL_KINDS = new Set<ComponentKind>([
  "R",
  "C",
  "L",
  "V",
  "GND",
  "D",
  "I",
  "NMOS",
  "PMOS",
  "NPN",
  "PNP",
  "EAMP",
]);

/**
 * Path-space size of each glyph (viewBox). SVGs are drawn in these units and
 * stretched to the grid-aligned layout box below.
 */
export const NATIVE_SIZE: Partial<Record<ComponentKind, SymbolLayout>> = {
  R: { w: 48, h: 24 },
  C: { w: 48, h: 24 },
  L: { w: 48, h: 24 },
  D: { w: 48, h: 24 },
  V: { w: 40, h: 80 },
  I: { w: 40, h: 80 },
  GND: { w: 36, h: 28 },
  NMOS: { w: 40, h: 56 },
  PMOS: { w: 40, h: 56 },
  NPN: { w: 40, h: 56 },
  PNP: { w: 40, h: 56 },
  EAMP: { w: 56, h: 40 },
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
  C: { w: 64, h: 32 },
  L: { w: 64, h: 32 },
  D: { w: 64, h: 32 },
  V: { w: 64, h: 112 },
  I: { w: 64, h: 112 },
  GND: { w: 32, h: 32 },
  NMOS: { w: 64, h: 96 },
  PMOS: { w: 64, h: 96 },
  NPN: { w: 64, h: 96 },
  PNP: { w: 64, h: 96 },
  // 0.25 / 0.75 offsets → on-grid at h=64; catalog still uses 0.3/0.7 so
  // inp/inn stay ~1–2px off — acceptable vs breaking existing EAMP nets.
  EAMP: { w: 64, h: 64 },
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

/** Assert layout keeps center-style pins on the wire grid (dev / tests). */
export function layoutPinsOnGrid(kind: ComponentKind): boolean {
  const box = LAYOUT[kind];
  if (!box) return false;
  const g = WIRE_GRID;
  // Center of width / height must be an integer number of grid steps.
  return box.w % (2 * g) === 0 && box.h % g === 0;
}
