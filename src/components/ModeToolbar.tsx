import type { CanvasMode } from "./Canvas";

const MODES: {
  id: CanvasMode;
  label: string;
  glyph: string;
  title: string;
}[] = [
  {
    id: "explore",
    label: "Explore",
    glyph: "✋",
    title: "Explore — pan, zoom, and select parts or wires (no dragging)",
  },
  {
    id: "wire",
    label: "Wire",
    glyph: "—",
    title: "Draw a new wire — click the grid or a pin",
  },
  {
    id: "move",
    label: "Move",
    glyph: "✥",
    title: "Move — select, box-select, drag parts and wires",
  },
  {
    id: "delete",
    label: "Delete",
    glyph: "✂",
    title: "Delete — click parts or wires; Delete key removes selection",
  },
];

/** Always-visible horizontal mode switcher above the schematic canvas. */
export function ModeToolbar({
  mode,
  onModeChange,
}: {
  mode: CanvasMode;
  onModeChange: (mode: CanvasMode) => void;
}) {
  return (
    <div className="mode-toolbar" role="toolbar" aria-label="Canvas tools">
      {MODES.map((m) => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            className={`mode-toolbar-btn mode-toolbar-${m.id}${active ? " is-active" : ""}`}
            title={m.title}
            aria-pressed={active}
            onClick={() => {
              if (m.id === "delete") {
                onModeChange(mode === "delete" ? "explore" : "delete");
              } else {
                onModeChange(m.id);
              }
            }}
          >
            <span className="mode-toolbar-glyph" aria-hidden>
              {m.glyph}
            </span>
            <span className="mode-toolbar-label">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
