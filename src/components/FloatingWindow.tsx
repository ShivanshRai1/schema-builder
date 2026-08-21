import { useCallback, useRef, useState } from "react";

export type WindowRect = { x: number; y: number; w: number; h: number };

// Shared stacking counter so the last-focused window sits on top.
let topZ = 1000;

/**
 * A lightweight floating, draggable window with minimize / maximize / close
 * controls and a bottom-right resize grip. Used to "pop out" dockable panels
 * (netlist, simulation) into a large, movable view. `onClose` re-docks the panel.
 */
export function FloatingWindow({
  title,
  onClose,
  defaultRect,
  minWidth = 320,
  minHeight = 180,
  children,
}: {
  title: string;
  onClose: () => void;
  defaultRect: WindowRect;
  minWidth?: number;
  minHeight?: number;
  children: React.ReactNode;
}) {
  const [rect, setRect] = useState<WindowRect>(defaultRect);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [z, setZ] = useState(() => ++topZ);
  const prevRect = useRef<WindowRect | null>(null);

  const bringToFront = useCallback(() => setZ(++topZ), []);

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      if (maximized) return;
      // Don't start a drag when a titlebar control was pressed.
      if ((e.target as HTMLElement).closest(".fw-btn")) return;
      e.preventDefault();
      bringToFront();
      const start = { px: e.clientX, py: e.clientY, x: rect.x, y: rect.y };
      const onMove = (ev: PointerEvent) => {
        setRect((r) => ({
          ...r,
          x: Math.max(0, start.x + (ev.clientX - start.px)),
          y: Math.max(0, start.y + (ev.clientY - start.py)),
        }));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [maximized, rect.x, rect.y, bringToFront],
  );

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      if (maximized) return;
      e.preventDefault();
      e.stopPropagation();
      bringToFront();
      const start = { px: e.clientX, py: e.clientY, w: rect.w, h: rect.h };
      const onMove = (ev: PointerEvent) => {
        setRect((r) => ({
          ...r,
          w: Math.max(minWidth, start.w + (ev.clientX - start.px)),
          h: Math.max(minHeight, start.h + (ev.clientY - start.py)),
        }));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [maximized, rect.w, rect.h, minWidth, minHeight, bringToFront],
  );

  const toggleMaximize = useCallback(() => {
    setMinimized(false);
    setMaximized((m) => {
      if (!m) prevRect.current = rect;
      else if (prevRect.current) setRect(prevRect.current);
      return !m;
    });
  }, [rect]);

  const MINIMIZED_WIDTH = 220;
  const style: React.CSSProperties = maximized
    ? { left: 8, top: 8, right: 8, bottom: 8, width: "auto", height: "auto", zIndex: z }
    : {
        left: rect.x,
        top: rect.y,
        width: minimized ? MINIMIZED_WIDTH : rect.w,
        height: minimized ? undefined : rect.h,
        zIndex: z,
      };

  return (
    <div
      className={`floating-window${minimized ? " fw-minimized" : ""}${maximized ? " fw-maximized" : ""}`}
      style={style}
      onPointerDown={bringToFront}
    >
      <div className="fw-titlebar" onPointerDown={startDrag} onDoubleClick={toggleMaximize}>
        <span className="fw-title">{title}</span>
        <div className="fw-controls">
          <button
            type="button"
            className="fw-btn"
            title={minimized ? "Restore" : "Minimize"}
            onClick={() => {
              setMaximized(false);
              setMinimized((v) => !v);
            }}
          >
            {minimized ? "▢" : "—"}
          </button>
          <button
            type="button"
            className="fw-btn"
            title={maximized ? "Restore" : "Maximize"}
            onClick={toggleMaximize}
          >
            {maximized ? "❐" : "▢"}
          </button>
          <button type="button" className="fw-btn fw-btn-close" title="Close" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>
      {!minimized && (
        <div className="fw-body">
          {children}
          {!maximized && <div className="fw-resize" onPointerDown={startResize} />}
        </div>
      )}
    </div>
  );
}
