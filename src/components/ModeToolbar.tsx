import { useState, type MutableRefObject, type ReactNode } from "react";
import type { CanvasMode, CanvasViewApi } from "./Canvas";
import type { SimControlApi, SimRunState } from "./SimPanel";
import { useSimResult } from "../sim/SimResultContext";
import { useProbeSelectionOptional } from "../sim/ProbeContext";

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
    glyph: "🗑",
    title: "Delete (Del) — click parts or wires; with a selection, Delete removes it",
    shortcut: "Del",
  },
];

function WireIcon() {
  // Orthogonal schematic wire (L-bend) — reads as wiring, not eyeglasses.
  return (
    <svg className="mode-toolbar-wire-icon" width="26" height="26" viewBox="0 0 24 24" aria-hidden>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2.15"
        strokeLinecap="square"
        strokeLinejoin="miter"
      >
        <path d="M4 17 H13 V7 H20" />
      </g>
      <circle cx="4" cy="17" r="1.55" fill="currentColor" />
      <circle cx="20" cy="7" r="1.55" fill="currentColor" />
    </svg>
  );
}

/** Trash can — Delete mode (not scissors; Cut keeps scissors). */
function DeleteTrashIcon() {
  return (
    <svg className="mode-toolbar-delete-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <path
        className="delete-lid"
        d="M8.2 7.2 H15.8 M9.5 7.2 V5.8 A1.2 1.2 0 0 1 10.7 4.6 H13.3 A1.2 1.2 0 0 1 14.5 5.8 V7.2"
        fill="none"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="delete-body"
        d="M7.4 7.2 H16.6 L15.7 19.2 A1.4 1.4 0 0 1 14.3 20.5 H9.7 A1.4 1.4 0 0 1 8.3 19.2 Z"
        fill="none"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        className="delete-lines"
        d="M10.2 10.2 V17.2 M12 10.2 V17.2 M13.8 10.2 V17.2"
        fill="none"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ZoomInIcon() {
  return (
    <svg className="mode-toolbar-zoom-icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <circle className="zoom-lens" cx="10" cy="10" r="6.75" />
      <circle className="zoom-ring" cx="10" cy="10" r="6.75" fill="none" strokeWidth="1.75" />
      <path className="zoom-handle" d="M15.2 15.2 L20.4 20.4" fill="none" strokeWidth="2.4" strokeLinecap="round" />
      <path className="zoom-mark" d="M10 7.2 V12.8 M7.2 10 H12.8" fill="none" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

function ZoomOutIcon() {
  return (
    <svg className="mode-toolbar-zoom-icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <circle className="zoom-lens" cx="10" cy="10" r="6.75" />
      <circle className="zoom-ring" cx="10" cy="10" r="6.75" fill="none" strokeWidth="1.75" />
      <path className="zoom-handle" d="M15.2 15.2 L20.4 20.4" fill="none" strokeWidth="2.4" strokeLinecap="round" />
      <path className="zoom-mark" d="M7.2 10 H12.8" fill="none" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

function FitViewIcon() {
  return (
    <svg className="mode-toolbar-fit-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden fill="none">
      <rect x="2.5" y="2.5" width="19" height="19" strokeWidth="1.25" />
      <path
        strokeWidth="2.25"
        strokeLinecap="square"
        strokeLinejoin="miter"
        d="M6 9.5 V6 H9.5 M14.5 6 H18 V9.5 M6 14.5 V18 H9.5 M14.5 18 H18 V14.5"
      />
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

function NetLabelIcon() {
  return (
    <svg className="mode-toolbar-netlabel-icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <rect className="netlabel-plate" x="4" y="3.5" width="16" height="13" rx="1.2" ry="1.2" />
      <text
        className="netlabel-letter"
        x="12"
        y="14"
        textAnchor="middle"
        fontSize="12"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        A
      </text>
      <path className="netlabel-stem" d="M12 16.5 V21" fill="none" strokeWidth="1.8" strokeLinecap="square" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg className="mode-toolbar-sim-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path className="sim-play" d="M8 5.5 L19 12 L8 18.5 Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg className="mode-toolbar-sim-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <rect className="sim-pause" x="7" y="5.5" width="3.5" height="13" rx="0.6" />
      <rect className="sim-pause" x="13.5" y="5.5" width="3.5" height="13" rx="0.6" />
    </svg>
  );
}

function StopIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg className="mode-toolbar-sim-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <rect
        className={enabled ? "sim-stop" : "sim-stop-disabled"}
        x="6.5"
        y="6.5"
        width="11"
        height="11"
        rx="1"
      />
    </svg>
  );
}

/** LTspice-style voltage probe needle (toolbar) — uses shipped red pin art. */
function ProbeNeedleIcon({ active }: { active: boolean }) {
  return (
    <img
      className={`mode-toolbar-probe-img${active ? " is-on" : ""}`}
      src="/icons/probe-red.png"
      alt=""
      width={14}
      height={28}
      draggable={false}
      aria-hidden
    />
  );
}

function CutIcon() {
  return (
    <svg className="mode-toolbar-edit-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      {/* Blades */}
      <path
        className="cut-blade"
        d="M11.2 12.2 L18.8 4.2"
        fill="none"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        className="cut-blade"
        d="M11.2 11.8 L18.8 19.8"
        fill="none"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      {/* Handles */}
      <circle className="cut-handle" cx="7.2" cy="8.2" r="3.1" fill="none" strokeWidth="2.1" />
      <circle className="cut-handle" cx="7.2" cy="15.8" r="3.1" fill="none" strokeWidth="2.1" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="mode-toolbar-edit-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <rect className="copy-back" x="7.5" y="4" width="11" height="14" rx="1.2" />
      <rect className="copy-front" x="4.5" y="7" width="11" height="14" rx="1.2" />
      <path className="copy-fold" d="M12.5 7 H15.5 L12.5 10 Z" />
      <path
        className="copy-lines"
        d="M7 12.2 H12.8 M7 14.6 H12.8 M7 17 H11.2"
        fill="none"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Always-visible horizontal mode switcher above the schematic canvas. */
export function ModeToolbar({
  mode,
  onModeChange,
  viewApiRef,
  onPlaceLabel,
  labelActive = false,
  simControlRef,
  simRunState = "idle",
  onCut,
  onCopy,
  copyActive = false,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  trailingActions,
}: {
  mode: CanvasMode;
  onModeChange: (mode: CanvasMode) => void;
  /** Zoom / fit / lock — same actions as the old bottom-left Controls. */
  viewApiRef: MutableRefObject<CanvasViewApi | null>;
  /** Open Label (net name) stamp flow — same as former palette Label / N. */
  onPlaceLabel?: () => void;
  /** True while a Label ghost is ready to stamp. */
  labelActive?: boolean;
  /** Simulation Play / Pause / Stop. */
  simControlRef?: MutableRefObject<SimControlApi | null>;
  simRunState?: SimRunState;
  onCut?: () => void;
  onCopy?: () => void;
  /** True while Ctrl+C copy-marquee / copy tool is active. */
  copyActive?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** File / models / theme controls — right of Run/Stop. */
  trailingActions?: ReactNode;
}) {
  const [viewLocked, setViewLocked] = useState(false);
  // Explore stays a real mode (E / Esc) but has no toolbar button.
  const toolbarModes = MODES.filter((m) => m.id !== "explore");
  const simRunning = simRunState === "running";
  const stopEnabled = simRunState === "running" || simRunState === "paused";
  const simResult = useSimResult();
  const probeSel = useProbeSelectionOptional();
  const probeAvailable = Boolean(simResult?.ok && simResult.series.length && probeSel);
  const probeOn = Boolean(probeSel?.probeMode);

  return (
    <div className="mode-toolbar" role="toolbar" aria-label="Canvas tools">
      {toolbarModes.map((m) => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            className={`mode-toolbar-btn mode-toolbar-icon-only mode-toolbar-${m.id}${active ? " is-active" : ""}`}
            title={`${m.label} (${m.shortcut})`}
            aria-label={`${m.label} (${m.shortcut})`}
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
              {m.id === "wire" ? (
                <WireIcon />
              ) : m.id === "delete" ? (
                <DeleteTrashIcon />
              ) : (
                m.glyph
              )}
            </span>
          </button>
        );
      })}

      {(onCut || onCopy) && (
        <div className="mode-toolbar-edit" role="group" aria-label="Clipboard">
            {onCut && (
              <button
                type="button"
                className="mode-toolbar-view-btn mode-toolbar-cut"
                title="Cut (Ctrl+X) — cut selected parts and wires"
                aria-label="Cut (Ctrl+X)"
                onClick={onCut}
              >
                <CutIcon />
              </button>
            )}
            {onCopy && (
              <button
                type="button"
                className={`mode-toolbar-view-btn mode-toolbar-copy${copyActive ? " is-active" : ""}`}
                title="Copy (Ctrl+C) — copy selection, or drag a box (≥70%)"
                aria-label="Copy (Ctrl+C)"
                aria-pressed={copyActive}
                onClick={onCopy}
              >
                <CopyIcon />
              </button>
            )}
          </div>
      )}

      <div className="mode-toolbar-view" role="group" aria-label="View controls">
        <button
          type="button"
          className="mode-toolbar-view-btn"
          title="Zoom In"
          aria-label="Zoom In"
          onClick={() => viewApiRef.current?.zoomIn()}
        >
          <ZoomInIcon />
        </button>
        <button
          type="button"
          className="mode-toolbar-view-btn"
          title="Zoom Out"
          aria-label="Zoom Out"
          onClick={() => viewApiRef.current?.zoomOut()}
        >
          <ZoomOutIcon />
        </button>
        <button
          type="button"
          className="mode-toolbar-view-btn"
          title="Fit to window (Space)"
          aria-label="Fit to window"
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

      {onPlaceLabel && (
        <button
            type="button"
            className={`mode-toolbar-btn mode-toolbar-icon-only mode-toolbar-netlabel${labelActive ? " is-active" : ""}`}
            title="Net name (N) — type a name, then click a wire or pin to place"
            aria-label="Net name (N)"
            aria-pressed={labelActive}
            onClick={onPlaceLabel}
          >
            <span className="mode-toolbar-glyph" aria-hidden>
              <NetLabelIcon />
            </span>
          </button>
      )}

      {(onUndo || onRedo) && (
        <div className="mode-toolbar-history" role="group" aria-label="History">
          {onUndo && (
            <button
              type="button"
              className="mode-toolbar-view-btn mode-toolbar-undo"
              title="Undo (Ctrl+Z)"
              aria-label="Undo (Ctrl+Z)"
              disabled={!canUndo}
              onClick={onUndo}
            >
              <img
                className="mode-toolbar-history-icon"
                src="/icons/history-undo.png"
                alt=""
                width={22}
                height={18}
                draggable={false}
              />
            </button>
          )}
          {onRedo && (
            <button
              type="button"
              className="mode-toolbar-view-btn mode-toolbar-redo"
              title="Redo (Ctrl+Y)"
              aria-label="Redo (Ctrl+Y)"
              disabled={!canRedo}
              onClick={onRedo}
            >
              <img
                className="mode-toolbar-history-icon"
                src="/icons/history-redo.png"
                alt=""
                width={22}
                height={18}
                draggable={false}
              />
            </button>
          )}
        </div>
      )}

      {simControlRef && (
        <div className="mode-toolbar-sim" role="group" aria-label="Simulation controls">
            <button
              type="button"
              className={`mode-toolbar-view-btn mode-toolbar-sim-toggle${simRunning ? " is-pause" : " is-play"}`}
              title={simRunning ? "Pause simulation" : simRunState === "paused" ? "Resume simulation" : "Run simulation"}
              aria-label={simRunning ? "Pause" : "Play"}
              onClick={() => {
                if (simRunning) simControlRef.current?.pause();
                else simControlRef.current?.play();
              }}
            >
              {simRunning ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              type="button"
              className={`mode-toolbar-view-btn mode-toolbar-sim-stop${stopEnabled ? " is-enabled" : ""}`}
              title={stopEnabled ? "Stop simulation" : "Stop (idle)"}
              aria-label="Stop"
              disabled={!stopEnabled}
              onClick={() => simControlRef.current?.stop()}
            >
              <StopIcon enabled={stopEnabled} />
            </button>
            {probeAvailable && (
              <button
                type="button"
                className={`mode-toolbar-view-btn mode-toolbar-probe${probeOn ? " is-active" : ""}`}
                title={
                  probeOn
                    ? "Probe ON — click a wire for voltage, a part for current (click again to turn off)"
                    : "Probe — click to plot voltages/currents on the schematic"
                }
                aria-label={probeOn ? "Probe on" : "Probe"}
                aria-pressed={probeOn}
                onClick={() => probeSel?.setProbeMode(!probeOn)}
              >
                <ProbeNeedleIcon active={probeOn} />
              </button>
            )}
          </div>
      )}

      {trailingActions && (
        <div className="mode-toolbar-actions" role="group" aria-label="File and view">
          {trailingActions}
        </div>
      )}
    </div>
  );
}
