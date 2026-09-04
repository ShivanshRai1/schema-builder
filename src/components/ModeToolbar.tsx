import type { CanvasMode } from "./Canvas";

const MODES: {
  id: CanvasMode;
  label: string;
  glyph: string;
  title: string;
  shortcut: string;
}[] = [
  {
    id: "explore",
    label: "Explore",
    glyph: "✋",
    title: "Explore (E) — pan, zoom, and select parts or wires (no dragging)",
    shortcut: "E",
  },
  {
    id: "wire",
    label: "Wire",
    glyph: "—",
    title: "Wire (W) — draw a new wire: click the grid or a pin",
    shortcut: "W",
  },
  {
    id: "move",
    label: "Move",
    glyph: "✥",
    title: "Move (M) — relocate parts with wires still connected",
    shortcut: "M",
  },
  {
    id: "drag",
    label: "Drag",
    glyph: "⇄",
    title: "Drag (D) — disconnect a part or one wire section, then move it alone",
    shortcut: "D",
  },
  {
    id: "delete",
    label: "Delete",
    glyph: "✂",
    title: "Delete (Del) — click parts or wires; with a selection, Delete removes it",
    shortcut: "Del",
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
            <kbd className="mode-toolbar-key">{m.shortcut}</kbd>
          </button>
        );
      })}
    </div>
  );
}
