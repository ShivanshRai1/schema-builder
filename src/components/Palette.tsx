import { COMPONENT_SPECS, PALETTE } from "../model/componentSpecs";
import type { ComponentKind } from "../model/types";
import { PALETTE_DND_MIME } from "../dnd";
import { hasSymbol } from "../nodes/symbols/layout";
import { SchematicSymbol } from "../nodes/symbols/SchematicSymbols";

/** Single-line label for titles/tooltips (palette may use \\n for wrapping). */
function flatLabel(label: string): string {
  return label.replace(/\n/g, " ");
}

// Component palette — click enters LTspice-style stamp tool (no auto-drop).
// Drag-and-drop onto the canvas / a part still works for one-shot place/replace.
export function Palette({
  activeKind,
  onPick,
}: {
  activeKind: ComponentKind | null;
  onPick: (kind: ComponentKind) => void;
}) {
  return (
    <div className="palette">
      {PALETTE.map((group) => (
        <div className="palette-group" key={group.category}>
          <div className="palette-title">{group.category}</div>
          <div className="palette-grid">
            {group.kinds.map((kind) => {
              const spec = COMPONENT_SPECS[kind];
              const showSvg = hasSymbol(kind);
              const active = activeKind === kind;
              const tip = flatLabel(spec.label);
              return (
                <button
                  key={kind}
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
            })}
          </div>
        </div>
      ))}
      {activeKind ? (
        <p className="palette-tool-hint">
          Placing {flatLabel(COMPONENT_SPECS[activeKind].label)}: left-click to stamp ·
          right-click / Esc to cancel
        </p>
      ) : null}
    </div>
  );
}
