import { useEffect, useRef, useState } from "react";
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

/**
 * POST the live schematic netlist to sim_api.php (submit + poll).
 * Built-in models are auto-injected into the netlist — no manual library paste required.
 */
export function SimPanel({ netlist, onPopOut }: { netlist: string; onPopOut?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<SimEngine>("D2SPICE");
  const [result, setResult] = useState<SimResult | null>(null);
  const [tab, setTab] = useState<"circuit" | "sic">("circuit");

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
    const colors = ["#4da3ff", "#3dd68c", "#f0b429", "#ff7b72"];
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
          legend: { labels: { color: "#8b98a5", boxWidth: 12, font: { size: 11 } } },
        },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "t (s)", color: "#8b98a5" },
            ticks: { color: "#8b98a5", maxTicksLimit: 6 },
            grid: { color: "#2a323d" },
          },
          y: {
            title: { display: true, text: "V", color: "#8b98a5" },
            ticks: { color: "#8b98a5" },
            grid: { color: "#2a323d" },
          },
        },
      },
    });
  }, [result]);

  const onRun = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setResult(null);
    try {
      const next = await runSimulation(netlist, { engine, signal: ac.signal });
      if (!ac.signal.aborted) setResult(next);
    } finally {
      if (!ac.signal.aborted) setBusy(false);
    }
  };

  const badge =
    result?.source === "fleet"
      ? "fleet"
      : result?.source === "demo"
        ? "demo"
        : `${engine} · Chart.js`;

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
            onClick={() => void onRun()}
          >
            {busy ? "Running…" : "Run"}
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
      <div className="sim-chart-wrap">
        <canvas ref={canvasRef} />
        {!result && !busy && (
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
