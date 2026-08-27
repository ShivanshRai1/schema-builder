import { useEffect, useRef, useState } from "react";
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Legend,
  Title,
} from "chart.js";
import { normalizeSeries, runFleetJob, type SimEngine } from "../sim/runSimulation";
import { analyseRR, fmt } from "../sim/sicCompare";

Chart.register(LineController, LineElement, PointElement, LinearScale, Legend, Title);

const COLORS = ["#4da3ff", "#3dd68c", "#f0b429", "#ff7b72", "#c792ea"];

/** True when the schematic netlist looks like the SiC reverse-recovery test. */
export function looksLikeSicTestbench(netlist: string): boolean {
  const n = netlist.toLowerCase();
  return (
    n.includes("vsense") &&
    (n.includes("v(vout)") || n.includes("vout") || n.includes("v(nbus)") || n.includes("nbus")) &&
    (n.includes("v(nd)") || /\bnd\b/.test(n))
  );
}

export function SicComparePanel({ netlist }: { netlist: string }) {
  const waveRef = useRef<HTMLCanvasElement>(null);
  const rrRef = useRef<HTMLCanvasElement>(null);
  const waveChart = useRef<Chart | null>(null);
  const rrChart = useRef<Chart | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [engine, setEngine] = useState<SimEngine>("D1SPICE");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [series, setSeries] = useState<{ name: string; x: number[]; y: number[] }[] | null>(null);
  const [rr, setRr] = useState<ReturnType<typeof analyseRR> | null>(null);
  const [sentNl, setSentNl] = useState("");

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      waveChart.current?.destroy();
      rrChart.current?.destroy();
    };
  }, []);

  useEffect(() => {
    if (!series?.length || !waveRef.current) {
      waveChart.current?.destroy();
      waveChart.current = null;
      return;
    }
    waveChart.current?.destroy();
    waveChart.current = new Chart(waveRef.current, {
      type: "line",
      data: {
        datasets: series.map((s, i) => ({
          label: s.name,
          data: s.x.map((x, j) => ({ x, y: s.y[j] ?? 0 })),
          borderColor: COLORS[i % COLORS.length],
          backgroundColor: "transparent",
          pointRadius: 0,
          borderWidth: 1.5,
          tension: 0.15,
        })),
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#8b98a5", boxWidth: 10, font: { size: 10 } } } },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "t (s)", color: "#8b98a5" },
            ticks: { color: "#8b98a5", maxTicksLimit: 5 },
            grid: { color: "#2a323d" },
          },
          y: {
            ticks: { color: "#8b98a5" },
            grid: { color: "#2a323d" },
          },
        },
      },
    });
  }, [series]);

  useEffect(() => {
    if (!rr?.wave.length || !rrRef.current) {
      rrChart.current?.destroy();
      rrChart.current = null;
      return;
    }
    rrChart.current?.destroy();
    rrChart.current = new Chart(rrRef.current, {
      type: "line",
      data: {
        datasets: [
          {
            label: "I_diode",
            data: rr.wave,
            borderColor: "#4FC3F7",
            pointRadius: 0,
            borderWidth: 1.6,
            tension: 0.15,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#8b98a5", boxWidth: 10, font: { size: 10 } } } },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "time (ns)", color: "#8b98a5" },
            ticks: { color: "#8b98a5", maxTicksLimit: 5 },
            grid: { color: "#2a323d" },
          },
          y: {
            title: { display: true, text: "I_diode (A)", color: "#8b98a5" },
            ticks: { color: "#8b98a5" },
            grid: { color: "#2a323d" },
          },
        },
      },
    });
  }, [rr]);

  const runText = async (text: string, eng: SimEngine, label: string) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setSeries(null);
    setRr(null);
    setStatus(`Running ${label}…`);
    try {
      const job = await runFleetJob(text, {
        engine: eng,
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (!job.ok) {
        setStatus(job.error);
        return;
      }
      const traces = normalizeSeries(job.data);
      setSeries(traces);
      setSentNl(text);
      let rrNext: ReturnType<typeof analyseRR> | null = null;
      try {
        rrNext = analyseRR(job.data);
      } catch {
        rrNext = null;
      }
      setRr(rrNext);
      setStatus(
        traces.length
          ? `Done (${eng}) — ${traces.length} signal(s) from ${label}`
          : "Done, but no plot signals came back",
      );
    } finally {
      if (!ac.signal.aborted) setBusy(false);
    }
  };

  const onRun = () => void runText(netlist, engine, "schematic");

  return (
    <div className="sic-compare">
      <p className="sic-note">
        Run uses the schematic netlist (same as the Circuit tab). Do not Apply a long SPICE deck — only V/R/C/D lines.
      </p>
      <div className="sic-runrow">
        <select
          className="sim-engine"
          value={engine}
          disabled={busy}
          onChange={(e) => setEngine(e.target.value as SimEngine)}
        >
          <option value="D1SPICE">D1SPICE</option>
          <option value="D2SPICE">D2SPICE</option>
        </select>
        <button type="button" className="ghost-btn ghost-btn-primary sic-run" disabled={busy} onClick={() => onRun()}>
          {busy ? "Running…" : "Run"}
        </button>
      </div>
      {status && <div className="netlist-status">{status}</div>}

      <div className="sic-chartbox">
        <h4>Signals from your netlist</h4>
        <div className="sic-chart">
          <canvas ref={waveRef} />
          {!series && !busy && <div className="sim-placeholder">Run to plot your current netlist</div>}
        </div>
      </div>

      {rr && (
        <>
          <div className="sic-chartbox">
            <h4>Reverse-recovery I<sub>diode</sub>(t)</h4>
            <div className="sic-chart">
              <canvas ref={rrRef} />
            </div>
          </div>
          <div className="sic-metrics">
            I<sub>rrm</sub> {fmt(rr.irrm, 2)} A · Q<sub>rr</sub> {fmt(rr.qrr * 1e9, 2)} nC · t<sub>rr</sub>{" "}
            {fmt(rr.trr * 1e9, 2)} ns
          </div>
        </>
      )}

      {sentNl && (
        <details className="sic-nl">
          <summary>Netlist sent this run</summary>
          <pre>{sentNl}</pre>
        </details>
      )}
    </div>
  );
}
