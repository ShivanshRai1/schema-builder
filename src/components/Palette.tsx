import { COMPONENT_SPECS, PALETTE } from "../model/componentSpecs";
import type { ComponentKind } from "../model/types";

// Palette of components grouped by category. Clicking adds one to the canvas.
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
                <button key={kind} className="palette-item" onClick={() => onAdd(kind)} title={spec.label}>
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
