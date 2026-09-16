/**
 * LTspice-like plot navigation for Chart.js linear charts:
 * - drag box = zoom
 * - wheel = zoom X around cursor
 * - Alt+drag or middle-drag = pan
 * - plain click = cursor pick (optional)
 */
import type { Chart } from "chart.js";

export type PlotNavHandlers = {
  onPickTime?: (t: number, which: "a" | "b") => void;
  onHoverTime?: (t: number | null) => void;
};

const DRAG_PX = 8;

function axisRange(chart: Chart, id: string): { min: number; max: number } | null {
  const ax = chart.scales[id];
  if (!ax) return null;
  const min = ax.min;
  const max = ax.max;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return null;
  return { min, max };
}

function setAxisRange(chart: Chart, id: string, min: number, max: number) {
  const ax = chart.scales[id];
  if (!ax) return;
  ax.options.min = min;
  ax.options.max = max;
}

function zoomXAround(chart: Chart, pixelX: number, factor: number) {
  const x = chart.scales.x;
  const area = chart.chartArea;
  if (!x || !area) return;
  const r = axisRange(chart, "x");
  if (!r) return;
  const t = x.getValueForPixel(pixelX) as number;
  if (!Number.isFinite(t)) return;
  const span = (r.max - r.min) * factor;
  const leftFrac = (t - r.min) / (r.max - r.min || 1);
  const min = t - span * leftFrac;
  const max = t + span * (1 - leftFrac);
  if (!(max > min)) return;
  setAxisRange(chart, "x", min, max);
  chart.update("none");
}

function panByPixels(chart: Chart, dx: number, dy: number) {
  const x = chart.scales.x;
  const y = chart.scales.y;
  const y1 = chart.scales.y1;
  if (!x) return;
  const rx = axisRange(chart, "x");
  if (rx) {
    const a0 = x.getValueForPixel(0) as number;
    const a1 = x.getValueForPixel(dx) as number;
    const d = (Number.isFinite(a0) && Number.isFinite(a1) ? a0 - a1 : 0);
    setAxisRange(chart, "x", rx.min + d, rx.max + d);
  }
  if (y && dy) {
    const ry = axisRange(chart, "y");
    if (ry) {
      const a0 = y.getValueForPixel(0) as number;
      const a1 = y.getValueForPixel(dy) as number;
      const d = (Number.isFinite(a0) && Number.isFinite(a1) ? a0 - a1 : 0);
      setAxisRange(chart, "y", ry.min + d, ry.max + d);
    }
  }
  if (y1 && dy) {
    const ry = axisRange(chart, "y1");
    if (ry) {
      const a0 = y1.getValueForPixel(0) as number;
      const a1 = y1.getValueForPixel(dy) as number;
      const d = (Number.isFinite(a0) && Number.isFinite(a1) ? a0 - a1 : 0);
      setAxisRange(chart, "y1", ry.min + d, ry.max + d);
    }
  }
  chart.update("none");
}

function applyBoxZoom(
  chart: Chart,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  const area = chart.chartArea;
  const x = chart.scales.x;
  const y = chart.scales.y;
  if (!area || !x) return;
  const left = Math.max(area.left, Math.min(x0, x1));
  const right = Math.min(area.right, Math.max(x0, x1));
  const top = Math.max(area.top, Math.min(y0, y1));
  const bottom = Math.min(area.bottom, Math.max(y0, y1));
  if (right - left < DRAG_PX || bottom - top < DRAG_PX) return;

  const t0 = x.getValueForPixel(left) as number;
  const t1 = x.getValueForPixel(right) as number;
  if (Number.isFinite(t0) && Number.isFinite(t1) && t1 !== t0) {
    setAxisRange(chart, "x", Math.min(t0, t1), Math.max(t0, t1));
  }
  if (y) {
    const v0 = y.getValueForPixel(bottom) as number;
    const v1 = y.getValueForPixel(top) as number;
    if (Number.isFinite(v0) && Number.isFinite(v1) && v1 !== v0) {
      setAxisRange(chart, "y", Math.min(v0, v1), Math.max(v0, v1));
    }
  }
  const y1s = chart.scales.y1;
  if (y1s) {
    const v0 = y1s.getValueForPixel(bottom) as number;
    const v1 = y1s.getValueForPixel(top) as number;
    if (Number.isFinite(v0) && Number.isFinite(v1) && v1 !== v0) {
      setAxisRange(chart, "y1", Math.min(v0, v1), Math.max(v0, v1));
    }
  }
  chart.update("none");
}

/** Attach LTspice-like nav. Returns disposer. */
export function attachPlotNav(chart: Chart, handlers: PlotNavHandlers = {}): () => void {
  const canvas = chart.canvas;
  const wrap = canvas.parentElement;
  if (wrap && getComputedStyle(wrap).position === "static") {
    wrap.style.position = "relative";
  }

  let gesture: "box" | "pan" | null = null;
  let startClientX = 0;
  let startClientY = 0;
  let startLocalX = 0;
  let startLocalY = 0;
  let lastClientX = 0;
  let lastClientY = 0;
  let moved = false;
  let boxEl: HTMLDivElement | null = null;

  const local = (e: PointerEvent | WheelEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const clearBox = () => {
    boxEl?.remove();
    boxEl = null;
  };

  const onWheel = (e: WheelEvent) => {
    if (!chart.chartArea) return;
    e.preventDefault();
    const { x } = local(e);
    const factor = e.deltaY > 0 ? 1.25 : 0.8;
    zoomXAround(chart, x, factor);
  };

  const onPointerDown = (e: PointerEvent) => {
    const area = chart.chartArea;
    if (!area) return;
    const p = local(e);
    if (p.x < area.left || p.x > area.right || p.y < area.top || p.y > area.bottom) {
      return;
    }

    const pan =
      e.button === 1 || (e.button === 0 && (e.altKey || e.metaKey && e.ctrlKey));
    if (pan) {
      gesture = "pan";
      moved = false;
      startClientX = e.clientX;
      startClientY = e.clientY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    if (e.button !== 0) return;
    // Left-drag may become box-zoom; click (no drag) becomes cursor.
    gesture = "box";
    moved = false;
    startClientX = e.clientX;
    startClientY = e.clientY;
    startLocalX = p.x;
    startLocalY = p.y;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!gesture) {
      if (handlers.onHoverTime) {
        const area = chart.chartArea;
        const xScale = chart.scales.x;
        if (!area || !xScale) return;
        const p = local(e);
        if (p.x < area.left || p.x > area.right) {
          handlers.onHoverTime(null);
          return;
        }
        handlers.onHoverTime(xScale.getValueForPixel(p.x) as number);
      }
      return;
    }

    const dist = Math.hypot(e.clientX - startClientX, e.clientY - startClientY);
    if (dist > DRAG_PX) moved = true;

    if (gesture === "pan") {
      panByPixels(chart, e.clientX - lastClientX, e.clientY - lastClientY);
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      e.preventDefault();
      return;
    }

    if (gesture === "box" && moved) {
      const p = local(e);
      if (!boxEl && wrap) {
        boxEl = document.createElement("div");
        boxEl.className = "sim-plot-zoom-box";
        wrap.appendChild(boxEl);
      }
      if (boxEl) {
        const left = Math.min(startLocalX, p.x);
        const top = Math.min(startLocalY, p.y);
        boxEl.style.left = `${left}px`;
        boxEl.style.top = `${top}px`;
        boxEl.style.width = `${Math.abs(p.x - startLocalX)}px`;
        boxEl.style.height = `${Math.abs(p.y - startLocalY)}px`;
      }
      e.preventDefault();
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    if (g === "box") {
      const p = local(e);
      if (moved) {
        applyBoxZoom(chart, startLocalX, startLocalY, p.x, p.y);
        clearBox();
        e.preventDefault();
        return;
      }
      clearBox();
      // Click → cursor A (Shift → B)
      if (handlers.onPickTime) {
        const xScale = chart.scales.x;
        const area = chart.chartArea;
        if (xScale && area && p.x >= area.left && p.x <= area.right) {
          const t = xScale.getValueForPixel(p.x) as number;
          if (Number.isFinite(t)) {
            handlers.onPickTime(t, e.shiftKey ? "b" : "a");
          }
        }
      }
      return;
    }

    clearBox();
  };

  const onPointerLeave = () => {
    if (!gesture) handlers.onHoverTime?.(null);
  };

  const onLostCapture = () => {
    gesture = null;
    clearBox();
  };

  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("lostpointercapture", onLostCapture);
  canvas.style.touchAction = "none";
  canvas.title =
    (canvas.title ? canvas.title + " · " : "") +
    "Drag box=zoom · Wheel=zoom time · Alt-drag=pan · Click=cursor A · Shift+click=cursor B";

  return () => {
    clearBox();
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("lostpointercapture", onLostCapture);
  };
}
