import { useMemo, useState } from "react";
import { buildPalette, COMPONENT_SPECS } from "../model/componentSpecs";
import type { ComponentKind } from "../model/types";
import { PALETTE_DND_MIME } from "../dnd";
import { hasSymbol } from "../nodes/symbols/layout";
import { SchematicSymbol } from "../nodes/symbols/SchematicSymbols";

/** Single-line label for titles/tooltips (palette may use \\n for wrapping). */
function flatLabel(label: string): string {
  return label.replace(/\n/g, " ");
}

function kindMatchesQuery(kind: ComponentKind, q: string): boolean {
  const spec = COMPONENT_SPECS[kind];
  if (!spec) return false;
  const hay = [
    kind,
    spec.label,
    flatLabel(spec.label),
    spec.category,
    spec.refdesPrefix,
    spec.glyph,
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function PaletteItem({
  kind,
  active,
  onPick,
}: {
  kind: ComponentKind;
  active: boolean;
  onPick: (kind: ComponentKind) => void;
}) {
  const spec = COMPONENT_SPECS[kind];
  const showSvg = hasSymbol(kind);
  const tip = flatLabel(spec.label);
  return (
    <button
      type="button"
      className={`palette-item${active ? " is-active" : ""}`}
      title={
        active
          ? `${tip} — left-click canvas to place, right-click to cancel`
          : `${tip} — click to place (stamp), or drag onto canvas / a part`
      }
      aria-pressed={active}
      draggable
      onClick={() => onPick(kind)}
      onDragStart={(e) => {
        e.dataTransfer.setData(PALETTE_DND_MIME, kind);
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      {showSvg ? (
        <span className="palette-glyph palette-glyph-svg">
          <SchematicSymbol kind={kind} preview />
        </span>
      ) : (
        <span className="palette-glyph">{spec.glyph}</span>
      )}
      <span className="palette-label">{spec.label}</span>
    </button>
  );
}

// Component palette — click enters LTspice-style stamp tool (no auto-drop).
// Drag-and-drop onto the canvas / a part still works for one-shot place/replace.
export function Palette({
  activeKind,
  pasting = false,
  copying = false,
  commonlyUsed = [],
  onPick,
}: {
  activeKind: ComponentKind | null;
  pasting?: boolean;
  /** Ctrl+C copy-marquee active — drag a box (≥70% coverage). */
  copying?: boolean;
  /** Session “Commonly used” kinds (most recent first). */
  commonlyUsed?: readonly ComponentKind[];
  onPick: (kind: ComponentKind) => void;
}) {
  const [query, setQuery] = useState("");
  /** Sections open in the browse list. Commonly used starts expanded; others collapsed. */
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(["Commonly used"]),
  );
  const groups = useMemo(() => buildPalette(commonlyUsed), [commonlyUsed]);
  const q = query.trim().toLowerCase();

  const catalog = useMemo(() => {
    const kinds: ComponentKind[] = [];
    const seen = new Set<ComponentKind>();
    for (const g of buildPalette([])) {
      if (g.category === "Commonly used") continue;
      for (const k of g.kinds) {
        if (seen.has(k)) continue;
        seen.add(k);
        kinds.push(k);
      }
    }
    return kinds;
  }, []);

  const searchResults = useMemo(() => {
    if (!q) return null;
    return catalog
      .filter((kind) => kindMatchesQuery(kind, q))
      .sort((a, b) =>
        flatLabel(COMPONENT_SPECS[a].label).localeCompare(flatLabel(COMPONENT_SPECS[b].label)),
      );
  }, [q, catalog]);

  const toggleSection = (category: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  return (
    <div className="palette">
      <div className="palette-search">
        <input
          type="search"
          className="palette-search-input"
          value={query}
          placeholder="Search symbols…"
          aria-label="Search all symbols"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="palette-search-clear"
            title="Clear search"
            aria-label="Clear search"
            onClick={() => setQuery("")}
          >
            ×
          </button>
        )}
      </div>

      {searchResults ? (
        <div className="palette-group">
          <div className="palette-title">
            {searchResults.length
              ? `Results (${searchResults.length})`
              : "No matches"}
          </div>
          {searchResults.length === 0 ? (
            <p className="palette-empty-hint">Try another name, category, or refdes prefix</p>
          ) : (
            <div className="palette-grid">
              {searchResults.map((kind) => (
                <PaletteItem
                  key={kind}
                  kind={kind}
                  active={activeKind === kind}
                  onPick={onPick}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        groups.map((group) => {
          const open = openSections.has(group.category);
          return (
            <div
              className={`palette-group${open ? " is-open" : " is-collapsed"}`}
              key={group.category}
            >
              <button
                type="button"
                className="palette-title palette-title-toggle"
                aria-expanded={open}
                onClick={() => toggleSection(group.category)}
              >
                <span className="palette-title-chevron" aria-hidden>
                  {open ? "▾" : "▸"}
                </span>
                <span className="palette-title-text">{group.category}</span>
                <span className="palette-title-count">{group.kinds.length}</span>
              </button>
              {open &&
                (group.category === "Commonly used" && group.kinds.length === 0 ? (
                  <p className="palette-empty-hint">
                    Basics stay here; other parts you place this session appear after them
                  </p>
                ) : (
                  <div className="palette-grid">
                    {group.kinds.map((kind) => (
                      <PaletteItem
                        key={kind}
                        kind={kind}
                        active={activeKind === kind}
                        onPick={onPick}
                      />
                    ))}
                  </div>
                ))}
            </div>
          );
        })
      )}
      {activeKind ? (
        <p className="palette-tool-hint">
          Placing {flatLabel(COMPONENT_SPECS[activeKind].label)}: left-click to stamp ·
          <kbd>R</kbd> rotate · right-click / Esc to cancel
        </p>
      ) : pasting ? (
        <p className="palette-tool-hint">
          Paste: left-click to stamp copies · <kbd>R</kbd> rotate · right-click / Esc to cancel
        </p>
      ) : copying ? (
        <p className="palette-tool-hint">
          Copy: click a part/wire or drag a box (≥70% coverage) · paste ghost appears · Esc to cancel
        </p>
      ) : null}
    </div>
  );
}
