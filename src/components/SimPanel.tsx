/**
 * SimPanel — Run + Chart.js waveforms + zoom toolbar + probe result callback.
 */
import { useEffect, useRef, useState, type MutableRefObject } from "react";
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
import { SicComparePanel } from "./SicComparePanel";
import { legendLabelsForSeries, runSimulation, type SimEngine, type SimResult, type SimSeries } from "../sim/runSimulation";
import { useProbeSelectionOptional } from "../sim/ProbeContext";
import {
  isCurrentSignalName,
  isVoltageSignalName,
  resolveProbedSeries,
} from "../sim/probeSelection";
import { cssVar, type UiTheme } from "../theme";

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

type ZoomMode = "x" | "y" | "xy";

/** High-contrast palette so many traces stay distinguishable. */
const SERIES_COLORS = [
  "#1d4ed8",
  "#047857",
  "#c2410c",
  "#b91c1c",
  "#6d28d9",
  "#0e7490",
  "#c2410c",
  "#be185d",
];

function seriesColor(i: number): string {
  return SERIES_COLORS[i % SERIES_COLORS.length]!;
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

export function SimPanel({
  netlist,
  onPopOut,
  uiTheme = "dark",
  controlRef,
  onRunStateChange,
  onSimResult,
}: {
  netlist: string;
  onPopOut?: () => void;
  uiTheme?: UiTheme;
  controlRef?: MutableRefObject<SimControlApi | null>;
  onRunStateChange?: (state: SimRunState) => void;
  /** Fired after each run/stop so the canvas can show probe hover values. */
  onSimResult?: (result: SimResult | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const abortReasonRef = useRef<"pause" | "stop" | null>(null);
  const [runState, setRunState] = useState<SimRunState>("idle");
  const runStateRef = useRef<SimRunState>("idle");
  const [engine, setEngine] = useState<SimEngine>("D2SPICE");
  const [result, setResult] = useState<SimResult | null>(null);
  /** Trace names the user has toggled off in the legend. */
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(() => new Set());
  const hiddenSeriesRef = useRef(hiddenSeries);
  hiddenSeriesRef.current = hiddenSeries;
  const [tab, setTab] = useState<"circuit" | "sic">("circuit");
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
    };
  }, []);

  useEffect(() => {
    if (!result?.series.length || !canvasRef.current) {
      chartRef.current?.destroy();
      chartRef.current = null;
      return;
    }

    const probing = probes.length > 0;
    let plotSeries: SimSeries[] = result.series;
    let labels: string[] = legendLabelsForSeries(result.series, netlistRef.current);

    if (probing) {
      const resolved = resolveProbedSeries(result.series, probes);
      plotSeries = resolved.series;
      labels = plotSeries.map((s) => s.name); // LTspice-style V(net) / I(ref) / V(a,b)
    }

    if (!plotSeries.length) {
      chartRef.current?.destroy();
      chartRef.current = null;
      return;
    }

    const hasV = plotSeries.some((s) => isVoltageSignalName(s.name));
    const hasI = plotSeries.some((s) => isCurrentSignalName(s.name));
    const dualAxis = probing && hasV && hasI;

    chartRef.current?.destroy();
    const muted = cssVar("--chart-muted", "#8b98a5");
    const grid = cssVar("--chart-grid", "#2a323d");
    const text = cssVar("--text", "#e8eef5");
    const hidden = hiddenSeriesRef.current;

    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        datasets: plotSeries.map((s, i) => {
          const isI = isCurrentSignalName(s.name);
          return {
            label: labels[i] ?? s.name,
            data: s.x.map((x, j) => ({ x, y: s.y[j] ?? 0 })),
            borderColor: seriesColor(i),
            backgroundColor: "transparent",
            pointRadius: 0,
            borderWidth: 3.5,
            borderCapStyle: "round" as const,
            borderJoinStyle: "round" as const,
            tension: 0.05,
            hidden: hidden.has(s.name),
            yAxisID: dualAxis ? (isI ? "y1" : "y") : "y",
          };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            type: "linear",
            title: {
              display: true,
              text: "t (s)",
              color: text,
              font: { size: 12, weight: 700 },
            },
            ticks: {
              color: muted,
              maxTicksLimit: 6,
              font: { size: 11, weight: 600 },
            },
            grid: { color: grid, lineWidth: 1.25 },
            border: { color: muted, width: 1.5 },
          },
          y: {
            type: "linear",
            position: "left",
            title: {
              display: true,
              text: dualAxis ? "V" : "V / I",
              color: text,
              font: { size: 12, weight: 700 },
            },
            ticks: {
              color: muted,
              font: { size: 11, weight: 600 },
            },
            grid: { color: grid, lineWidth: 1.25 },
            border: { color: muted, width: 1.5 },
          },
          ...(dualAxis
            ? {
                y1: {
                  type: "linear" as const,
                  position: "right" as const,
                  title: {
                    display: true,
                    text: "I (A)",
                    color: text,
                    font: { size: 12, weight: 700 },
                  },
                  ticks: {
                    color: muted,
                    font: { size: 11, weight: 600 },
                  },
                  grid: { drawOnChartArea: false },
                  border: { color: muted, width: 1.5 },
                },
              }
            : {}),
        },
      },
    });
  }, [result, uiTheme, probes]);

  const displaySeries: SimSeries[] = (() => {
    if (!result?.series.length) return [];
    if (!probes.length) return result.series;
    return resolveProbedSeries(result.series, probes).series;
  })();

  const displayLabels =
    probes.length > 0
      ? displaySeries.map((s) => s.name)
      : legendLabelsForSeries(displaySeries, netlist);

  const toggleSeries = (name: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      const chart = chartRef.current;
      if (chart) {
        const idx = displaySeries.findIndex((d) => d.name === name);
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
    if (!c) return;
    zoomChart(c, mode, 0.65);
  };

  return (
    <div className="sim-panel">
      <div className="panel-header">
        <span className="sim-tabs">
          <button type="button" className={tab === "circuit" ? "sim-tab on" : "sim-tab"} onClick={() => setTab("circuit")}>
            Circuit
          </button>
          <button type="button" className={tab === "sic" ? "sim-tab on" : "sim-tab"} onClick={() => setTab("sic")}>
            SiC compare
          </button>
        </span>
        <div className="panel-header-right">
          {tab === "circuit" && (
            <>
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
                      ? "Probe ON — red pin then black pin on wires"
                      : "Turn on Probe — place red then black pins"
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
      <div className={tab === "circuit" ? "sim-body" : "sim-body sim-body-hidden"}>
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
              onClick={() => {
                const c = chartRef.current;
                if (c) autoScaleChart(c);
              }}
            >
              <AutoScaleIcon />
            </button>
            {probes.length > 0 && probeSel && (
              <button
                type="button"
                className="sim-zoom-btn"
                title="Clear probes and show all signals from the last run"
                onClick={() => probeSel.clearProbes()}
              >
                <span className="sim-zoom-lab">Show all</span>
              </button>
            )}
            {result?.ok && probeSel?.probeMode && (
              <span className="sim-probe-hint">
                {probeSel.nextPin === "red" && "Place red pin on a wire"}
                {probeSel.nextPin === "black" && "Place black pin (reference)"}
                {probeSel.nextPin === "done" && "Right-click removes pins · Shift+part = I"}
              </span>
            )}
            {result?.ok && probeSel && !probeSel.probeMode && (
              <span className="sim-probe-hint">Turn Probe ON to place pins</span>
            )}
            {probes.length > 0 && (
              <span className="sim-probe-hint">{probes.length} probe{probes.length === 1 ? "" : "s"}</span>
            )}
          </div>
        )}
        {hasChart && displaySeries.length ? (
          <div className="sim-legend" role="group" aria-label="Waveform traces">
            {displaySeries.map((s, i) => {
              const on = !hiddenSeries.has(s.name);
              const color = seriesColor(i);
              const label = displayLabels[i] ?? s.name;
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
        <div className="sim-chart-wrap">
          <canvas ref={canvasRef} />
          {!result && !busy && runState !== "paused" && (
            <div className="sim-placeholder">
              Run simulation to see a waveform
            </div>
          )}
          {result?.ok && probes.length > 0 && !displaySeries.length && (
            <div className="sim-placeholder">
              Probed signals not found in results — try another net/part or Show all
            </div>
          )}
        </div>
      </div>
      <div className={tab === "sic" ? "sim-body" : "sim-body sim-body-hidden"}>
        <SicComparePanel netlist={netlist} />
      </div>
    </div>
  );
}
