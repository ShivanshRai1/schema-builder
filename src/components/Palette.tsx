import { COMPONENT_SPECS, PALETTE } from "../model/componentSpecs";
import type { ComponentKind } from "../model/types";
import { PALETTE_DND_MIME } from "../dnd";

// Palette of components grouped by category.
// Click → add. Drag onto canvas → add at drop point. Drag onto a part → replace it.
export function Palette({ onAdd }: { onAdd: (kind: ComponentKind) => void }) {
  return (
    <div className="palette">
      {PALETTE.map((group) => (
        <div className="palette-group" key={group.category}>
          <div className="palette-title">{group.category}</div>
          <div className="palette-grid">
            {group.kinds.map((kind) => {
              const spec = COMPONENT_SPECS[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  className="palette-item"
                  title={`${spec.label} — click to add, or drag onto canvas / a part`}
                  draggable
                  onClick={() => onAdd(kind)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(PALETTE_DND_MIME, kind);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  <span className="palette-glyph">{spec.glyph}</span>
                  <span className="palette-label">{spec.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
