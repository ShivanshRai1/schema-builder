import { foldSpiceContinuations } from "./parseDeviceParams";

/**
 * Netlist body sections the user can rearrange in “edit as text”.
 * `.end` is always last and is not part of this list.
 */
export type NetlistSectionId = "devices" | "directives" | "library";

export const DEFAULT_NETLIST_SECTION_ORDER: readonly NetlistSectionId[] = [
  "devices",
  "directives",
  "library",
] as const;

const ALL = new Set<NetlistSectionId>(DEFAULT_NETLIST_SECTION_ORDER);

/** Drop anything after the first `.end` so mid-deck `.end` cannot create ghost errors. */
export function trimNetlistAfterEnd(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const raw of lines) {
    out.push(raw);
    if (/^\s*\.end\b/i.test(raw)) break;
  }
  return out.join("\n");
}

export function normalizeNetlistSectionOrder(
  order: readonly NetlistSectionId[] | null | undefined,
): NetlistSectionId[] {
  const seen = new Set<NetlistSectionId>();
  const out: NetlistSectionId[] = [];
  for (const id of order ?? []) {
    if (!ALL.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of DEFAULT_NETLIST_SECTION_ORDER) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

/**
 * Infer the user’s preferred section order from a full deck (any arrangement).
 * Missing sections are appended in the default relative order.
 */
export function detectNetlistSectionOrder(text: string): NetlistSectionId[] {
  const folded = foldSpiceContinuations(trimNetlistAfterEnd(text));
  const firstAt = new Map<NetlistSectionId, number>();
  let inSubckt = false;

  const mark = (id: NetlistSectionId, i: number) => {
    if (!firstAt.has(id)) firstAt.set(id, i);
  };

  const lines = folded.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (!t) continue;
    if (/^\.end\b/i.test(t)) break;

    if (/^\*\s*---\s*directives/i.test(t)) {
      mark("directives", i);
      continue;
    }
    if (/^\*\s*---\s*(\.subckt library|built-in models)/i.test(t)) {
      mark("library", i);
      continue;
    }

    if (t.startsWith("*")) {
      if (/^\*\s*\.wc\b/i.test(t)) mark("directives", i);
      continue;
    }

    if (/^\.subckt\b/i.test(t)) {
      mark("library", i);
      inSubckt = true;
      continue;
    }
    if (/^\.ends\b/i.test(t)) {
      inSubckt = false;
      continue;
    }
    if (inSubckt) continue;

    if (/^\.model\b/i.test(t)) {
      mark("library", i);
      continue;
    }

    if (t.startsWith(".")) {
      if (/^\.save\b/i.test(t)) {
        mark("devices", i);
      } else if (!/^\.(include|inc|lib)\b/i.test(t)) {
        mark("directives", i);
      }
      continue;
    }

    // Device instance line
    mark("devices", i);
  }

  const found = [...firstAt.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);

  return normalizeNetlistSectionOrder(found);
}
