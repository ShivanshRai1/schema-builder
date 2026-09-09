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
  /** Next pin to place when Probe is on. */
  nextPin: "red" | "black" | "done";
  redPin: VoltageProbePin | null;
  blackPin: VoltageProbePin | null;
  feedback: ProbeFeedback;
  clearFeedback: () => void;
  clearProbes: () => void;
  /**
   * Place next voltage pin on a net (red → black).
   * With both pins set, moves the black pin.
   */
  placeVoltagePin: (net: string, x: number, y: number) => void;
  /** Right-click: remove black, then red. Returns true if a pin was removed. */
  popProbePin: () => boolean;
  /** Shift+click part → toggle I(refdes). */
  toggleCurrent: (refdes: string) => void;
  reportMissing: (signal: string) => void;
};

const ProbeContext = createContext<ProbeContextValue | null>(null);

function specsFromPins(
  red: VoltageProbePin | null,
  black: VoltageProbePin | null,
  currents: ProbeSpec[],
): ProbeSpec[] {
  const out: ProbeSpec[] = [];
  if (red && black) {
    out.push({ kind: "Vd", a: red.net, b: black.net });
  } else if (red) {
    out.push({ kind: "V", net: red.net });
  }
  for (const c of currents) {
    if (!out.some((p) => sameProbe(p, c))) out.push(c);
  }
  return out;
}

export function ProbeProvider({ children }: { children: ReactNode }) {
  const [probeMode, setProbeMode] = useState(false);
  const [redPin, setRedPin] = useState<VoltageProbePin | null>(null);
  const [blackPin, setBlackPin] = useState<VoltageProbePin | null>(null);
  const [currentProbes, setCurrentProbes] = useState<ProbeSpec[]>([]);
  const [feedback, setFeedback] = useState<ProbeFeedback>(null);

  const redRef = useRef(redPin);
  const blackRef = useRef(blackPin);
  redRef.current = redPin;
  blackRef.current = blackPin;

  const probes = useMemo(
    () => specsFromPins(redPin, blackPin, currentProbes),
    [redPin, blackPin, currentProbes],
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
    setCurrentProbes([]);
    setFeedback(null);
  }, []);

  const reportMissing = useCallback((signal: string) => {
    setFeedback({
      ok: false,
      message: `${signal} not in simulation results`,
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
        message: `Red pin → V(${n}). Click another net for the black pin.`,
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

  const popProbePin = useCallback((): boolean => {
    const black = blackRef.current;
    const red = redRef.current;
    if (black) {
      setBlackPin(null);
      setFeedback({
        ok: true,
        message: red
          ? `Removed black pin — still plotting V(${red.net})`
          : "Removed black pin",
      });
      return true;
    }
    if (red) {
      setRedPin(null);
      setFeedback({ ok: true, message: `Removed red pin V(${red.net})` });
      return true;
    }
    return false;
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

  const setProbeModeSafe = useCallback((on: boolean) => {
    setProbeMode(on);
    if (!on) {
      setRedPin(null);
      setBlackPin(null);
      setCurrentProbes([]);
      setFeedback(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      probes,
      probeMode,
      setProbeMode: setProbeModeSafe,
      nextPin,
      redPin,
      blackPin,
      feedback,
      clearFeedback,
      clearProbes,
      placeVoltagePin,
      popProbePin,
      toggleCurrent,
      reportMissing,
    }),
    [
      probes,
      probeMode,
      setProbeModeSafe,
      nextPin,
      redPin,
      blackPin,
      feedback,
      clearFeedback,
      clearProbes,
      placeVoltagePin,
      popProbePin,
      toggleCurrent,
      reportMissing,
    ],
  );

  return <ProbeContext.Provider value={value}>{children}</ProbeContext.Provider>;
}

/** Reset pins when a new sim result arrives; enable Probe after success. */
export function ClearProbesOnSimChange({ result }: { result: SimResult | null }) {
  const { clearProbes, setProbeMode } = useProbeSelection();
  const prev = useRef<SimResult | null | undefined>(undefined);
  useEffect(() => {
    if (prev.current === undefined) {
      prev.current = result;
      if (result?.ok && result.series.length) setProbeMode(true);
      return;
    }
    if (prev.current !== result) {
      clearProbes();
      setProbeMode(Boolean(result?.ok && result.series.length));
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
