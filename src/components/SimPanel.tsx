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
import { runSimulation, type SimEngine, type SimResult } from "../sim/runSimulation";
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

function zoomChart(chart: Chart, mode: ZoomMode, factor: number) {
  const x = chart.scales.x;
  const y = chart.scales.y;
  if (!x || !y) return;
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
  if (mode === "y" || mode === "xy") zoomAxis(y, factor);
  chart.update("none");
}

function autoScaleChart(chart: Chart) {
  const x = chart.scales.x;
  const y = chart.scales.y;
  if (x) {
    delete x.options.min;
    delete x.options.max;
  }
  if (y) {
    delete y.options.min;
    delete y.options.max;
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
  const [tab, setTab] = useState<"circuit" | "sic">("circuit");
  const netlistRef = useRef(netlist);
  netlistRef.current = netlist;
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const onRunStateChangeRef = useRef(onRunStateChange);
  onRunStateChangeRef.current = onRunStateChange;
  const onSimResultRef = useRef(onSimResult);
  onSimResultRef.current = onSimResult;

  const publishResult = (next: SimResult | null) => {
    setResult(next);
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
    chartRef.current?.destroy();
    const muted = cssVar("--chart-muted", "#8b98a5");
    const grid = cssVar("--chart-grid", "#2a323d");
    const colors = [
      cssVar("--accent", "#4da3ff"),
      "#3dd68c",
      cssVar("--select", "#f0b429"),
      cssVar("--danger", "#ff7b72"),
    ];
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        datasets: result.series.map((s, i) => ({
          label: s.name,
          data: s.x.map((x, j) => ({ x, y: s.y[j] ?? 0 })),
          borderColor: colors[i % colors.length],
          backgroundColor: "transparent",
          pointRadius: 0,
          borderWidth: 1.5,
          tension: 0.15,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { labels: { color: muted, boxWidth: 12, font: { size: 11 } } },
        },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "t (s)", color: muted },
            ticks: { color: muted, maxTicksLimit: 6 },
            grid: { color: grid },
          },
          y: {
            title: { display: true, text: "V", color: muted },
            ticks: { color: muted },
            grid: { color: grid },
          },
        },
      },
    });
  }, [result, uiTheme]);

  const busy = runState === "running";
  const hasChart = Boolean(result?.series.length);
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
        {runState === "paused" && !result && (
          <div className="netlist-status">Simulation paused</div>
        )}
        {hasChart && (
          <div className="sim-chart-toolbar" role="toolbar" aria-label="Waveform zoom">
            <button type="button" className="sim-zoom-btn" title="Zoom X" onClick={() => doZoom("x")}>
              <span className="sim-zoom-glyph">↔</span>
              <span className="sim-zoom-lab">X</span>
            </button>
            <button type="button" className="sim-zoom-btn" title="Zoom Y" onClick={() => doZoom("y")}>
              <span className="sim-zoom-glyph">↕</span>
              <span className="sim-zoom-lab">Y</span>
            </button>
            <button type="button" className="sim-zoom-btn" title="Zoom XY" onClick={() => doZoom("xy")}>
              <span className="sim-zoom-glyph">⤢</span>
              <span className="sim-zoom-lab">XY</span>
            </button>
            <button
              type="button"
              className="sim-zoom-btn"
              title="Auto scale"
              onClick={() => {
                const c = chartRef.current;
                if (c) autoScaleChart(c);
              }}
            >
              <span className="sim-zoom-glyph">⛶</span>
              <span className="sim-zoom-lab">Auto</span>
            </button>
          </div>
        )}
        <div className="sim-chart-wrap">
          <canvas ref={canvasRef} />
          {!result && !busy && runState !== "paused" && (
            <div className="sim-placeholder">
              Run simulation to see a waveform
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
