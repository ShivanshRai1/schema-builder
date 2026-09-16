import { useCallback, useEffect, useRef, useState } from "react";

export type WindowRect = { x: number; y: number; w: number; h: number };

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

// Shared stacking counter so the last-focused window sits on top.
let topZ = 1000;

function IconMinimize() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6.5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconMaximize() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2.25" y="2.25" width="7.5" height="7.5" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** Restore from maximized or minimized (overlapping squares). */
function IconRestore() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="3.5" y="1.75" width="6.5" height="6.5" rx="0.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.75" y="3.75" width="6.5" height="6.5" rx="0.4" fill="var(--panel-2, #171c24)" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 3l6 6M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/**
 * A lightweight floating, draggable window with minimize / maximize / close
 * and resize from any edge or corner. `onClose` re-docks the panel.
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
  const rootRef = useRef<HTMLDivElement | null>(null);

  const bringToFront = useCallback(() => setZ(++topZ), []);

  const notifyContentResize = useCallback(() => {
    // Chart.js / layout: fire after the browser applies the new box size.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
        rootRef.current?.dispatchEvent(
          new CustomEvent("fw-resize", { bubbles: true }),
        );
      });
    });
  }, []);

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      if (maximized) return;
      // Don't start a drag when a titlebar control was pressed.
      if ((e.target as HTMLElement).closest(".fw-btn")) return;
      if ((e.target as HTMLElement).closest(".fw-edge")) return;
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
    (edge: ResizeEdge, e: React.PointerEvent) => {
      if (maximized || minimized) return;
      e.preventDefault();
      e.stopPropagation();
      bringToFront();
      const start = {
        px: e.clientX,
        py: e.clientY,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
      };
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - start.px;
        const dy = ev.clientY - start.py;
        let { x, y, w, h } = start;

        if (edge.includes("e")) {
          w = Math.max(minWidth, start.w + dx);
        }
        if (edge.includes("s")) {
          h = Math.max(minHeight, start.h + dy);
        }
        if (edge.includes("w")) {
          const nextW = Math.max(minWidth, start.w - dx);
          x = start.x + (start.w - nextW);
          w = nextW;
        }
        if (edge.includes("n")) {
          const nextH = Math.max(minHeight, start.h - dy);
          y = start.y + (start.h - nextH);
          h = nextH;
        }

        // Keep on-screen a bit.
        x = Math.max(0, x);
        y = Math.max(0, y);

        setRect({ x, y, w, h });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        notifyContentResize();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [maximized, minimized, rect, minWidth, minHeight, bringToFront, notifyContentResize],
  );

  const restoreFromMinimized = useCallback(() => {
    setMinimized(false);
    setMaximized(false);
  }, []);

  const toggleMinimize = useCallback(() => {
    if (minimized) {
      restoreFromMinimized();
      return;
    }
    if (maximized && !prevRect.current) prevRect.current = rect;
    setMaximized(false);
    setMinimized(true);
  }, [minimized, maximized, rect, restoreFromMinimized]);

  const toggleMaximize = useCallback(() => {
    if (minimized) {
      setMinimized(false);
      if (!prevRect.current) prevRect.current = rect;
      setMaximized(true);
      return;
    }
    setMaximized((m) => {
      if (!m) {
        prevRect.current = rect;
        return true;
      }
      if (prevRect.current) setRect(prevRect.current);
      return false;
    });
  }, [minimized, rect]);

  const MINIMIZED_WIDTH = 260;
  const style: React.CSSProperties = maximized
    ? { left: 8, top: 8, right: 8, bottom: 8, width: "auto", height: "auto", zIndex: z }
    : {
        left: rect.x,
        top: rect.y,
        width: minimized ? MINIMIZED_WIDTH : rect.w,
        height: minimized ? undefined : rect.h,
        zIndex: z,
      };

  // After restore / maximize / size change, ask charts to reflow.
  useEffect(() => {
    if (minimized) return;
    notifyContentResize();
  }, [minimized, maximized, rect.w, rect.h, notifyContentResize]);

  return (
    <div
      ref={rootRef}
      className={`floating-window${minimized ? " fw-minimized" : ""}${maximized ? " fw-maximized" : ""}`}
      style={style}
      onPointerDown={bringToFront}
    >
      <div
        className="fw-titlebar"
        onPointerDown={startDrag}
        onDoubleClick={() => {
          if (minimized) restoreFromMinimized();
          else toggleMaximize();
        }}
      >
        <span className="fw-title">{title}</span>
        <div className="fw-controls">
          <button
            type="button"
            className="fw-btn"
            title={minimized ? "Restore" : "Minimize"}
            aria-label={minimized ? "Restore" : "Minimize"}
            onClick={toggleMinimize}
          >
            {minimized ? <IconRestore /> : <IconMinimize />}
          </button>
          <button
            type="button"
            className="fw-btn"
            title={maximized ? "Restore" : "Maximize"}
            aria-label={maximized ? "Restore" : "Maximize"}
            onClick={toggleMaximize}
          >
            {maximized ? <IconRestore /> : <IconMaximize />}
          </button>
          <button type="button" className="fw-btn fw-btn-close" title="Close" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
      </div>
      {/* Keep children mounted while minimized so SimPanel / charts keep their state. */}
      <div className="fw-body" hidden={minimized} aria-hidden={minimized}>
        {children}
      </div>
      {!maximized && !minimized &&
        RESIZE_EDGES.map((edge) => (
          <div
            key={edge}
            className={`fw-edge fw-edge-${edge}`}
            onPointerDown={(e) => startResize(edge, e)}
            aria-hidden
          />
        ))}
    </div>
  );
}
