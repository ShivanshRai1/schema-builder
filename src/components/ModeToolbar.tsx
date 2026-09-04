import { useState, type MutableRefObject } from "react";
import type { CanvasMode, CanvasViewApi } from "./Canvas";

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
    glyph: "⇄",
    title: "Move (M) — disconnect a part or one wire section, then move it alone",
    shortcut: "M",
  },
  {
    id: "drag",
    label: "Drag",
    glyph: "✥",
    title: "Drag (D) — relocate parts with wires still connected",
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

function ZoomInIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="10" cy="10" r="6.5" />
      <path d="M15 15l5.5 5.5" />
      <path d="M10 7.5v5M7.5 10h5" />
    </svg>
  );
}

function ZoomOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="10" cy="10" r="6.5" />
      <path d="M15 15l5.5 5.5" />
      <path d="M7.5 10h5" />
    </svg>
  );
}

function FitViewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 8V5a2 2 0 0 1 2-2h3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3" />
    </svg>
  );
}

function LockIcon({ locked }: { locked: boolean }) {
  if (locked) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 7.5-1.8" />
    </svg>
  );
}

/** Always-visible horizontal mode switcher above the schematic canvas. */
export function ModeToolbar({
  mode,
  onModeChange,
  viewApiRef,
}: {
  mode: CanvasMode;
  onModeChange: (mode: CanvasMode) => void;
  /** Zoom / fit / lock — same actions as the old bottom-left Controls. */
  viewApiRef: MutableRefObject<CanvasViewApi | null>;
}) {
  const [viewLocked, setViewLocked] = useState(false);
  // Explore stays a real mode (E / Esc) but has no toolbar button.
  const toolbarModes = MODES.filter((m) => m.id !== "explore");

  return (
    <div className="mode-toolbar" role="toolbar" aria-label="Canvas tools">
      {toolbarModes.map((m) => {
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

      <div className="mode-toolbar-sep" aria-hidden />

      <div className="mode-toolbar-view" role="group" aria-label="View controls">
        <button
          type="button"
          className="mode-toolbar-view-btn"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => viewApiRef.current?.zoomIn()}
        >
          <ZoomInIcon />
        </button>
        <button
          type="button"
          className="mode-toolbar-view-btn"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => viewApiRef.current?.zoomOut()}
        >
          <ZoomOutIcon />
        </button>
        <button
          type="button"
          className="mode-toolbar-view-btn"
          title="Fit view (Space)"
          aria-label="Fit view"
          onClick={() => viewApiRef.current?.fitView()}
        >
          <FitViewIcon />
        </button>
        <button
          type="button"
          className={`mode-toolbar-view-btn${viewLocked ? " is-active" : ""}`}
          title={viewLocked ? "Unlock pan & zoom" : "Lock pan & zoom"}
          aria-label={viewLocked ? "Unlock pan and zoom" : "Lock pan and zoom"}
          aria-pressed={viewLocked}
          onClick={() => {
            const next = viewApiRef.current?.toggleLock() ?? !viewLocked;
            setViewLocked(next);
          }}
        >
          <LockIcon locked={viewLocked} />
        </button>
      </div>
    </div>
  );
}
