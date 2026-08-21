import { COMPONENT_SPECS, PALETTE } from "../model/componentSpecs";
import type { ComponentKind } from "../model/types";
import { PALETTE_DND_MIME } from "../dnd";
import type { CanvasMode } from "./Canvas";

// Palette of tools + components.
// Wire/Move are modes. Parts: click → add, drag onto canvas / a part → place or replace.
export function Palette({
  onAdd,
  mode,
  onModeChange,
}: {
  onAdd: (kind: ComponentKind) => void;
  mode: CanvasMode;
  onModeChange: (mode: CanvasMode) => void;
}) {
  return (
    <div className="palette">
      <div className="palette-group">
        <div className="palette-title">Draw</div>
        <div className="palette-grid">
          <button
            type="button"
            className={`palette-item palette-tool${mode === "explore" ? " is-active" : ""}`}
            title="Explore — pan, zoom, and inspect parts without editing"
            onClick={() => onModeChange("explore")}
          >
            <span className="palette-glyph">✋</span>
            <span className="palette-label">Explore</span>
          </button>
          <button
            type="button"
            className={`palette-item palette-tool${mode === "wire" ? " is-active" : ""}`}
            title="Draw a new wire from scratch — click this, then click the grid or a pin"
            onClick={() => onModeChange("wire")}
          >
            <span className="palette-glyph">—</span>
            <span className="palette-label">Wire</span>
          </button>
          <button
            type="button"
            className={`palette-item palette-tool${mode === "move" ? " is-active" : ""}`}
            title="Move parts and wires"
            onClick={() => onModeChange("move")}
          >
            <span className="palette-glyph">✥</span>
            <span className="palette-label">Move</span>
          </button>
        </div>
        {mode === "wire" && (
          <div className="palette-tool-hint">Click the grid to start a new wire</div>
        )}
      </div>
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
