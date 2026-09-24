/**
 * SimPanel — Run + Chart.js waveforms + zoom toolbar + probe result callback.
 */
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Title,
  Legend,
  Filler,
  CategoryScale,
} from "chart.js";
import { legendLabelsForSeries, runSimulation, type SimEngine, type SimResult, type SimSeries } from "../sim/runSimulation";
import { useProbeSelectionOptional } from "../sim/ProbeContext";
import {
  isCurrentSignalName,
  isVoltageSignalName,
  resolveProbedSeries,
  colorForSignalName,
  PROBE_TRACE_COLORS,
} from "../sim/probeSelection";
import { evaluateProbeExpression } from "../sim/probeExpressions";
import { formatProbeValue } from "../sim/probeHover";
import { attachPlotNav } from "../sim/plotNav";
import {
  conditionsEqual,
  formatLoadDumpConditionsSummary,
  LOAD_DUMP_PULSES,
  normalizePulseId,
  parseLoadDumpFromNetlist,
  type LoadDumpConditions,
  type LoadDumpPulseId,
} from "../sim/loadDumpConditions";
import {
  findLoadDumpPreset,
  LOAD_DUMP_PRESETS,
  loadDumpConditionSaveName,
  type LoadDumpDiodeSlot,
} from "../sim/loadDumpPresets";
import { type UiTheme } from "../theme";
import type { Plugin } from "chart.js";

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Title,
  Legend,
  Filler,
  CategoryScale,
);

export type SimRunState = "idle" | "running" | "paused";

export type SimControlApi = {
  play: () => void;
  pause: () => void;
  stop: () => void;
  getState: () => SimRunState;
};

function parseTranLine(line: string | undefined): { step: string; stop: string } {
  if (!line) return { step: "1u", stop: "1m" };
  const parts = line.replace(/^\.tran\s+/i, "").trim().split(/\s+/);
  return { step: parts[0] || "1u", stop: parts[1] || "1m" };
}

function setTranInDirectives(
  dirs: string[] | undefined,
  step: string,
  stop: string,
): string[] {
  const base = [...(dirs ?? [])].filter((d) => !/^\.tran\b/i.test(d));
  const s = step.trim() || "1u";
  const e = stop.trim() || "1m";
  return [...base, `.tran ${s} ${e}`];
}

type ZoomMode = "x" | "y" | "xy";

const SERIES_COLORS = PROBE_TRACE_COLORS;

function seriesColor(i: number): string {
  return SERIES_COLORS[i % SERIES_COLORS.length]!;
}

function unitForSeries(name: string): "V" | "A" {
  return isCurrentSignalName(name) ? "A" : "V";
}

function buildTraceLabelsPlugin(): Plugin<"line"> {
  return {
    id: "simTraceLabels",
    afterDraw(chart) {
      const area = chart.chartArea;
      if (!area) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = "bold 12px ui-monospace, Menlo, Consolas, monospace";
      ctx.textBaseline = "top";
      let x = area.left + 6;
      const y = Math.max(4, area.top - 18);
      for (let i = 0; i < chart.data.datasets.length; i++) {
        if (!chart.isDatasetVisible(i)) continue;
        const ds = chart.data.datasets[i]!;
        const label = String(ds.label ?? "");
        if (!label) continue;
        const color = String(ds.borderColor ?? seriesColor(i));
        const w = ctx.measureText(label).width;
        if (x + w > area.right - 4) break;
        ctx.fillStyle = color;
        ctx.fillText(label, x, y);
        x += w + 14;
      }
      ctx.restore();
    },
  };
}

function nearestYInDataset(
  data: unknown,
  t: number,
): number | null {
  if (!Array.isArray(data) || !data.length) return null;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < data.length; i++) {
    const pt = data[i] as { x?: number; y?: number } | number;
    const x = typeof pt === "number" ? i : Number(pt?.x);
    if (!Number.isFinite(x)) continue;
    const d = Math.abs(x - t);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const pt = data[best] as { y?: number } | number;
  const y = typeof pt === "number" ? pt : Number(pt?.y);
  return Number.isFinite(y) ? y : null;
}

function buildCursorPlugin(
  getCursors: () => { a: number | null; b: number | null; hover: number | null },
): Plugin<"line"> {
  return {
    id: "simCursor",
    afterDraw(chart) {
      const { a, b, hover } = getCursors();
      const xScale = chart.scales.x;
      const area = chart.chartArea;
      if (!xScale || !area) return;
      const ctx = chart.ctx;

      const drawLine = (t: number, color: string, dash: number[]) => {
        const px = xScale.getPixelForValue(t);
        if (px < area.left || px > area.right) return null;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.25;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(px, area.top);
        ctx.lineTo(px, area.bottom);
        ctx.stroke();
        ctx.restore();
        return px;
      };

      if (hover != null && Number.isFinite(hover) && a == null && b == null) {
        drawLine(hover, "rgba(255,255,255,0.85)", [3, 3]);
      }
      const pxA = a != null && Number.isFinite(a) ? drawLine(a, "#ffd740", []) : null;
      const pxB = b != null && Number.isFinite(b) ? drawLine(b, "#40c4ff", [5, 3]) : null;

      const readAt = (t: number) => {
        const lines: { text: string; color: string }[] = [
          { text: formatTimeAxis(t), color: "#ffffff" },
        ];
        for (let i = 0; i < chart.data.datasets.length; i++) {
          if (!chart.isDatasetVisible(i)) continue;
          const ds = chart.data.datasets[i]!;
          const label = String(ds.label ?? `trace${i}`);
          const y = nearestYInDataset(ds.data, t);
          if (y == null) continue;
          lines.push({
            text: `${label}=${formatProbeValue(y, unitForSeries(label))}`,
            color: String(ds.borderColor ?? seriesColor(i)),
          });
        }
        return lines;
      };

      const paintBox = (
        px: number,
        lines: { text: string; color: string }[],
        tag: string,
      ) => {
        ctx.save();
        ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
        const pad = 5;
        const lineH = 14;
        let boxW = ctx.measureText(tag).width;
        for (const ln of lines) boxW = Math.max(boxW, ctx.measureText(ln.text).width);
        boxW += pad * 2;
        const boxH = (lines.length + 1) * lineH + pad;
        let boxX = px + 10;
        let boxY = area.top + 8;
        if (boxX + boxW > area.right) boxX = px - 10 - boxW;
        ctx.fillStyle = "rgba(0,0,0,0.82)";
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(boxX, boxY, boxW, boxH);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(tag, boxX + pad, boxY + pad + 10);
        lines.forEach((ln, i) => {
          ctx.fillStyle = ln.color;
          ctx.fillText(ln.text, boxX + pad, boxY + pad + (i + 1) * lineH + 10);
        });
        ctx.restore();
      };

      if (a != null && pxA != null) paintBox(pxA, readAt(a), "Cursor A");
      if (b != null && pxB != null) paintBox(pxB, readAt(b), "Cursor B");

      if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) {
        const dt = Math.abs(b - a);
        const deltaLines: { text: string; color: string }[] = [
          { text: `Δt=${formatTimeAxis(dt)}`, color: "#ffffff" },
        ];
        for (let i = 0; i < chart.data.datasets.length; i++) {
          if (!chart.isDatasetVisible(i)) continue;
          const ds = chart.data.datasets[i]!;
          const label = String(ds.label ?? `trace${i}`);
          const ya = nearestYInDataset(ds.data, a);
          const yb = nearestYInDataset(ds.data, b);
          if (ya == null || yb == null) continue;
          const unit = unitForSeries(label);
          deltaLines.push({
            text: `Δ${label}=${formatProbeValue(yb - ya, unit)}`,
            color: String(ds.borderColor ?? seriesColor(i)),
          });
        }
        const mid = ((pxA ?? area.left) + (pxB ?? area.right)) / 2;
        paintBox(mid, deltaLines, "Δ A→B");
      } else if (hover != null && a == null && b == null) {
        const px = xScale.getPixelForValue(hover);
        if (px >= area.left && px <= area.right) {
          paintBox(px, readAt(hover), "Hover");
        }
      }
    },
  };
}

function makeLineChart(
  canvas: HTMLCanvasElement,
  plotSeries: SimSeries[],
  labels: string[],
  opts: {
    dualAxis: boolean;
    hidden: Set<string>;
    colorOffset?: number;
    showXTitle?: boolean;
    chartId: string;
    getCursors: (chartId: string) => {
      a: number | null;
      b: number | null;
      hover: number | null;
    };
    onHoverTime?: (chartId: string, t: number | null) => void;
    onPickTime?: (t: number, which: "a" | "b") => void;
    navDisposers: MutableRefObject<Array<() => void>>;
  },
): Chart {
  const tick = "#b0b8c0";
  const grid = "rgba(180,190,200,0.28)";
  const off = opts.colorOffset ?? 0;
  const chartId = opts.chartId;
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: plotSeries.map((s, i) => {
        const isI = isCurrentSignalName(s.name);
        const color = colorForSignalName(s.name) || seriesColor(i + off);
        return {
          label: labels[i] ?? s.name,
          data: s.x.map((x, j) => ({ x, y: s.y[j] ?? 0 })),
          borderColor: color,
          backgroundColor: "transparent",
          pointRadius: 0,
          borderWidth: 1.75,
          borderCapStyle: "round" as const,
          borderJoinStyle: "round" as const,
          tension: 0,
          hidden: opts.hidden.has(s.name),
          yAxisID: opts.dualAxis ? (isI ? "y1" : "y") : "y",
        };
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { top: 22, right: 8, left: 4, bottom: 2 } },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          type: "linear",
          title: {
            display: opts.showXTitle !== false,
            text: "time",
            color: tick,
            font: { size: 11, weight: 600 },
          },
          ticks: {
            color: tick,
            maxTicksLimit: 8,
            font: { size: 10 },
            callback: function (this: { max?: number; min?: number }, v: string | number) {
              const span =
                this.max != null && this.min != null ? this.max - this.min : undefined;
              return formatTimeAxis(Number(v), span);
            },
          },
          grid: { color: grid, lineWidth: 1, tickBorderDash: [2, 2] },
          border: { color: tick, width: 1 },
        },
        y: {
          type: "linear",
          position: "left",
          title: {
            display: true,
            text: opts.dualAxis
              ? "V"
              : plotSeries.every((s) => isCurrentSignalName(s.name))
                ? "A"
                : plotSeries.every((s) => isVoltageSignalName(s.name))
                  ? "V"
                  : "V / A",
            color: tick,
            font: { size: 11, weight: 700 },
          },
          ticks: {
            color: tick,
            font: { size: 10 },
            maxTicksLimit: 8,
            callback: (v) => formatYTick(Number(v)),
          },
          grid: { color: grid, lineWidth: 1 },
          border: { color: tick, width: 1 },
        },
        ...(opts.dualAxis
          ? {
              y1: {
                type: "linear" as const,
                position: "right" as const,
                title: {
                  display: true,
                  text: "A",
                  color: tick,
                  font: { size: 11, weight: 700 },
                },
                ticks: {
                  color: tick,
                  font: { size: 10 },
                  maxTicksLimit: 8,
                  callback: (v: string | number) => formatYTick(Number(v)),
                },
                grid: { drawOnChartArea: false },
                border: { color: tick, width: 1 },
              },
            }
          : {}),
      },
    },
    plugins: [
      buildTraceLabelsPlugin(),
      buildCursorPlugin(() => opts.getCursors(chartId)),
    ],
  });

  opts.navDisposers.current.push(
    attachPlotNav(chart, {
      onHoverTime: (t) => opts.onHoverTime?.(chartId, t),
      onPickTime: opts.onPickTime,
    }),
  );
  // First paint then snap Y to readable limits (fixes 1e-26 autoscale).
  queueMicrotask(() => applyNiceAxisLimits(chart));
  return chart;
}

/** Magnifying-glass zoom icons — bold at 100% UI scale. */
function ZoomXIcon() {
  return (
    <svg className="sim-zoom-icon" width="28" height="28" viewBox="0 0 28 28" aria-hidden>
      <circle cx="12" cy="12" r="7.5" fill="rgba(47,111,237,0.08)" stroke="currentColor" strokeWidth="2.4" />
      <path d="M17.6 17.6 L24.2 24.2" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path
        d="M6.2 12 H17.8 M6.2 12 L9.1 9.1 M6.2 12 L9.1 14.9 M17.8 12 L14.9 9.1 M17.8 12 L14.9 14.9"
        fill="none"
        stroke="#1d4ed8"
        strokeWidth="2.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ZoomYIcon() {
  return (
    <svg className="sim-zoom-icon" width="28" height="28" viewBox="0 0 28 28" aria-hidden>
      <circle cx="12" cy="12" r="7.5" fill="rgba(47,111,237,0.08)" stroke="currentColor" strokeWidth="2.4" />
      <path d="M17.6 17.6 L24.2 24.2" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path
        d="M12 6.2 V17.8 M12 6.2 L9.1 9.1 M12 6.2 L14.9 9.1 M12 17.8 L9.1 14.9 M12 17.8 L14.9 14.9"
        fill="none"
        stroke="#1d4ed8"
        strokeWidth="2.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ZoomXYIcon() {
  return (
    <svg className="sim-zoom-icon" width="28" height="28" viewBox="0 0 28 28" aria-hidden>
      <circle cx="12" cy="12" r="7.5" fill="rgba(47,111,237,0.08)" stroke="currentColor" strokeWidth="2.4" />
      <path d="M17.6 17.6 L24.2 24.2" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path
        d="M6.5 12 H17.5 M12 6.5 V17.5 M6.5 12 L8.8 9.7 M6.5 12 L8.8 14.3 M17.5 12 L15.2 9.7 M17.5 12 L15.2 14.3 M12 6.5 L9.7 8.8 M12 6.5 L14.3 8.8 M12 17.5 L9.7 15.2 M12 17.5 L14.3 15.2"
        fill="none"
        stroke="#1d4ed8"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AutoScaleIcon() {
  return (
    <svg className="sim-zoom-icon" width="28" height="28" viewBox="0 0 28 28" aria-hidden>
      <rect x="3" y="3" width="22" height="22" rx="3" fill="rgba(0,0,0,0.04)" stroke="currentColor" strokeWidth="2.3" />
      <path
        d="M10 10 L5.5 5.5 M10 10 H7.2 M10 10 V7.2 M18 10 L22.5 5.5 M18 10 H20.8 M18 10 V7.2 M10 18 L5.5 22.5 M10 18 H7.2 M10 18 V20.8 M18 18 L22.5 22.5 M18 18 H20.8 M18 18 V20.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function zoomChart(chart: Chart, mode: ZoomMode, factor: number) {
  const x = chart.scales.x;
  const y = chart.scales.y;
  const y1 = chart.scales.y1;
  if (!x) return;
  const zoomAxis = (axis: typeof x, f: number) => {
    const min = axis.min;
    const max = axis.max;
    if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return;
    const mid = (min + max) / 2;
    const half = ((max - min) / 2) * f;
    axis.options.min = mid - half;
    axis.options.max = mid + half;
  };
  if (mode === "x" || mode === "xy") zoomAxis(x, factor);
  if ((mode === "y" || mode === "xy") && y) zoomAxis(y, factor);
  if ((mode === "y" || mode === "xy") && y1) zoomAxis(y1, factor);
  chart.update("none");
}

function autoScaleChart(chart: Chart) {
  const x = chart.scales.x;
  const y = chart.scales.y;
  const y1 = chart.scales.y1;
  if (x) {
    delete x.options.min;
    delete x.options.max;
  }
  if (y) {
    delete y.options.min;
    delete y.options.max;
  }
  if (y1) {
    delete y1.options.min;
    delete y1.options.max;
  }
  chart.update();
  // After Chart.js computes raw bounds, snap tiny/noisy spans to a readable range.
  applyNiceAxisLimits(chart);
}

/** Round axis limits so flat / noise-level signals don't get 1e-26 ticks. */
function niceLinearRange(
  rawMin: number,
  rawMax: number,
  kind: "V" | "A" | "t",
): { min: number; max: number } {
  let min = rawMin;
  let max = rawMax;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return kind === "A" ? { min: -1e-6, max: 1e-6 } : { min: -1, max: 1 };
  }
  if (min > max) {
    const t = min;
    min = max;
    max = t;
  }
  const mid = (min + max) / 2;
  let span = max - min;
  const noise =
    kind === "A" ? 1e-12 : kind === "V" ? 1e-9 : Math.max(1e-15, Math.abs(mid) * 1e-12);

  if (!(span > noise)) {
    if (kind === "t") {
      const pad = Math.max(Math.abs(mid) * 0.05, 1e-6);
      min = mid - pad;
      max = mid + pad;
      span = max - min;
    } else if (Math.abs(mid) <= noise) {
      return kind === "A" ? { min: -1e-6, max: 1e-6 } : { min: -1, max: 1 };
    } else {
      const pad = Math.max(Math.abs(mid) * 0.1, kind === "A" ? 1e-6 : 0.5);
      min = mid - pad;
      max = mid + pad;
      span = max - min;
    }
  } else {
    const pad = span * 0.05;
    min -= pad;
    max += pad;
    span = max - min;
  }

  const rough = span / 8;
  const exp = Math.floor(Math.log10(Math.max(rough, Number.EPSILON)));
  const base = Math.pow(10, exp);
  const err = rough / base;
  const step =
    err <= 1.5 ? base : err <= 3 ? 2 * base : err <= 7 ? 5 * base : 10 * base;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  if (niceMax > niceMin) return { min: niceMin, max: niceMax };
  return { min, max };
}

function datasetYBounds(
  chart: Chart,
  axisId: string,
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < chart.data.datasets.length; i++) {
    if (!chart.isDatasetVisible(i)) continue;
    const ds = chart.data.datasets[i] as { yAxisID?: string; data?: unknown };
    if ((ds.yAxisID ?? "y") !== axisId) continue;
    const data = ds.data;
    if (!Array.isArray(data)) continue;
    for (const pt of data) {
      const y = typeof pt === "number" ? pt : Number((pt as { y?: number })?.y);
      if (!Number.isFinite(y)) continue;
      if (y < min) min = y;
      if (y > max) max = y;
    }
  }
  if (!(min < Infinity && max > -Infinity)) return null;
  return { min, max };
}

function applyNiceAxisLimits(chart: Chart) {
  const y = chart.scales.y;
  const y1 = chart.scales.y1;
  const x = chart.scales.x;
  let changed = false;

  if (y) {
    const b = datasetYBounds(chart, "y");
    if (b) {
      const titleText = String(
        (y.options as { title?: { text?: string } }).title?.text ?? "V",
      );
      const kind: "V" | "A" = titleText === "A" ? "A" : "V";
      const nice = niceLinearRange(b.min, b.max, kind);
      y.options.min = nice.min;
      y.options.max = nice.max;
      changed = true;
    }
  }
  if (y1) {
    const b = datasetYBounds(chart, "y1");
    if (b) {
      const nice = niceLinearRange(b.min, b.max, "A");
      y1.options.min = nice.min;
      y1.options.max = nice.max;
      changed = true;
    }
  }
  if (x && Number.isFinite(x.min) && Number.isFinite(x.max)) {
    const span = x.max - x.min;
    if (!(span > 0)) {
      const nice = niceLinearRange(x.min, x.max, "t");
      x.options.min = nice.min;
      x.options.max = nice.max;
      changed = true;
    }
  }
  if (changed) chart.update("none");
}

/** Compact Y tick labels (avoid 1.23e-26 style noise). */
function formatYTick(v: number): string {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a < 1e-15) return "0";
  const fmt = (n: number, digits: number) => {
    const s = n.toFixed(digits);
    return s.replace(/\.?0+$/, "");
  };
  if (a >= 1e3) return `${fmt(v / 1e3, 2)}k`;
  if (a >= 100) return fmt(v, 0);
  if (a >= 10) return fmt(v, 1);
  if (a >= 1) return fmt(v, 2);
  if (a >= 1e-3) return `${fmt(v * 1e3, 2)}m`;
  if (a >= 1e-6) return `${fmt(v * 1e6, 2)}µ`;
  if (a >= 1e-9) return `${fmt(v * 1e9, 2)}n`;
  if (a >= 1e-12) return `${fmt(v * 1e12, 2)}p`;
  return "0";
}

/** Time ticks share one unit based on the visible span (not per-tick). */
function formatTimeAxis(t: number, spanHint?: number): string {
  if (!Number.isFinite(t)) return "";
  const span = spanHint != null && spanHint > 0 ? spanHint : Math.abs(t) || 1;
  let scale = 1;
  let unit = "s";
  if (span >= 1) {
    scale = 1;
    unit = "s";
  } else if (span >= 1e-3) {
    scale = 1e3;
    unit = "ms";
  } else if (span >= 1e-6) {
    scale = 1e6;
    unit = "µs";
  } else {
    scale = 1e9;
    unit = "ns";
  }
  const v = t * scale;
  const a = Math.abs(v);
  const digits = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  const s = v.toFixed(digits).replace(/\.?0+$/, "");
  return `${s} ${unit}`;
}

function nearestY(s: SimSeries, t: number): number | null {
  if (!s.x.length) return null;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < s.x.length; i++) {
    const d = Math.abs(s.x[i]! - t);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const y = s.y[best];
  return typeof y === "number" && Number.isFinite(y) ? y : null;
}

type PlotLayout = "overlay" | "stacked";

export function SimPanel({
  netlist,
  onPopOut,
  uiTheme = "dark",
  controlRef,
  onRunStateChange,
  onSimResult,
  directives,
  onDirectivesChange,
  retainedResult = null,
  onLoadDumpConditionsChange,
  onSaveLoadDumpCondition,
}: {
  netlist: string;
  onPopOut?: () => void;
  uiTheme?: UiTheme;
  controlRef?: MutableRefObject<SimControlApi | null>;
  onRunStateChange?: (state: SimRunState) => void;
  /** Fired after each run/stop so the canvas can show probe hover values. */
  onSimResult?: (result: SimResult | null) => void;
  /** Circuit analysis directives (e.g. .tran) — edited via UI, not raw SPICE. */
  directives?: string[];
  onDirectivesChange?: (dirs: string[]) => void;
  /** Last run kept in App — restores waveforms if this panel remounts. */
  retainedResult?: SimResult | null;
  /** Apply load-dump working conditions to schematic + directives. */
  onLoadDumpConditionsChange?: (
    c: LoadDumpConditions,
    opts?: {
      diodeModel?: {
        pn: string;
        slot: LoadDumpDiodeSlot;
        kind: "DTVS" | "DTVSBI";
      };
    },
  ) => void;
  /** Rename active tab + Save schematic/netlist/models/last Run for this condition. */
  onSaveLoadDumpCondition?: (title: string) => void | Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const probeCanvasRef = useRef<HTMLCanvasElement>(null);
  const probeChartRef = useRef<Chart | null>(null);
  const stackedRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const stackedChartsRef = useRef<Chart[]>([]);
  const panelRootRef = useRef<HTMLDivElement | null>(null);
  const navDisposersRef = useRef<Array<() => void>>([]);
  const abortRef = useRef<AbortController | null>(null);
  const abortReasonRef = useRef<"pause" | "stop" | null>(null);
  const [runState, setRunState] = useState<SimRunState>("idle");
  const runStateRef = useRef<SimRunState>("idle");
  const [engine, setEngine] = useState<SimEngine>("D2SPICE");
  const [result, setResult] = useState<SimResult | null>(() => retainedResult ?? null);
  /** Trace names toggled off on the Simulation (all signals) graph. */
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(() => new Set());
  const hiddenSeriesRef = useRef(hiddenSeries);
  hiddenSeriesRef.current = hiddenSeries;
  /** Trace names toggled off on the Probe / waveform graph. */
  const [hiddenProbeSeries, setHiddenProbeSeries] = useState<Set<string>>(() => new Set());
  const hiddenProbeSeriesRef = useRef(hiddenProbeSeries);
  hiddenProbeSeriesRef.current = hiddenProbeSeries;
  /** Stack applies to the Probe graph only. */
  const [plotLayout, setPlotLayout] = useState<PlotLayout>("overlay");
  const [exprDraft, setExprDraft] = useState("");
  const [exprError, setExprError] = useState<string | null>(null);
  const [cursorT, setCursorT] = useState<number | null>(null);
  const cursorTRef = useRef<number | null>(null);
  cursorTRef.current = cursorT;
  /** Which plot owns the live hover readout (not synced across graphs). */
  const [hoverChartId, setHoverChartId] = useState<string | null>(null);
  const hoverChartIdRef = useRef<string | null>(null);
  hoverChartIdRef.current = hoverChartId;
  const [cursorA, setCursorA] = useState<number | null>(null);
  const [cursorB, setCursorB] = useState<number | null>(null);
  const cursorARef = useRef<number | null>(null);
  const cursorBRef = useRef<number | null>(null);
  cursorARef.current = cursorA;
  cursorBRef.current = cursorB;
  const netlistRef = useRef(netlist);
  netlistRef.current = netlist;
  const probeSel = useProbeSelectionOptional();
  const probes = probeSel?.probes ?? [];
  const probeFeedback = probeSel?.feedback ?? null;
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const onRunStateChangeRef = useRef(onRunStateChange);
  onRunStateChangeRef.current = onRunStateChange;
  const onSimResultRef = useRef(onSimResult);
  onSimResultRef.current = onSimResult;

  const tranLine = (directives ?? []).find((d) => /^\.tran\b/i.test(d));
  const { step: tranStep, stop: tranStop } = parseTranLine(tranLine);
  const tranStopRef = useRef<HTMLInputElement | null>(null);

  const updateTran = (step: string, stop: string) => {
    onDirectivesChange?.(setTranInDirectives(directives, step, stop));
  };

  const [wc, setWc] = useState<LoadDumpConditions>(() =>
    parseLoadDumpFromNetlist(netlist),
  );
  const wcApplyingRef = useRef(false);
  const wcRef = useRef(wc);
  wcRef.current = wc;

  useEffect(() => {
    if (wcApplyingRef.current) return;
    const parsed = parseLoadDumpFromNetlist(netlist);
    setWc((prev) => (conditionsEqual(prev, parsed) ? prev : parsed));
  }, [netlist]);

  const patchWc = (patch: Partial<LoadDumpConditions>) => {
    setWc((prev) => {
      const next = { ...prev, ...patch };
      wcRef.current = next;
      return next;
    });
  };

  const commitWc = () => {
    if (!onLoadDumpConditionsChange) return;
    wcApplyingRef.current = true;
    onLoadDumpConditionsChange(wcRef.current);
    window.setTimeout(() => {
      wcApplyingRef.current = false;
    }, 0);
  };

  const [partNumberId, setPartNumberId] = useState("");

  /** Apply a PN table row: diode model + UA/Us/Ri/td (+ recommended pulse). */
  const applyPartNumberPreset = (id: string) => {
    setPartNumberId(id);
    if (!id || !onLoadDumpConditionsChange) return;
    const preset = findLoadDumpPreset(id);
    if (!preset) return;
    wcApplyingRef.current = true;
    // Keep pulse/shape from the table row’s recommended profile; numbers come from the row.
    const next = { ...preset.conditions, pulse: preset.pulse };
    setWc(next);
    wcRef.current = next;
    onLoadDumpConditionsChange(next, {
      diodeModel: {
        pn: preset.pn,
        slot: preset.diodeSlot,
        kind: preset.diodeKind,
      },
    });
    window.setTimeout(() => {
      wcApplyingRef.current = false;
    }, 0);
  };

  /** Change pulse equation only — does not clear the selected part number. */
  const applyPulse = (pulse: LoadDumpPulseId) => {
    if (!onLoadDumpConditionsChange) return;
    const next = { ...wcRef.current, pulse: normalizePulseId(pulse) };
    wcApplyingRef.current = true;
    setWc(next);
    wcRef.current = next;
    onLoadDumpConditionsChange(next);
    window.setTimeout(() => {
      wcApplyingRef.current = false;
    }, 0);
  };

  const saveCondition = () => {
    if (!onSaveLoadDumpCondition) return;
    const name = loadDumpConditionSaveName(partNumberId, wcRef.current);
    void onSaveLoadDumpCondition(name);
  };

  /** Controlled preset — boxes stay editable for any custom step/stop. */
  const tranPreset =
    tranStep === "1u" && (tranStop === "1m" || tranStop === "0.001")
      ? "fast"
      : tranStep === "250u" && (tranStop === "1" || tranStop === "1s")
        ? "loaddump"
        : "custom";

  const publishResult = (next: SimResult | null) => {
    setResult(next);
    setHiddenSeries(new Set());
    onSimResultRef.current?.(next);
  };

  const setState = (next: SimRunState) => {
    runStateRef.current = next;
    setRunState(next);
    onRunStateChangeRef.current?.(next);
  };

  const play = () => {
    if (runStateRef.current === "running") return;
    abortReasonRef.current = null;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setState("running");
    publishResult(null);
    void (async () => {
      try {
        const next = await runSimulation(netlistRef.current, {
          engine: engineRef.current,
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        publishResult(next);
        setState("idle");
      } catch {
        if (!ac.signal.aborted) setState("idle");
      }
    })();
  };

  const pause = () => {
    if (runStateRef.current !== "running") return;
    abortReasonRef.current = "pause";
    abortRef.current?.abort();
    abortRef.current = null;
    setState("paused");
  };

  const stop = () => {
    if (runStateRef.current === "idle") return;
    abortReasonRef.current = "stop";
    abortRef.current?.abort();
    abortRef.current = null;
    publishResult(null);
    setState("idle");
  };

  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = {
      play,
      pause,
      stop,
      getState: () => runStateRef.current,
    };
    return () => {
      if (controlRef.current) controlRef.current = null;
      onRunStateChangeRef.current?.("idle");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlRef]);

  const disposeCharts = () => {
    for (const d of navDisposersRef.current) d();
    navDisposersRef.current = [];
    chartRef.current?.destroy();
    chartRef.current = null;
    probeChartRef.current?.destroy();
    probeChartRef.current = null;
    for (const c of stackedChartsRef.current) c.destroy();
    stackedChartsRef.current = [];
  };

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      disposeCharts();
    };
  }, []);

  // Keep Chart.js canvases filling the panel when the floating window is resized.
  useEffect(() => {
    const el = panelRootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const resizeAll = () => {
      chartRef.current?.resize();
      probeChartRef.current?.resize();
      for (const c of stackedChartsRef.current) c.resize();
    };

    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(resizeAll);
      });
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    window.addEventListener("resize", schedule);
    el.addEventListener("fw-resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      el.removeEventListener("fw-resize", schedule);
    };
  }, []);

  useLayoutEffect(() => {
    disposeCharts();

    if (!result?.series.length) return;

    const cursorOpts = {
      getCursors: (id: string) => ({
        a: cursorARef.current,
        b: cursorBRef.current,
        hover: hoverChartIdRef.current === id ? cursorTRef.current : null,
      }),
      onHoverTime: (id: string, t: number | null) => {
        if (t == null) {
          if (hoverChartIdRef.current === id) {
            hoverChartIdRef.current = null;
            setHoverChartId(null);
            setCursorT(null);
          }
          return;
        }
        hoverChartIdRef.current = id;
        setHoverChartId(id);
        setCursorT(t);
      },
      onPickTime: (t: number, which: "a" | "b") => {
        if (which === "b") setCursorB(t);
        else setCursorA(t);
      },
      navDisposers: navDisposersRef,
    };
    const hidden = hiddenSeriesRef.current;

    // Graph 1 — full simulation results (always).
    const simSeries = result.series;
    const simLabels = legendLabelsForSeries(simSeries, netlistRef.current);
    if (canvasRef.current) {
      const hasV = simSeries.some((s) => isVoltageSignalName(s.name));
      const hasI = simSeries.some((s) => isCurrentSignalName(s.name));
      chartRef.current = makeLineChart(canvasRef.current, simSeries, simLabels, {
        dualAxis: hasV && hasI,
        hidden,
        chartId: "sim",
        ...cursorOpts,
      });
    }

    // Graph 2 — probe / expression traces only.
    const probed =
      probes.length > 0
        ? resolveProbedSeries(result.series, probes).series
        : [];

    if (probed.length && plotLayout === "stacked") {
      const charts: Chart[] = [];
      const probeHidden = hiddenProbeSeriesRef.current;
      probed.forEach((s, paneIdx) => {
        const canvas = stackedRefs.current[paneIdx];
        if (!canvas) return;
        charts.push(
          makeLineChart(canvas, [s], [s.name], {
            dualAxis: false,
            hidden: probeHidden,
            colorOffset: paneIdx,
            showXTitle: paneIdx === probed.length - 1,
            chartId: `stack-${paneIdx}`,
            ...cursorOpts,
          }),
        );
      });
      stackedChartsRef.current = charts;
      return;
    }

    if (probed.length && probeCanvasRef.current) {
      const hasV = probed.some((s) => isVoltageSignalName(s.name));
      const hasI = probed.some((s) => isCurrentSignalName(s.name));
      probeChartRef.current = makeLineChart(
        probeCanvasRef.current,
        probed,
        probed.map((s) => s.name),
        {
          dualAxis: hasV && hasI,
          hidden: hiddenProbeSeriesRef.current,
          chartId: "probe",
          ...cursorOpts,
        },
      );
    }
  }, [result, uiTheme, probes, plotLayout, hiddenSeries]);

  // Redraw cursor overlays without rebuilding charts (keeps box-zoom).
  useEffect(() => {
    chartRef.current?.update("none");
    probeChartRef.current?.update("none");
    for (const c of stackedChartsRef.current) c.update("none");
  }, [cursorA, cursorB, cursorT, hoverChartId]);

  const probeModeOn = Boolean(probeSel?.probeMode);
  const simSeries: SimSeries[] = result?.series.length ? result.series : [];
  const simLabels = legendLabelsForSeries(simSeries, netlist);
  const probeSeries: SimSeries[] =
    result?.series.length && probes.length > 0
      ? resolveProbedSeries(result.series, probes).series
      : [];

  const toggleSeries = (name: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      const chart = chartRef.current;
      if (chart) {
        const idx = simSeries.findIndex((d) => d.name === name);
        if (idx >= 0) {
          chart.setDatasetVisibility(idx, !next.has(name));
          chart.update("none");
        }
      }
      return next;
    });
  };

  const toggleProbeSeries = (name: string) => {
    setHiddenProbeSeries((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      const visible = !next.has(name);
      const probeChart = probeChartRef.current;
      if (probeChart) {
        const idx = probeSeries.findIndex((d) => d.name === name);
        if (idx >= 0) {
          probeChart.setDatasetVisibility(idx, visible);
          probeChart.update("none");
        }
      }
      stackedChartsRef.current.forEach((c, i) => {
        if (probeSeries[i]?.name === name) {
          c.setDatasetVisibility(0, visible);
          c.update("none");
        }
      });
      return next;
    });
  };
  const busy = runState === "running";
  const hasChart = Boolean(result?.ok && result.series.length);
  /** Probe pane only after Probe ON (or if traces already exist so turning Probe off keeps the plot). */
  const showProbePane = Boolean(probeSel && (probeModeOn || probes.length > 0));
  const badge =
    result?.source === "fleet"
      ? "fleet"
      : result?.source === "demo"
        ? "demo"
        : `${engine} · Chart.js`;

  const doZoom = (mode: ZoomMode) => {
    const c = chartRef.current;
    if (c) zoomChart(c, mode, 0.65);
    if (probeChartRef.current) zoomChart(probeChartRef.current, mode, 0.65);
    for (const sc of stackedChartsRef.current) zoomChart(sc, mode, 0.65);
  };

  const doAutoScale = () => {
    const c = chartRef.current;
    if (c) autoScaleChart(c);
    if (probeChartRef.current) autoScaleChart(probeChartRef.current);
    for (const sc of stackedChartsRef.current) autoScaleChart(sc);
  };

  const submitExpression = () => {
    if (!probeSel) return;
    const draft = exprDraft.trim();
    if (!draft) {
      setExprError("Enter an expression");
      return;
    }
    if (result?.series.length) {
      const ev = evaluateProbeExpression(draft, result.series);
      if (ev.error) {
        setExprError(ev.error);
        return;
      }
    }
    const r = probeSel.addExpression(draft);
    if (!r.ok) {
      setExprError(r.message);
      return;
    }
    setExprError(null);
    setExprDraft("");
  };

  const cursorReadout = (() => {
    if (cursorA != null && cursorB != null) {
      return `A=${formatTimeAxis(cursorA)}  B=${formatTimeAxis(cursorB)}  Δt=${formatTimeAxis(Math.abs(cursorB - cursorA))}`;
    }
    if (cursorA != null) return `A=${formatTimeAxis(cursorA)} · click+Shift for B`;
    if (cursorT == null) return null;
    const series = probeSeries.length ? probeSeries : simSeries;
    if (!series.length) return null;
    return series
      .filter((s) => !hiddenSeries.has(s.name))
      .map((s) => {
        const y = nearestY(s, cursorT);
        if (y == null) return null;
        const unit = isCurrentSignalName(s.name) ? "A" : "V";
        return `${s.name}=${formatProbeValue(y, unit)}`;
      })
      .filter(Boolean)
      .join("  ");
  })();

  return (
    <div
      ref={panelRootRef}
      className={`sim-panel${busy ? " is-running" : ""}`}
      aria-busy={busy}
    >
      <div className="panel-header sim-toolbar">
        <div className="sim-toolbar-actions">
          <div className="sim-toolbar-run-group" role="group" aria-label="Simulation controls">
            <button
              type="button"
              className={`sim-run-btn${busy ? " is-running" : ""}`}
              disabled={busy}
              onClick={() => play()}
              title="Run simulation with the .tran time set on the right"
            >
              {busy ? "Running…" : runState === "paused" ? "Resume" : "Run"}
            </button>
            <button
              type="button"
              className="sim-stop-btn"
              disabled={runState === "idle"}
              onClick={() => stop()}
              title={runState === "idle" ? "Stop (idle)" : "Stop simulation"}
            >
              Stop
            </button>
          </div>
        </div>

        <div
          className="sim-wc-card"
          title="Part number sets D1/D2 model + UA/Us/Ri/td. Pulse sets the waveform equation. Editing numbers keeps both."
        >
          <div className="sim-wc-fields">
            <label
              className="sim-wc-field sim-wc-preset"
              title="Part number → diode model (XFD→D1, SM→D2) and fills UA/Us/Ri/td for that row"
            >
              <span className="sim-wc-lab">Part number</span>
              <select
                className="sim-wc-select"
                value={partNumberId}
                disabled={busy || !onLoadDumpConditionsChange}
                aria-label="TVS / clamp part number"
                onChange={(e) => applyPartNumberPreset(e.target.value)}
              >
                <option value="">—</option>
                <optgroup label="D2 · SM…">
                  {LOAD_DUMP_PRESETS.filter((p) => p.diodeSlot === "D2").map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="D1 · XFD…">
                  {LOAD_DUMP_PRESETS.filter((p) => p.diodeSlot === "D1").map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label
              className="sim-wc-field sim-wc-pulse"
              title={
                LOAD_DUMP_PULSES.find((p) => p.id === normalizePulseId(wc.pulse))?.tip ??
                "Test pulse profile (equation/shape). Changing UA/Us/Ri does not make this Custom."
              }
            >
              <span className="sim-wc-lab">Pulse</span>
              <select
                className="sim-wc-select sim-wc-select-pulse"
                value={normalizePulseId(wc.pulse)}
                disabled={busy || !onLoadDumpConditionsChange}
                aria-label="Load-dump test pulse profile"
                onChange={(e) => applyPulse(e.target.value as LoadDumpPulseId)}
              >
                {LOAD_DUMP_PULSES.map((p) => (
                  <option key={p.id} value={p.id} title={p.tip}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {(
              [
                [
                  "usPeak",
                  "Us",
                  "V",
                  normalizePulseId(wc.pulse) === "ISO7637_5A"
                    ? "Us = amplitude above UA (ISO 7637-5a). Editing keeps the same pulse profile."
                    : "Us = absolute peak Uspk (ISO 16750-2 A). Editing keeps the same pulse profile.",
                ],
                ["uaSupply", "Ua", "V", "Supply UA — editing keeps Part number and Pulse"],
                ["ri", "Ri", "Ω", "Source resistance — editing keeps Part number and Pulse"],
                ["trMs", "tr", "ms", "Rise time — editing keeps Part number and Pulse"],
                ["tdMs", "td", "ms", "Decay td — editing keeps Part number and Pulse"],
                ["simStopMs", "stop", "ms", "Simulation stop time"],
              ] as const
            ).map(([key, lab, unit, tip]) => (
              <label key={key} className="sim-wc-field" title={tip}>
                <span className="sim-wc-lab">
                  {lab}
                  <span className="sim-wc-unit">{unit}</span>
                </span>
                <input
                  className="sim-wc-input"
                  value={wc[key]}
                  disabled={busy || !onLoadDumpConditionsChange}
                  aria-label={tip}
                  onChange={(e) => {
                    // Keep Part number + Pulse: number edits are variables, not a custom shape.
                    patchWc({ [key]: e.target.value });
                  }}
                  onBlur={() => commitWc()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
              </label>
            ))}
            {onSaveLoadDumpCondition && (
              <button
                type="button"
                className="sim-wc-save-btn"
                disabled={busy}
                title="Save project: schematic + netlist + models + results (names the project from this setup)"
                onClick={() => saveCondition()}
              >
                Save project
              </button>
            )}
          </div>
        </div>

        <div className="panel-header-right sim-toolbar-setup">
          <div
            className="sim-tran-fields"
            title="Writes .tran <step> <stop> into the netlist. Set time, then click Run."
          >
            <span className="sim-tran-label">.tran</span>
            <input
              className="sim-tran-input"
              value={tranStep}
              disabled={busy || !onDirectivesChange}
              aria-label="Time step"
              title="Step (e.g. 1u or 250u) — not the end time"
              onChange={(e) => updateTran(e.target.value, tranStop)}
            />
            <span className="sim-tran-sep">→</span>
            <input
              ref={tranStopRef}
              className="sim-tran-input sim-tran-input-stop"
              value={tranStop}
              disabled={busy || !onDirectivesChange}
              aria-label="Stop time"
              title="Stop time — type any value (1m, 1, 10, …)"
              onChange={(e) => updateTran(tranStep, e.target.value)}
            />
            <select
              className="sim-tran-preset"
              disabled={busy || !onDirectivesChange}
              value={tranPreset}
              aria-label="Simulation duration preset"
              title="Presets fill the boxes; Custom = edit them yourself. Run does not start until you click Run."
              onChange={(e) => {
                const v = e.target.value;
                if (v === "fast") updateTran("1u", "1m");
                else if (v === "loaddump") updateTran("250u", "1");
                else if (v === "custom") {
                  window.setTimeout(() => {
                    tranStopRef.current?.focus();
                    tranStopRef.current?.select();
                  }, 0);
                }
              }}
            >
              <option value="fast">Quick (1 ms)</option>
              <option value="loaddump">Load dump (1 s)</option>
              <option value="custom">Custom…</option>
            </select>
          </div>
          <select
            className="sim-engine"
            value={engine}
            disabled={busy}
            title="D1SPICE = ngspice · D2SPICE = QSPICE (fleet aliases)"
            onChange={(e) => setEngine(e.target.value as SimEngine)}
          >
            <option value="D2SPICE">D2SPICE</option>
            <option value="D1SPICE">D1SPICE</option>
          </select>
          <span className="badge">{badge}</span>
          {result?.ok && probeSel && (
            <button
              type="button"
              className={`sim-probe-btn${probeSel.probeMode ? " is-on" : ""}`}
              disabled={busy}
              title={
                probeSel.probeMode
                  ? "Probe ON — click schematic: wire=V, part=I, Ctrl+wire=differential"
                  : "Show Probe / waveform pane and click the schematic to add traces"
              }
              aria-pressed={probeSel.probeMode}
              onClick={() => probeSel.setProbeMode(!probeSel.probeMode)}
            >
              <img src="/icons/probe-red.png" alt="" width={12} height={24} />
              <span>{probeSel.probeMode ? "Probe ON" : "Probe"}</span>
            </button>
          )}
          {onPopOut && (
            <button
              type="button"
              className="ghost-btn pop-out-btn"
              onClick={onPopOut}
              title="Open in a floating window"
            >
              ⤢
            </button>
          )}
        </div>
      </div>
      <div className="sim-body">
        {busy && (
          <div className="netlist-status sim-running-status" role="status" aria-live="polite">
            <span className="sim-running-spinner" aria-hidden />
            Simulating with {engine}… results will appear when finished
          </div>
        )}
        {result && !busy && result.fromSavedCondition && (
          <div className="netlist-status sim-saved-result-banner" role="status">
            Saved plot — not from this Run
            {(() => {
              const summary =
                result.conditionsSummary?.trim() ||
                formatLoadDumpConditionsSummary(wc);
              return summary ? ` (${summary})` : "";
            })()}
            . Click <strong>Run</strong> to simulate the current schematic.
          </div>
        )}
        {result && !busy && !result.fromSavedCondition && (
          <div
            className={`netlist-status${
              result.ok
                ? result.warnings?.length
                  ? " netlist-status-warn"
                  : ""
                : " netlist-status-error"
            }`}
          >
            {result.message}
          </div>
        )}
        {probeFeedback && (
          <div
            className={`netlist-status${probeFeedback.ok ? "" : " netlist-status-error"}`}
            role="status"
          >
            {probeFeedback.message}
          </div>
        )}
        {runState === "paused" && !result && (
          <div className="netlist-status">Simulation paused</div>
        )}
        {hasChart && (
          <div className="sim-chart-toolbar" role="toolbar" aria-label="Waveform zoom">
            <button type="button" className="sim-zoom-btn sim-zoom-btn-icon" title="Zoom X" aria-label="Zoom X" onClick={() => doZoom("x")}>
              <ZoomXIcon />
            </button>
            <button type="button" className="sim-zoom-btn sim-zoom-btn-icon" title="Zoom Y" aria-label="Zoom Y" onClick={() => doZoom("y")}>
              <ZoomYIcon />
            </button>
            <button type="button" className="sim-zoom-btn sim-zoom-btn-icon" title="Zoom XY" aria-label="Zoom XY" onClick={() => doZoom("xy")}>
              <ZoomXYIcon />
            </button>
            <button
              type="button"
              className="sim-zoom-btn sim-zoom-btn-icon"
              title="Auto scale XY"
              aria-label="Auto scale XY"
              onClick={doAutoScale}
            >
              <AutoScaleIcon />
            </button>
            {showProbePane && (
              <button
                type="button"
                className={`sim-zoom-btn${plotLayout === "stacked" ? " is-on" : ""}`}
                title="Stack probe traces (bottom graph)"
                aria-pressed={plotLayout === "stacked"}
                onClick={() =>
                  setPlotLayout((p) => (p === "stacked" ? "overlay" : "stacked"))
                }
              >
                <span className="sim-zoom-lab">
                  {plotLayout === "stacked" ? "Stacked" : "Stack"}
                </span>
              </button>
            )}
            {showProbePane && probes.length > 0 && probeSel && (
              <button
                type="button"
                className="sim-zoom-btn"
                title="Clear all probes from the bottom graph"
                onClick={() => probeSel.clearProbes()}
              >
                <span className="sim-zoom-lab">Clear probes</span>
              </button>
            )}
            {(cursorA != null || cursorB != null) && (
              <button
                type="button"
                className="sim-zoom-btn"
                title="Clear plot cursors A/B"
                onClick={() => {
                  setCursorA(null);
                  setCursorB(null);
                }}
              >
                <span className="sim-zoom-lab">Clear cursors</span>
              </button>
            )}
            {probeModeOn && (
              <span className="sim-probe-hint">Probe ready — click / drag on schematic</span>
            )}
            {probes.length > 0 && (
              <span className="sim-probe-hint">
                {probes.length} probe{probes.length === 1 ? "" : "s"}
              </span>
            )}
            {cursorReadout && (
              <span className="sim-cursor-readout" title="Cursor readout">
                {cursorA == null && cursorB == null && cursorT != null
                  ? `t=${formatTimeAxis(cursorT)} · `
                  : ""}
                {cursorReadout}
              </span>
            )}
          </div>
        )}
        {hasChart && showProbePane && (
          <div className="sim-expr-row" role="group" aria-label="Plot expression">
            <input
              className="sim-expr-input"
              value={exprDraft}
              placeholder='Expression e.g. V(out)  or  V(out)-V(in)'
              aria-label="Waveform expression"
              onChange={(e) => {
                setExprDraft(e.target.value);
                setExprError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitExpression();
                }
              }}
            />
            <button
              type="button"
              className="sim-zoom-btn"
              title="Add expression to the Probe graph"
              onClick={submitExpression}
            >
              <span className="sim-zoom-lab">Add expr</span>
            </button>
            {exprError && <span className="sim-expr-error">{exprError}</span>}
          </div>
        )}

        <div className={`sim-charts-split${showProbePane ? " has-probe" : ""}`}>
          <section className="sim-chart-section" aria-label="Simulation results">
            <div className="sim-chart-section-head">Simulation results (all signals)</div>
            {hasChart && simSeries.length ? (
              <div className="sim-legend" role="group" aria-label="Simulation traces">
                {simSeries.map((s, i) => {
                  const on = !hiddenSeries.has(s.name);
                  const color = colorForSignalName(s.name) || seriesColor(i);
                  const label = simLabels[i] ?? s.name;
                  return (
                    <button
                      key={s.name}
                      type="button"
                      className={`sim-legend-chip${on ? "" : " is-off"}`}
                      aria-pressed={on}
                      title={on ? `Hide ${label}` : `Show ${label}`}
                      onClick={() => toggleSeries(s.name)}
                    >
                      <span className="sim-legend-swatch" style={{ background: color }} />
                      <span className="sim-legend-name">{label}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className="sim-chart-wrap sim-chart-ltspice">
              {simSeries.length ? <canvas ref={canvasRef} /> : null}
              {busy && (
                <div className="sim-running-overlay" role="status">
                  <span className="sim-running-spinner" aria-hidden />
                  <span>Simulating with {engine}…</span>
                </div>
              )}
              {!result && !busy && runState !== "paused" && (
                <div className="sim-placeholder">Press Run to simulate</div>
              )}
            </div>
          </section>

          {showProbePane && (
          <section className="sim-chart-section is-probe" aria-label="Probe waveform">
            <div className="sim-chart-section-head">
              Probe / waveform
              {probeSeries.length ? (
                <span className="sim-legend sim-legend-inline">
                  {probeSeries.map((s) => {
                    const on = !hiddenProbeSeries.has(s.name);
                    const color = colorForSignalName(s.name);
                    return (
                      <button
                        key={s.name}
                        type="button"
                        className={`sim-legend-chip${on ? "" : " is-off"}`}
                        aria-pressed={on}
                        title={
                          on
                            ? `Hide ${s.name} (right-click to remove probe)`
                            : `Show ${s.name} (right-click to remove probe)`
                        }
                        onClick={() => toggleProbeSeries(s.name)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          probeSel?.removeProbeByKey(s.name);
                        }}
                      >
                        <span
                          className="sim-legend-swatch"
                          style={{ background: color }}
                        />
                        <span className="sim-legend-name">{s.name}</span>
                      </button>
                    );
                  })}
                </span>
              ) : null}
            </div>
            <div
              className={`sim-chart-wrap sim-chart-ltspice${plotLayout === "stacked" ? " sim-chart-stacked" : ""}`}
            >
              {plotLayout === "stacked" && probeSeries.length
                ? probeSeries.map((s, i) => (
                    <div key={s.name} className="sim-chart-pane">
                      <canvas
                        ref={(el) => {
                          stackedRefs.current[i] = el;
                        }}
                      />
                    </div>
                  ))
                : probeSeries.length
                  ? <canvas ref={probeCanvasRef} />
                  : null}
              {result?.ok && !probes.length && (
                <div className="sim-placeholder">
                  {probeModeOn
                    ? "Click a wire (voltage) or part (current) on the schematic"
                    : "Turn Probe ON, then click the schematic"}
                </div>
              )}
              {result?.ok && probes.length > 0 && !probeSeries.length && (
                <div className="sim-placeholder">
                  Probed signals not in results — try another net/part
                </div>
              )}
            </div>
          </section>
          )}
        </div>

        {hasChart && (cursorA != null || cursorB != null) && (
          <div className="sim-cursor-table-wrap" role="region" aria-label="Cursor readout">
            <table className="sim-cursor-table">
              <thead>
                <tr>
                  <th>Trace</th>
                  <th>A{cursorA != null ? ` @ ${formatTimeAxis(cursorA)}` : ""}</th>
                  <th>B{cursorB != null ? ` @ ${formatTimeAxis(cursorB)}` : ""}</th>
                  <th>Δ (B−A)</th>
                </tr>
              </thead>
              <tbody>
                {(probeSeries.length ? probeSeries : simSeries)
                  .filter((s) => !hiddenSeries.has(s.name))
                  .map((s) => {
                    const ya = cursorA != null ? nearestY(s, cursorA) : null;
                    const yb = cursorB != null ? nearestY(s, cursorB) : null;
                    const unit = isCurrentSignalName(s.name) ? "A" : "V";
                    const color = colorForSignalName(s.name);
                    return (
                      <tr key={s.name}>
                        <td>
                          <span className="sim-legend-swatch" style={{ background: color }} />
                          <span style={{ color }}>{s.name}</span>
                        </td>
                        <td>{ya == null ? "—" : formatProbeValue(ya, unit)}</td>
                        <td>{yb == null ? "—" : formatProbeValue(yb, unit)}</td>
                        <td>
                          {ya == null || yb == null
                            ? "—"
                            : formatProbeValue(yb - ya, unit)}
                        </td>
                      </tr>
                    );
                  })}
                {cursorA != null && cursorB != null && (
                  <tr className="sim-cursor-table-delta">
                    <td colSpan={3}>Δt</td>
                    <td>{formatTimeAxis(Math.abs(cursorB - cursorA))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
