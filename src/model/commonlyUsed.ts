import type { ComponentKind } from "./types";
import { COMPONENT_SPECS, isPaletteHidden } from "./componentSpecs";

const STORAGE_KEY = "simulai-commonly-used";
const MAX = 24;

/**
 * Always shown first in “Commonly used” (R, C, L, D, sources, ground).
 * Session placements append after these, without duplicating them.
 */
export const COMMONLY_USED_PINNED: readonly ComponentKind[] = [
  "R",
  "C",
  "L",
  "D",
  "V",
  "VAC",
  "VPULSE",
  "GND",
];

function isRecordable(kind: ComponentKind): boolean {
  if (kind === "TIP" || kind === "WIRELABEL") return false;
  if (isPaletteHidden(kind)) return false;
  return Boolean(COMPONENT_SPECS[kind]);
}

/** Kinds placed this browser session (most recent first). */
export function readCommonlyUsed(): ComponentKind[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (k): k is ComponentKind => typeof k === "string" && isRecordable(k as ComponentKind),
    );
  } catch {
    return [];
  }
}

/**
 * Palette order: pinned basics first, then session history (excluding pinned duplicates).
 */
export function mergeCommonlyUsed(session: readonly ComponentKind[]): ComponentKind[] {
  const pinned = COMMONLY_USED_PINNED.filter(isRecordable);
  const pinnedSet = new Set(pinned);
  const rest = session.filter((k) => isRecordable(k) && !pinnedSet.has(k));
  const dynamicSlots = Math.max(0, MAX - pinned.length);
  return [...pinned, ...rest.slice(0, dynamicSlots)];
}

/** Record placed part(s); returns the updated most-recent-first list. */
export function recordCommonlyUsed(...kinds: ComponentKind[]): ComponentKind[] {
  let next = readCommonlyUsed();
  let changed = false;
  for (const kind of kinds) {
    if (!isRecordable(kind)) continue;
    next = [kind, ...next.filter((k) => k !== kind)].slice(0, MAX);
    changed = true;
  }
  if (!changed) return next;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}
