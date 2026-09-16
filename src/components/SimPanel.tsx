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
} from "../sim/probeSelection";
import { evaluateProbeExpression } from "../sim/probeExpressions";
import { formatProbeValue } from "../sim/probeHover";
import { type UiTheme } from "../theme";
import type { ChartEvent, ActiveElement, Plugin } from "chart.js";

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

/** LTspice-like high-contrast trace colors (green / blue / red / cyan / …). */
const SERIES_COLORS = [
  "#00e676",
  "#40c4ff",
  "#ff5252",
  "#ffd740",
  "#e040fb",
  "#64ffda",
  "#ffab40",
  "#82b1ff",
];

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
    getCursors: () => { a: number | null; b: number | null; hover: number | null };
    onHoverTime?: (t: number | null) => void;
    onPickTime?: (t: number, which: "a" | "b") => void;
  },
): Chart {
  const tick = "#b0b8c0";
  const grid = "rgba(180,190,200,0.28)";
  const off = opts.colorOffset ?? 0;
  return new Chart(canvas, {
    type: "line",
    data: {
      datasets: plotSeries.map((s, i) => {
        const isI = isCurrentSignalName(s.name);
        return {
          label: labels[i] ?? s.name,
          data: s.x.map((x, j) => ({ x, y: s.y[j] ?? 0 })),
          borderColor: seriesColor(i + off),
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
      onHover: (_e: ChartEvent, _els: ActiveElement[], chart: Chart) => {
        if (!opts.onHoverTime) return;
        const xScale = chart.scales.x;
        if (!xScale) return;
        const ev = _e.native as MouseEvent | undefined;
        if (!ev) {
          opts.onHoverTime(null);
          return;
        }
        const rect = chart.canvas.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        if (x < chart.chartArea.left || x > chart.chartArea.right) {
          opts.onHoverTime(null);
          return;
        }
        opts.onHoverTime(xScale.getValueForPixel(x) as number);
      },
      onClick: (_e: ChartEvent, _els: ActiveElement[], chart: Chart) => {
        if (!opts.onPickTime) return;
        const xScale = chart.scales.x;
        if (!xScale) return;
        const ev = _e.native as MouseEvent | undefined;
        if (!ev) return;
        const rect = chart.canvas.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        if (x < chart.chartArea.left || x > chart.chartArea.right) return;
        const t = xScale.getValueForPixel(x) as number;
        if (!Number.isFinite(t)) return;
        opts.onPickTime(t, ev.shiftKey || ev.button === 2 ? "b" : "a");
      },
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
            callback: (v) => formatTimeAxis(Number(v)),
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
                },
                grid: { drawOnChartArea: false },
                border: { color: tick, width: 1 },
              },
            }
          : {}),
      },
    },
    plugins: [buildTraceLabelsPlugin(), buildCursorPlugin(opts.getCursors)],
  });
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
}

function formatTimeAxis(t: number): string {
  const a = Math.abs(t);
  if (a >= 1) return `${t.toPrecision(4)} s`;
  if (a >= 1e-3) return `${(t * 1e3).toPrecision(4)} ms`;
  if (a >= 1e-6) return `${(t * 1e6).toPrecision(4)} µs`;
  return `${(t * 1e9).toPrecision(4)} ns`;
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
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const probeCanvasRef = useRef<HTMLCanvasElement>(null);
  const probeChartRef = useRef<Chart | null>(null);
  const stackedRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const stackedChartsRef = useRef<Chart[]>([]);
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
  /** Stack applies to the Probe graph only. */
  const [plotLayout, setPlotLayout] = useState<PlotLayout>("overlay");
  const [exprDraft, setExprDraft] = useState("");
  const [exprError, setExprError] = useState<string | null>(null);
  const [cursorT, setCursorT] = useState<number | null>(null);
  const cursorTRef = useRef<number | null>(null);
  cursorTRef.current = cursorT;
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

  const updateTran = (step: string, stop: string) => {
    onDirectivesChange?.(setTranInDirectives(directives, step, stop));
  };

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

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      chartRef.current?.destroy();
      chartRef.current = null;
      probeChartRef.current?.destroy();
      probeChartRef.current = null;
      for (const c of stackedChartsRef.current) c.destroy();
      stackedChartsRef.current = [];
    };
  }, []);

  useLayoutEffect(() => {
    chartRef.current?.destroy();
    chartRef.current = null;
    probeChartRef.current?.destroy();
    probeChartRef.current = null;
    for (const c of stackedChartsRef.current) c.destroy();
    stackedChartsRef.current = [];

    if (!result?.series.length) return;

    const cursorOpts = {
      getCursors: () => ({
        a: cursorARef.current,
        b: cursorBRef.current,
        hover: cursorTRef.current,
      }),
      onHoverTime: setCursorT,
      onPickTime: (t: number, which: "a" | "b") => {
        if (which === "b") setCursorB(t);
        else setCursorA(t);
      },
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
      probed.forEach((s, paneIdx) => {
        const canvas = stackedRefs.current[paneIdx];
        if (!canvas) return;
        charts.push(
          makeLineChart(canvas, [s], [s.name], {
            dualAxis: false,
            hidden: new Set(),
            colorOffset: paneIdx,
            showXTitle: paneIdx === probed.length - 1,
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
          hidden: new Set(),
          ...cursorOpts,
        },
      );
    }
  }, [result, uiTheme, probes, plotLayout, hiddenSeries, cursorA, cursorB]);

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
  const busy = runState === "running";
  const hasChart = Boolean(result?.ok && result.series.length);
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
    <div className="sim-panel">
      <div className="panel-header">
        <span className="sim-tabs">
          <span className="sim-tab on">Waveforms</span>
        </span>
        <div className="panel-header-right">
          <>
              <label className="sim-tran-fields" title="Transient analysis — written as .tran automatically">
                <span className="sim-tran-label">Sim time</span>
                <input
                  className="sim-tran-input"
                  value={tranStep}
                  disabled={busy || !onDirectivesChange}
                  aria-label="Time step"
                  title="Time step (e.g. 1u or 0.000250)"
                  onChange={(e) => updateTran(e.target.value, tranStop)}
                />
                <span className="sim-tran-sep">→</span>
                <input
                  className="sim-tran-input sim-tran-input-stop"
                  value={tranStop}
                  disabled={busy || !onDirectivesChange}
                  aria-label="Stop time"
                  title="Stop time (e.g. 1m or 1 for 1 second)"
                  onChange={(e) => updateTran(tranStep, e.target.value)}
                />
                <select
                  className="sim-tran-preset"
                  disabled={busy || !onDirectivesChange}
                  value=""
                  aria-label="Simulation duration preset"
                  onChange={(e) => {
                    const v = e.target.value;
                    e.target.value = "";
                    if (v === "fast") updateTran("1u", "1m");
                    if (v === "loaddump") updateTran("250u", "1");
                  }}
                >
                  <option value="" disabled>
                    Preset…
                  </option>
                  <option value="fast">Quick (1 ms)</option>
                  <option value="loaddump">Load dump (1 s)</option>
                </select>
              </label>
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
                  title={
                    probeSel.probeMode
                      ? "Probe ON — click schematic: wire=V, part=I, Ctrl+wire=differential"
                      : "Enable Probe, then click the schematic to add traces"
                  }
                  aria-pressed={probeSel.probeMode}
                  onClick={() => probeSel.setProbeMode(!probeSel.probeMode)}
                >
                  <img src="/icons/probe-red.png" alt="" width={12} height={24} />
                  <span>{probeSel.probeMode ? "Probe ON" : "Probe"}</span>
                </button>
              )}
              <button
                type="button"
                className="ghost-btn ghost-btn-primary"
                disabled={busy}
                onClick={() => play()}
              >
                {busy ? "Running…" : runState === "paused" ? "Resume" : "Run"}
              </button>
            </>
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
        {result && (
          <div className={`netlist-status${result.ok ? "" : " netlist-status-error"}`}>
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
          <div className="sim-howto" role="note">
            <strong>Probe like LTspice:</strong> click wire = V · click part = I · drag
            wire→wire = V(a,b) · <kbd>Ctrl</kbd>+click pins · plot click = cursor A ·{" "}
            <kbd>Shift</kbd>+click = cursor B · legend right-click removes a trace.
          </div>
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
            {probes.length > 0 && probeSel && (
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
        {hasChart && probeSel && (
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

        <div className="sim-charts-split has-probe">
          <section className="sim-chart-section" aria-label="Simulation results">
            <div className="sim-chart-section-head">Simulation results (all signals)</div>
            {hasChart && simSeries.length ? (
              <div className="sim-legend" role="group" aria-label="Simulation traces">
                {simSeries.map((s, i) => {
                  const on = !hiddenSeries.has(s.name);
                  const color = seriesColor(i);
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
              {!result && !busy && runState !== "paused" && (
                <div className="sim-placeholder">Press Run to simulate</div>
              )}
            </div>
          </section>

          <section className="sim-chart-section is-probe" aria-label="Probe waveform">
            <div className="sim-chart-section-head">
              Probe / waveform
              {probeSeries.length ? (
                <span className="sim-legend sim-legend-inline">
                  {probeSeries.map((s, i) => (
                    <button
                      key={s.name}
                      type="button"
                      className="sim-legend-chip"
                      title="Right-click to remove this probe"
                      onContextMenu={(e) => {
                        e.preventDefault();
                        probeSel?.removeProbeByKey(s.name);
                      }}
                    >
                      <span
                        className="sim-legend-swatch"
                        style={{ background: seriesColor(i) }}
                      />
                      <span className="sim-legend-name">{s.name}</span>
                    </button>
                  ))}
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
        </div>
      </div>
    </div>
  );
}
