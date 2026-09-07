import type { ComponentKind } from "./types";
import { COMPONENT_SPECS, isPaletteHidden } from "./componentSpecs";

const STORAGE_KEY = "simulai-commonly-used";
const MAX = 24;

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
