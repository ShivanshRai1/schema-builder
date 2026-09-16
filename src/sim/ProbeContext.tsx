import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  probeKey,
  sameProbe,
  type ProbeSpec,
} from "./probeSelection";
import type { SimResult } from "./runSimulation";

export type ProbeFeedback = {
  ok: boolean;
  message: string;
} | null;

/** Placed voltage probe pin on the schematic (red first, then black). */
export type VoltageProbePin = {
  net: string;
  /** Flow-space position (wire click). */
  x: number;
  y: number;
};

type ProbeContextValue = {
  probes: ProbeSpec[];
  probeMode: boolean;
  setProbeMode: (on: boolean) => void;
  /** Next pin to place when using Ctrl+click differential. */
  nextPin: "red" | "black" | "done";
  redPin: VoltageProbePin | null;
  blackPin: VoltageProbePin | null;
  /** All click-to-plot voltage markers (LTspice multi-probe). */
  voltagePins: VoltageProbePin[];
  feedback: ProbeFeedback;
  clearFeedback: () => void;
  clearProbes: () => void;
  /**
   * LTspice-style: toggle V(net) on the plot (multi-trace).
   * Places/updates a marker on the schematic.
   */
  toggleVoltage: (net: string, x: number, y: number) => void;
  /**
   * Ctrl+click path: red pin then black pin → V(a,b) differential.
   * With both pins set, moves the black pin.
   */
  placeVoltagePin: (net: string, x: number, y: number) => void;
  /** Drag wire→wire (or explicit) differential in one step. */
  setDifferential: (
    a: string,
    ax: number,
    ay: number,
    b: string,
    bx: number,
    by: number,
  ) => void;
  /** Right-click: remove black, then red, then last voltage pin. */
  popProbePin: () => boolean;
  /** Remove a placed voltage pin / V(net) by net name (pin right-click). */
  removeVoltagePin: (net: string) => boolean;
  /** Remove any probe matching V()/I()/expr key (legend right-click). */
  removeProbeByKey: (key: string) => void;
  /** Click / Shift+click part → toggle I(refdes). */
  toggleCurrent: (refdes: string) => void;
  addExpression: (expr: string) => { ok: boolean; message: string };
  updateExpression: (id: string, expr: string) => { ok: boolean; message: string };
  removeExpression: (id: string) => void;
  reportMissing: (signal: string) => void;
};

const ProbeContext = createContext<ProbeContextValue | null>(null);

function newExprId(): string {
  return `expr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function specsFromState(
  voltagePins: VoltageProbePin[],
  red: VoltageProbePin | null,
  black: VoltageProbePin | null,
  currents: ProbeSpec[],
  exprs: ProbeSpec[],
): ProbeSpec[] {
  const out: ProbeSpec[] = [];
  const seen = new Set<string>();
  const push = (p: ProbeSpec) => {
    const k = probeKey(p).toUpperCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(p);
  };

  for (const pin of voltagePins) {
    push({ kind: "V", net: pin.net });
  }
  // Differential only when both pins set (Ctrl+click workflow).
  if (red && black) {
    push({ kind: "Vd", a: red.net, b: black.net });
  }
  for (const c of currents) push(c);
  for (const e of exprs) push(e);
  return out;
}

export function ProbeProvider({ children }: { children: ReactNode }) {
  const [probeMode, setProbeMode] = useState(false);
  const [redPin, setRedPin] = useState<VoltageProbePin | null>(null);
  const [blackPin, setBlackPin] = useState<VoltageProbePin | null>(null);
  const [voltagePins, setVoltagePins] = useState<VoltageProbePin[]>([]);
  const [currentProbes, setCurrentProbes] = useState<ProbeSpec[]>([]);
  const [exprProbes, setExprProbes] = useState<ProbeSpec[]>([]);
  const [feedback, setFeedback] = useState<ProbeFeedback>(null);

  const redRef = useRef(redPin);
  const blackRef = useRef(blackPin);
  const voltageRef = useRef(voltagePins);
  redRef.current = redPin;
  blackRef.current = blackPin;
  voltageRef.current = voltagePins;

  const probes = useMemo(
    () =>
      specsFromState(voltagePins, redPin, blackPin, currentProbes, exprProbes),
    [voltagePins, redPin, blackPin, currentProbes, exprProbes],
  );

  const nextPin: "red" | "black" | "done" = !redPin
    ? "red"
    : !blackPin
      ? "black"
      : "done";

  const clearFeedback = useCallback(() => setFeedback(null), []);

  const clearProbes = useCallback(() => {
    setRedPin(null);
    setBlackPin(null);
    setVoltagePins([]);
    setCurrentProbes([]);
    setExprProbes([]);
    setFeedback(null);
  }, []);

  const reportMissing = useCallback((signal: string) => {
    setFeedback({
      ok: false,
      message: `${signal} not in simulation results`,
    });
  }, []);

  const toggleVoltage = useCallback((net: string, x: number, y: number) => {
    const n = net.trim();
    if (!n) return;
    setVoltagePins((prev) => {
      const idx = prev.findIndex((p) => p.net.toUpperCase() === n.toUpperCase());
      if (idx >= 0) {
        const next = prev.filter((_, i) => i !== idx);
        setFeedback({
          ok: true,
          message: `Removed V(${n}) from plot`,
        });
        return next;
      }
      setFeedback({
        ok: true,
        message: `Plotting V(${n}) — click again to remove`,
      });
      return [...prev, { net: n, x, y }];
    });
  }, []);

  const placeVoltagePin = useCallback((net: string, x: number, y: number) => {
    const n = net.trim();
    if (!n) return;
    const red = redRef.current;
    if (!red) {
      setRedPin({ net: n, x, y });
      setBlackPin(null);
      setFeedback({
        ok: true,
        message: `Red pin → V(${n}). Ctrl+click / drag to another net for black (differential).`,
      });
      return;
    }
    if (n === red.net) {
      setFeedback({
        ok: false,
        message: `Black pin needs a different net than red (V(${n}))`,
      });
      return;
    }
    const hadBlack = Boolean(blackRef.current);
    setBlackPin({ net: n, x, y });
    setFeedback({
      ok: true,
      message: hadBlack
        ? `Black pin moved → V(${red.net},${n})`
        : `Black pin → V(${red.net},${n})`,
    });
  }, []);

  const setDifferential = useCallback(
    (
      a: string,
      ax: number,
      ay: number,
      b: string,
      bx: number,
      by: number,
    ) => {
      const na = a.trim();
      const nb = b.trim();
      if (!na || !nb || na.toUpperCase() === nb.toUpperCase()) {
        setFeedback({
          ok: false,
          message: "Differential needs two different nets",
        });
        return;
      }
      setRedPin({ net: na, x: ax, y: ay });
      setBlackPin({ net: nb, x: bx, y: by });
      setFeedback({
        ok: true,
        message: `Plotting V(${na},${nb})`,
      });
    },
    [],
  );

  const popProbePin = useCallback((): boolean => {
    const black = blackRef.current;
    const red = redRef.current;
    if (black) {
      setBlackPin(null);
      setFeedback({
        ok: true,
        message: red
          ? `Removed black pin — still have red V(${red.net})`
          : "Removed black pin",
      });
      return true;
    }
    if (red) {
      setRedPin(null);
      setFeedback({ ok: true, message: `Removed red pin V(${red.net})` });
      return true;
    }
    const pins = voltageRef.current;
    if (pins.length) {
      const last = pins[pins.length - 1]!;
      setVoltagePins(pins.slice(0, -1));
      setFeedback({ ok: true, message: `Removed V(${last.net})` });
      return true;
    }
    return false;
  }, []);

  const removeVoltagePin = useCallback((net: string) => {
    const n = net.trim();
    if (!n) return false;
    const nu = n.toUpperCase();
    const black = blackRef.current;
    if (black && black.net.toUpperCase() === nu) {
      setBlackPin(null);
      setFeedback({ ok: true, message: `Removed black pin V(…,${n})` });
      return true;
    }
    const red = redRef.current;
    if (red && red.net.toUpperCase() === nu) {
      setRedPin(null);
      setBlackPin(null);
      setFeedback({ ok: true, message: `Removed red pin V(${n})` });
      return true;
    }
    const pins = voltageRef.current;
    const idx = pins.findIndex((p) => p.net.toUpperCase() === nu);
    if (idx < 0) return false;
    setVoltagePins(pins.filter((_, i) => i !== idx));
    setFeedback({ ok: true, message: `Removed V(${n})` });
    return true;
  }, []);

  const toggleCurrent = useCallback((refdes: string) => {
    const r = refdes.trim();
    if (!r) return;
    const spec: ProbeSpec = { kind: "I", refdes: r };
    setCurrentProbes((prev) => {
      const exists = prev.some((p) => sameProbe(p, spec));
      if (exists) {
        setFeedback({ ok: true, message: `Removed ${probeKey(spec)} from plot` });
        return prev.filter((p) => !sameProbe(p, spec));
      }
      setFeedback({ ok: true, message: `Plotting ${probeKey(spec)}` });
      return [...prev, spec];
    });
  }, []);

  const addExpression = useCallback((expr: string) => {
    const e = expr.trim();
    if (!e) return { ok: false, message: "Enter an expression" };
    const id = newExprId();
    setExprProbes((prev) => [...prev, { kind: "Expr", expr: e, id }]);
    setFeedback({ ok: true, message: `Plotting ${e}` });
    return { ok: true, message: `Plotting ${e}` };
  }, []);

  const updateExpression = useCallback((id: string, expr: string) => {
    const e = expr.trim();
    if (!e) return { ok: false, message: "Enter an expression" };
    setExprProbes((prev) =>
      prev.map((p) =>
        p.kind === "Expr" && p.id === id ? { ...p, expr: e } : p,
      ),
    );
    setFeedback({ ok: true, message: `Updated ${e}` });
    return { ok: true, message: `Updated ${e}` };
  }, []);

  const removeExpression = useCallback((id: string) => {
    setExprProbes((prev) =>
      prev.filter((p) => !(p.kind === "Expr" && p.id === id)),
    );
    setFeedback({ ok: true, message: "Removed expression trace" });
  }, []);

  const removeProbeByKey = useCallback((key: string) => {
    const k = key.trim().replace(/\s+/g, "").toUpperCase();
    if (!k) return;
    let removed = false;
    setVoltagePins((prev) => {
      const next = prev.filter((p) => `V(${p.net})`.toUpperCase() !== k);
      if (next.length !== prev.length) removed = true;
      return next;
    });
    setCurrentProbes((prev) => {
      const next = prev.filter((p) => probeKey(p).toUpperCase() !== k);
      if (next.length !== prev.length) removed = true;
      return next;
    });
    setExprProbes((prev) => {
      const next = prev.filter((p) => probeKey(p).toUpperCase() !== k);
      if (next.length !== prev.length) removed = true;
      return next;
    });
    const red = redRef.current;
    const black = blackRef.current;
    if (red && black) {
      const vd = `V(${red.net},${black.net})`.toUpperCase();
      if (vd === k) {
        setRedPin(null);
        setBlackPin(null);
        removed = true;
      }
    }
    if (removed) {
      setFeedback({ ok: true, message: `Removed ${key}` });
    }
  }, []);

  const setProbeModeSafe = useCallback((on: boolean) => {
    setProbeMode(on);
    // Keep existing traces when leaving Probe tool (LTspice keeps the plot).
    if (!on) setFeedback(null);
  }, []);

  const value = useMemo(
    () => ({
      probes,
      probeMode,
      setProbeMode: setProbeModeSafe,
      nextPin,
      redPin,
      blackPin,
      voltagePins,
      feedback,
      clearFeedback,
      clearProbes,
      toggleVoltage,
      placeVoltagePin,
      setDifferential,
      popProbePin,
      removeVoltagePin,
      toggleCurrent,
      addExpression,
      updateExpression,
      removeExpression,
      removeProbeByKey,
      reportMissing,
    }),
    [
      probes,
      probeMode,
      setProbeModeSafe,
      nextPin,
      redPin,
      blackPin,
      voltagePins,
      feedback,
      clearFeedback,
      clearProbes,
      toggleVoltage,
      placeVoltagePin,
      setDifferential,
      popProbePin,
      removeVoltagePin,
      toggleCurrent,
      addExpression,
      updateExpression,
      removeExpression,
      removeProbeByKey,
      reportMissing,
    ],
  );

  return <ProbeContext.Provider value={value}>{children}</ProbeContext.Provider>;
}

/** Reset probes when a new sim result arrives — keep Probe mode off until the user enables it. */
export function ClearProbesOnSimChange({ result }: { result: SimResult | null }) {
  const { clearProbes, setProbeMode } = useProbeSelection();
  const prev = useRef<SimResult | null | undefined>(undefined);
  useEffect(() => {
    if (prev.current === undefined) {
      prev.current = result;
      return;
    }
    if (prev.current !== result) {
      clearProbes();
      setProbeMode(false);
      prev.current = result;
    }
  }, [result, clearProbes, setProbeMode]);
  return null;
}

export function useProbeSelection(): ProbeContextValue {
  const ctx = useContext(ProbeContext);
  if (!ctx) {
    throw new Error("useProbeSelection must be used within ProbeProvider");
  }
  return ctx;
}

export function useProbeSelectionOptional(): ProbeContextValue | null {
  return useContext(ProbeContext);
}
