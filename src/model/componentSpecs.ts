import type { AttributeSpec, Category, ComponentKind, PinSpec } from "./types";
import {
  logicPinsFromOp,
  productPinsFromOps,
  sumPinsFromSigns,
} from "./mathBlocks";

// ---------------------------------------------------------------------------
// Component spec registry — the single extension point.
//
// Each family declares: category, refdes prefix (= SPICE instance-name prefix),
// pins (+ placement), editable attributes (drive the properties panel), whether
// it emits a device line, and toSpice() / toProbes().
//
// Adding a component = one entry here. The generic node renderer, palette,
// properties editor, and netlist exporter all read from this registry.
//
// SPICE emission strategy:
//   - Primitives (R L C V I D M Q) emit native SPICE lines.
//   - Complex power/control parts (SiC, GaN, IGBT, SCR, gate driver, comparator,
//     error amp) emit SUBCIRCUIT CALLS `X<refdes> <nodes> <MODEL>` referencing a
//     vendor/behavioural .subckt the user supplies (EPC QSPICE, Infineon
//     OptiMOS, Vishay, ...). The `model` attribute names that subckt.
//   - Probes/senses contribute to a `.save`/`.probe` directive via toProbes().
// The engineer refines these emissions against real vendor models (see README).
// ---------------------------------------------------------------------------

export interface ComponentSpec {
  kind: ComponentKind;
  category: Category;
  /** Refdes prefix; MUST be a valid SPICE first-letter for emitting parts. */
  refdesPrefix: string;
  label: string;
  /** Short glyph shown in the node body. */
  glyph: string;
  pins: PinSpec[];
  attributes: AttributeSpec[];
  /** Whether this part emits a device line (GND / labels / voltage probes do not). */
  emits: boolean;
  toSpice: (
    refdes: string,
    netOf: (pinId: string) => string,
    params: Record<string, string>,
  ) => string | null;
  /** Optional: net signals this part asks the simulator to save (probes/senses). */
  toProbes?: (
    refdes: string,
    netOf: (pinId: string) => string,
    params: Record<string, string>,
  ) => string[];
}

// --- small builders --------------------------------------------------------

const pin = (id: string, label: string, side: PinSpec["side"], offset = 0.5): PinSpec => ({ id, label, side, offset });

const A = (
  key: string,
  label: string,
  type: AttributeSpec["type"],
  def: string,
  extra: Partial<AttributeSpec> = {},
): AttributeSpec => ({ key, label, type, default: def, ...extra });

const modelAttr = (def: string) =>
  A("model", ".subckt / model", "text", def, { hint: "Vendor or generated SPICE model/.subckt name" });

/** Placeholder "L" (or empty) is not a legal inductance — SPICE fatal. */
function spiceHenry(raw: string | undefined, fallback = "1m"): string {
  const t = (raw ?? "").trim();
  if (!t || /^L$/i.test(t)) return fallback;
  return t;
}

/** Placeholder "R" is not a legal resistance. */
function spiceOhm(raw: string | undefined, fallback = "1k"): string {
  const t = (raw ?? "").trim();
  if (!t || /^R$/i.test(t)) return fallback;
  return t;
}

/** Placeholder "C" is not a legal capacitance. */
function spiceFarad(raw: string | undefined, fallback = "1u"): string {
  const t = (raw ?? "").trim();
  if (!t || /^C$/i.test(t)) return fallback;
  return t;
}

/** Emit `X<refdes> <ordered nodes> <MODEL>`. */
const subckt =
  (order: string[]) =>
  (refdes: string, netOf: (p: string) => string, p: Record<string, string>): string =>
    `${refdes} ${order.map(netOf).join(" ")} ${p.model ?? "GENERIC"}`;

// horizontal 2-terminal pins
const LR: PinSpec[] = [pin("a", "a", "left"), pin("b", "b", "right")];
// vertical 2-terminal pins
const PN: PinSpec[] = [pin("p", "+", "top"), pin("n", "-", "bottom")];

// ---------------------------------------------------------------------------

export const COMPONENT_SPECS: Record<ComponentKind, ComponentSpec> = {
  // ---- Resistors ---------------------------------------------------------
  R: {
    kind: "R", category: "Resistor", refdesPrefix: "R", label: "Fixed resistor", glyph: "∿", emits: true,
    pins: LR, attributes: [A("value", "Resistance", "text", "1k", { unit: "Ω" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${spiceOhm(p.value)}`,
  },
  RBOX: {
    kind: "RBOX", category: "Resistor", refdesPrefix: "R", label: "Fixed resistor (box)", glyph: "▭", emits: true,
    pins: LR, attributes: [A("value", "Resistance", "text", "1k", { unit: "Ω" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${spiceOhm(p.value)}`,
  },
  RVAR: {
    kind: "RVAR", category: "Resistor", refdesPrefix: "R", label: "Variable / rheostat", glyph: "∿↗", emits: true,
    pins: LR, attributes: [A("value", "Resistance", "text", "1k", { unit: "Ω" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${spiceOhm(p.value)}`,
  },
  RVARBOX: {
    kind: "RVARBOX", category: "Resistor", refdesPrefix: "R", label: "Variable (box)", glyph: "▭↗", emits: true,
    pins: LR, attributes: [A("value", "Resistance", "text", "1k", { unit: "Ω" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${spiceOhm(p.value)}`,
  },
  POT: {
    kind: "POT", category: "Resistor", refdesPrefix: "R", label: "Potentiometer", glyph: "∿⊥", emits: true,
    pins: [pin("a", "a", "left"), pin("w", "w", "top"), pin("b", "b", "right")],
    attributes: [A("value", "Total resistance", "text", "10k", { unit: "Ω" })],
    // Two series halves sharing the wiper (standard schematic→SPICE mapping).
    toSpice: (r, n, p) => {
      const v = spiceOhm(p.value, "10k");
      return `${r}A ${n("a")} ${n("w")} {${v}/2}\n${r}B ${n("w")} ${n("b")} {${v}/2}`;
    },
  },
  POTBOX: {
    kind: "POTBOX", category: "Resistor", refdesPrefix: "R", label: "Potentiometer (box)", glyph: "▭⊥", emits: true,
    pins: [pin("a", "a", "left"), pin("w", "w", "top"), pin("b", "b", "right")],
    attributes: [A("value", "Total resistance", "text", "10k", { unit: "Ω" })],
    toSpice: (r, n, p) => {
      const v = spiceOhm(p.value, "10k");
      return `${r}A ${n("a")} ${n("w")} {${v}/2}\n${r}B ${n("w")} ${n("b")} {${v}/2}`;
    },
  },
  THERM: {
    kind: "THERM", category: "Resistor", refdesPrefix: "R", label: "Thermistor", glyph: "θ", emits: true,
    pins: LR, attributes: [A("value", "Resistance", "text", "10k", { unit: "Ω" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${spiceOhm(p.value, "10k")}`,
  },
  LDR: {
    kind: "LDR", category: "Resistor", refdesPrefix: "R", label: "LDR", glyph: "LDR", emits: true,
    pins: LR, attributes: [A("value", "Resistance", "text", "10k", { unit: "Ω" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${spiceOhm(p.value, "10k")}`,
  },

  // ---- Inductors ---------------------------------------------------------
  L: {
    kind: "L", category: "Inductor", refdesPrefix: "L", label: "Air core inductor", glyph: "◠◠", emits: true,
    pins: LR, attributes: [A("value", "Inductance", "text", "1m", { unit: "H" }), A("ic", "Initial current", "text", "", { unit: "A" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${spiceHenry(p.value)}${p.ic ? ` ic=${p.ic}` : ""}`,
  },
  LVAR: {
    kind: "LVAR", category: "Inductor", refdesPrefix: "L", label: "Variable inductor", glyph: "◠↗", emits: true,
    pins: LR, attributes: [A("value", "Inductance", "text", "1m", { unit: "H" }), A("ic", "Initial current", "text", "", { unit: "A" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${spiceHenry(p.value)}${p.ic ? ` ic=${p.ic}` : ""}`,
  },
  CMMC: {
    kind: "CMMC", category: "Passive", refdesPrefix: "L", label: "Common-mode choke", glyph: "CMC", emits: true,
    pins: [
      pin("a1", "1", "left", 0.28),
      pin("a2", "2", "left", 0.72),
      pin("b1", "3", "right", 0.28),
      pin("b2", "4", "right", 0.72),
    ],
    attributes: [
      A("value", "Inductance", "text", "1m", { unit: "H" }),
      A("k", "Coupling k", "text", "1"),
    ],
    toSpice: (r, n, p) => {
      const v = spiceHenry(p.value);
      const k = (p.k || "").trim() || "1";
      return (
        `${r}A ${n("a1")} ${n("a2")} ${v}\n` +
        `${r}B ${n("b1")} ${n("b2")} ${v}\n` +
        `K${r} ${r}A ${r}B ${k}`
      );
    },
  },
  /** Ideal 1:1 two-winding transformer (primary left, secondary right). */
  XFMR: {
    kind: "XFMR", category: "Inductor", refdesPrefix: "T", label: "Transformer", glyph: "⊂⊃", emits: true,
    pins: [
      pin("p1", "1", "left", 0.28),
      pin("p2", "2", "left", 0.72),
      pin("s1", "3", "right", 0.28),
      pin("s2", "4", "right", 0.72),
    ],
    attributes: [
      A("lp", "Primary L", "text", "1m", { unit: "H" }),
      A("ls", "Secondary L", "text", "1m", { unit: "H" }),
      A("k", "Coupling k", "text", "1"),
    ],
    toSpice: (r, n, p) => {
      const lp = spiceHenry(p.lp);
      const ls = spiceHenry(p.ls);
      const k = (p.k || "").trim() || "1";
      return (
        `${r}P ${n("p1")} ${n("p2")} ${lp}\n` +
        `${r}S ${n("s1")} ${n("s2")} ${ls}\n` +
        `K${r} ${r}P ${r}S ${k}`
      );
    },
  },
  FBEAD: {
    kind: "FBEAD", category: "Passive", refdesPrefix: "L", label: "Ferrite bead", glyph: "FB", emits: true,
    pins: LR, attributes: [A("value", "Inductance / Z", "text", "1u", { unit: "H" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${spiceHenry(p.value, "1u")}`,
  },
  ANT: {
    kind: "ANT", category: "Passive", refdesPrefix: "", label: "Antenna", glyph: "Y", emits: false,
    pins: [pin("a", "", "bottom", 0.5)],
    attributes: [],
    toSpice: () => null,
  },
  XTAL: {
    kind: "XTAL", category: "Passive", refdesPrefix: "X", label: "Crystal oscillator", glyph: "XTAL", emits: true,
    pins: LR,
    attributes: [modelAttr("XTAL"), A("freq", "Frequency", "text", "F", { unit: "Hz" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${p.model ?? "XTAL"}`,
  },

  // ---- Capacitors --------------------------------------------------------
  C: {
    kind: "C", category: "Capacitor", refdesPrefix: "C", label: "Non-polarized", glyph: "||", emits: true,
    pins: LR, attributes: [A("value", "Capacitance", "text", "1u", { unit: "F" }), A("ic", "Initial voltage", "text", "", { unit: "V" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${spiceFarad(p.value)}${p.ic ? ` ic=${p.ic}` : ""}`,
  },
  CPOL: {
    kind: "CPOL", category: "Capacitor", refdesPrefix: "C", label: "Polarized", glyph: "|)", emits: true,
    pins: [pin("a", "+", "left"), pin("b", "−", "right")],
    attributes: [A("value", "Capacitance", "text", "1u", { unit: "F" }), A("ic", "Initial voltage", "text", "", { unit: "V" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${spiceFarad(p.value)}${p.ic ? ` ic=${p.ic}` : ""}`,
  },
  CFIXED: {
    kind: "CFIXED", category: "Capacitor", refdesPrefix: "C", label: "Fixed capacitor", glyph: "|)", emits: true,
    pins: LR, attributes: [A("value", "Capacitance", "text", "1u", { unit: "F" }), A("ic", "Initial voltage", "text", "", { unit: "V" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${spiceFarad(p.value)}${p.ic ? ` ic=${p.ic}` : ""}`,
  },
  CVAR: {
    kind: "CVAR", category: "Capacitor", refdesPrefix: "C", label: "Variable capacitor", glyph: "|)↗", emits: true,
    pins: LR, attributes: [A("value", "Capacitance", "text", "1u", { unit: "F" }), A("ic", "Initial voltage", "text", "", { unit: "V" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${spiceFarad(p.value)}${p.ic ? ` ic=${p.ic}` : ""}`,
  },

  // ---- Sources -----------------------------------------------------------
  /** Legacy free-form voltage source (kept for old circuits; not in Sources palette). */
  V: {
    kind: "V", category: "Sources", refdesPrefix: "V", label: "Voltage source", glyph: "(~)", emits: true,
    pins: PN,
    attributes: [A("value", "Value", "text", "V", { hint: "DC / AC magnitude, or a full SPICE stimulus" })],
    toSpice: (r, n, p) => `${r} ${n("p")} ${n("n")} ${p.value ?? "V"}`,
  },
  /** DC voltage — circle +/− (same family glyph as classic V). */
  BATTERY: {
    kind: "BATTERY", category: "Sources", refdesPrefix: "V", label: "DC voltage source", glyph: "(+)", emits: true,
    pins: PN,
    attributes: [
      A("dc", "DC value", "text", "V", { unit: "V" }),
      A("rser", "Series Resistance", "text", "", { unit: "Ω" }),
    ],
    toSpice: (r, n, p) => {
      const rser = (p.rser ?? "").trim();
      const ser = rser ? ` Rser=${rser}` : "";
      // Legacy: older circuits stored PULSE fields on BATTERY before DC/Pulse radio swap.
      const pulse =
        [p.vinitial, p.von, p.tdelay, p.trise, p.tfall, p.ton, p.tperiod].some(
          (x) => (x ?? "").trim().length > 0,
        );
      if (pulse) {
        return `${r} ${n("p")} ${n("n")} PULSE(${p.vinitial || "0"} ${p.von || "V"} ${p.tdelay || "0"} ${p.trise || "0"} ${p.tfall || "0"} ${p.ton || "0"} ${p.tperiod || "0"})${ser}`;
      }
      const dc = (p.dc ?? "V").trim() || "V";
      return `${r} ${n("p")} ${n("n")} DC ${dc}${ser}`;
    },
  },
  /** LTspice SINE voltage — Ncycles omitted. Also hosts PWL/EXP via `stimulus`. */
  VAC: {
    kind: "VAC", category: "Sources", refdesPrefix: "V", label: "AC voltage source", glyph: "(~)", emits: true,
    pins: PN,
    attributes: [
      A("voffset", "DC offset", "text", "", { unit: "V" }),
      A("vamp", "Amplitude", "text", "V", { unit: "V" }),
      A("freq", "Freq", "text", "", { unit: "Hz" }),
      A("tdelay", "Tdelay", "text", "", { unit: "s" }),
      A("theta", "Theta", "text", "", { unit: "1/s" }),
      A("phi", "Phi", "text", "", { unit: "deg" }),
      A("stimulus", "Raw stimulus", "text", "", {
        hint: "If set (e.g. PWL(...)), overrides SINE fields in the netlist",
      }),
    ],
    toSpice: (r, n, p) => {
      const raw = (p.stimulus ?? "").trim();
      if (raw) return `${r} ${n("p")} ${n("n")} ${raw}`;
      return `${r} ${n("p")} ${n("n")} SINE(${p.voffset || "0"} ${p.vamp || "V"} ${p.freq || "0"} ${p.tdelay || "0"} ${p.theta || "0"} ${p.phi || "0"})`;
    },
  },
  I: {
    kind: "I", category: "Sources", refdesPrefix: "I", label: "DC current source", glyph: "(→)", emits: true,
    pins: PN,
    attributes: [A("dc", "DC value", "text", "I", { unit: "A" })],
    toSpice: (r, n, p) => `${r} ${n("p")} ${n("n")} DC ${p.dc || "I"}`,
  },
  IAC: {
    kind: "IAC", category: "Sources", refdesPrefix: "I", label: "AC current source", glyph: "(~I)", emits: true,
    pins: PN,
    attributes: [
      A("ioffset", "DC offset", "text", "", { unit: "A" }),
      A("iamp", "Amplitude", "text", "I", { unit: "A" }),
      A("freq", "Freq", "text", "", { unit: "Hz" }),
      A("tdelay", "Tdelay", "text", "", { unit: "s" }),
      A("theta", "Theta", "text", "", { unit: "1/s" }),
      A("phi", "Phi", "text", "", { unit: "deg" }),
    ],
    toSpice: (r, n, p) =>
      `${r} ${n("p")} ${n("n")} SINE(${p.ioffset || "0"} ${p.iamp || "I"} ${p.freq || "0"} ${p.tdelay || "0"} ${p.theta || "0"} ${p.phi || "0"})`,
  },
  /** LTspice PULSE voltage — Ncycles omitted. */
  VPULSE: {
    kind: "VPULSE", category: "Sources", refdesPrefix: "V", label: "Pulse generator", glyph: "⊓", emits: true,
    pins: PN,
    attributes: [
      A("vinitial", "Vinitial", "text", "", { unit: "V" }),
      A("von", "Von", "text", "V", { unit: "V" }),
      A("tdelay", "Tdelay", "text", "", { unit: "s" }),
      A("trise", "Trise", "text", "", { unit: "s" }),
      A("tfall", "Tfall", "text", "", { unit: "s" }),
      A("ton", "Ton", "text", "", { unit: "s" }),
      A("tperiod", "Tperiod", "text", "", { unit: "s" }),
    ],
    toSpice: (r, n, p) =>
      `${r} ${n("p")} ${n("n")} PULSE(${p.vinitial || "0"} ${p.von || "V"} ${p.tdelay || "0"} ${p.trise || "0"} ${p.tfall || "0"} ${p.ton || "0"} ${p.tperiod || "0"})`,
  },

  // ---- Transistors -------------------------------------------------------
  NMOS: {
    kind: "NMOS", category: "Transistor", refdesPrefix: "M", label: "E-MOS\n(N-Ch)", glyph: "⊐N", emits: true,
    pins: [pin("d", "D", "top"), pin("g", "G", "left", 100 / 128), pin("s", "S", "bottom")],
    attributes: [modelAttr("NMOS_GEN"), A("bulk", "Bulk", "select", "source", { options: ["source", "explicit"] })],
    toSpice: (r, n, p) => `${r} ${n("d")} ${n("g")} ${n("s")} ${n("s")} ${p.model ?? "NMOS_GEN"}`,
  },
  PMOS: {
    kind: "PMOS", category: "Transistor", refdesPrefix: "M", label: "E-MOS\n(P-Ch)", glyph: "⊐P", emits: true,
    // S pin at arrow-tip column (bodyX − 1.2 in 96×128 symbol) — body tie at tip.
    pins: [pin("d", "D", "top"), pin("g", "G", "left", 100 / 128), pin("s", "S", "bottom", (58 - 1.2) / 96)],
    attributes: [modelAttr("PMOS_GEN")],
    toSpice: (r, n, p) => `${r} ${n("d")} ${n("g")} ${n("s")} ${n("s")} ${p.model ?? "PMOS_GEN"}`,
  },
  NMOS_D: {
    kind: "NMOS_D", category: "Transistor", refdesPrefix: "M", label: "D-MOS\n(N-Ch)", glyph: "⊐Nd", emits: true,
    pins: [pin("d", "D", "top"), pin("g", "G", "left", 100 / 128), pin("s", "S", "bottom")],
    attributes: [modelAttr("NMOS_DEP")],
    toSpice: (r, n, p) => `${r} ${n("d")} ${n("g")} ${n("s")} ${n("s")} ${p.model ?? "NMOS_DEP"}`,
  },
  PMOS_D: {
    kind: "PMOS_D", category: "Transistor", refdesPrefix: "M", label: "D-MOS\n(P-Ch)", glyph: "⊐Pd", emits: true,
    // S pin at arrow-tip column (bodyX − 1.2 in 96×128 symbol) — straight body tie, no jog.
    pins: [pin("d", "D", "top"), pin("g", "G", "left", 100 / 128), pin("s", "S", "bottom", (58 - 1.2) / 96)],
    attributes: [modelAttr("PMOS_DEP")],
    toSpice: (r, n, p) => `${r} ${n("d")} ${n("g")} ${n("s")} ${n("s")} ${p.model ?? "PMOS_DEP"}`,
  },
  NJFET: {
    kind: "NJFET", category: "Transistor", refdesPrefix: "J", label: "JFET (N-Ch)", glyph: "⊢N", emits: true,
    pins: [pin("d", "D", "top"), pin("g", "G", "left"), pin("s", "S", "bottom")],
    attributes: [modelAttr("NJF")],
    toSpice: (r, n, p) => `${r} ${n("d")} ${n("g")} ${n("s")} ${p.model ?? "NJF"}`,
  },
  PJFET: {
    kind: "PJFET", category: "Transistor", refdesPrefix: "J", label: "JFET (P-Ch)", glyph: "⊢P", emits: true,
    pins: [pin("d", "D", "top"), pin("g", "G", "left"), pin("s", "S", "bottom")],
    attributes: [modelAttr("PJF")],
    toSpice: (r, n, p) => `${r} ${n("d")} ${n("g")} ${n("s")} ${p.model ?? "PJF"}`,
  },
  NPN: {
    kind: "NPN", category: "Transistor", refdesPrefix: "Q", label: "BJT (NPN)", glyph: "NPN", emits: true,
    pins: [pin("c", "C", "top"), pin("b", "B", "left"), pin("e", "E", "bottom")],
    attributes: [modelAttr("NPN_GEN")],
    toSpice: (r, n, p) => `${r} ${n("c")} ${n("b")} ${n("e")} ${p.model ?? "NPN_GEN"}`,
  },
  PNP: {
    kind: "PNP", category: "Transistor", refdesPrefix: "Q", label: "BJT (PNP)", glyph: "PNP", emits: true,
    pins: [pin("c", "C", "top"), pin("b", "B", "left"), pin("e", "E", "bottom")],
    attributes: [modelAttr("PNP_GEN")],
    toSpice: (r, n, p) => `${r} ${n("c")} ${n("b")} ${n("e")} ${p.model ?? "PNP_GEN"}`,
  },
  /** Unijunction transistor — B2 top, E left, B1 bottom. */
  UJT: {
    kind: "UJT", category: "Transistor", refdesPrefix: "Q", label: "UJT", glyph: "UJT", emits: true,
    pins: [pin("b2", "B2", "top"), pin("e", "E", "left"), pin("b1", "B1", "bottom")],
    attributes: [modelAttr("UJT")],
    toSpice: (r, n, p) => `${r} ${n("b2")} ${n("e")} ${n("b1")} ${p.model ?? "UJT"}`,
  },

  // ---- Semiconductors (diode / power) ------------------------------------
  D: {
    kind: "D", category: "Semiconductor", refdesPrefix: "D", label: "Diode", glyph: "▷|", emits: true,
    pins: [pin("a", "A", "left"), pin("k", "K", "right")],
    attributes: [modelAttr("DGEN")],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("k")} ${p.model ?? "DGEN"}`,
  },
  DZ: {
    kind: "DZ", category: "Semiconductor", refdesPrefix: "D", label: "Zener diode", glyph: "▷|Z", emits: true,
    pins: [pin("a", "A", "left"), pin("k", "K", "right")],
    attributes: [modelAttr("DZEN")],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("k")} ${p.model ?? "DZEN"}`,
  },
  DS: {
    kind: "DS", category: "Semiconductor", refdesPrefix: "D", label: "Schottky diode", glyph: "▷|S", emits: true,
    pins: [pin("a", "A", "left"), pin("k", "K", "right")],
    attributes: [modelAttr("DSCH")],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("k")} ${p.model ?? "DSCH"}`,
  },
  LED: {
    kind: "LED", category: "Semiconductor", refdesPrefix: "D", label: "LED", glyph: "▷|*", emits: true,
    pins: [pin("a", "A", "left"), pin("k", "K", "right")],
    attributes: [modelAttr("DLED")],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("k")} ${p.model ?? "DLED"}`,
  },
  DTVS: {
    kind: "DTVS", category: "Semiconductor", refdesPrefix: "D", label: "TVS unidirectional", glyph: "TVS", emits: true,
    pins: [pin("a", "A", "left"), pin("k", "K", "right")],
    attributes: [modelAttr("DTVS")],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("k")} ${p.model ?? "DTVS"}`,
  },
  DTVSBI: {
    kind: "DTVSBI", category: "Semiconductor", refdesPrefix: "D", label: "TVS bidirectional", glyph: "TVS↔", emits: true,
    pins: [pin("a", "A", "left"), pin("k", "K", "right")],
    attributes: [modelAttr("DTVSBI")],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("k")} ${p.model ?? "DTVSBI"}`,
  },
  SICMOS: {
    kind: "SICMOS", category: "Semiconductor", refdesPrefix: "XM", label: "SiC MOSFET", glyph: "SiC", emits: true,
    pins: [pin("d", "D", "top"), pin("g", "G", "left", 100 / 128), pin("s", "S", "bottom")],
    attributes: [modelAttr("SIC_MOS")],
    toSpice: subckt(["d", "g", "s"]),
  },
  SICMOS_K: {
    kind: "SICMOS_K", category: "Semiconductor", refdesPrefix: "XMK", label: "SiC MOSFET (Kelvin)", glyph: "SiCₖ", emits: true,
    // 4-terminal: power source S + Kelvin (gate-return) source SK.
    pins: [pin("d", "D", "top"), pin("g", "G", "left"), pin("s", "S", "bottom", 2 / 3), pin("sk", "SK", "bottom", 1 / 3)],
    attributes: [modelAttr("SIC_MOS_KELVIN")],
    toSpice: subckt(["d", "g", "s", "sk"]),
  },
  GANHEMT: {
    kind: "GANHEMT", category: "Semiconductor", refdesPrefix: "XG", label: "GaN HEMT", glyph: "GaN", emits: true,
    pins: [pin("d", "D", "top"), pin("g", "G", "left", 100 / 128), pin("s", "S", "bottom")],
    attributes: [modelAttr("GAN_HEMT")],
    toSpice: subckt(["d", "g", "s"]),
  },
  IGBT: {
    kind: "IGBT", category: "Semiconductor", refdesPrefix: "XQ", label: "IGBT", glyph: "IGBT", emits: true,
    // C/E sit on the circle centerline (on-grid at 96×128).
    pins: [pin("c", "C", "top"), pin("g", "G", "left", 80 / 128), pin("e", "E", "bottom")],
    attributes: [modelAttr("IGBT_GEN")],
    toSpice: subckt(["c", "g", "e"]),
  },
  IGBT_K: {
    kind: "IGBT_K", category: "Semiconductor", refdesPrefix: "XQK", label: "IGBT (Kelvin)", glyph: "IGBTₖ", emits: true,
    pins: [
      pin("c", "C", "top"),
      pin("g", "G", "left"),
      pin("e", "E", "bottom", 2 / 3),
      pin("ek", "EK", "bottom", 1 / 3),
    ],
    attributes: [modelAttr("IGBT_KELVIN")],
    toSpice: subckt(["c", "g", "e", "ek"]),
  },
  SCR: {
    kind: "SCR", category: "Thyristor", refdesPrefix: "XT", label: "Thyristor SCR", glyph: "SCR", emits: true,
    pins: [pin("a", "A", "top"), pin("k", "K", "bottom"), pin("g", "G", "left", 2 / 3)],
    attributes: [modelAttr("SCR_GEN")],
    toSpice: subckt(["a", "k", "g"]),
  },
  SCS: {
    kind: "SCS", category: "Thyristor", refdesPrefix: "XT", label: "Thyristor SCS", glyph: "SCS", emits: true,
    pins: [
      pin("a", "A", "top"),
      pin("k", "K", "bottom"),
      pin("g1", "G1", "left", 0.72),
      pin("g2", "G2", "right", 0.28),
    ],
    attributes: [modelAttr("SCS_GEN")],
    toSpice: subckt(["a", "k", "g1", "g2"]),
  },
  TRIAC: {
    kind: "TRIAC", category: "Thyristor", refdesPrefix: "XT", label: "TRIAC", glyph: "TRIAC", emits: true,
    pins: [pin("mt2", "MT2", "top"), pin("mt1", "MT1", "bottom"), pin("g", "G", "left", 2 / 3)],
    attributes: [modelAttr("TRIAC_GEN")],
    toSpice: subckt(["mt2", "mt1", "g"]),
  },
  DIAC: {
    kind: "DIAC", category: "Thyristor", refdesPrefix: "XT", label: "DIAC", glyph: "DIAC", emits: true,
    pins: [pin("a1", "A1", "left"), pin("a2", "A2", "right")],
    attributes: [modelAttr("DIAC_GEN")],
    toSpice: subckt(["a1", "a2"]),
  },
  GTO: {
    kind: "GTO", category: "Thyristor", refdesPrefix: "XT", label: "GTO thyristor", glyph: "GTO", emits: true,
    pins: [pin("a", "A", "top"), pin("k", "K", "bottom"), pin("g", "G", "left", 2 / 3)],
    attributes: [modelAttr("GTO_GEN")],
    toSpice: subckt(["a", "k", "g"]),
  },
  SCR_PH: {
    kind: "SCR_PH", category: "Thyristor", refdesPrefix: "XT", label: "Photo-thyristor", glyph: "☀SCR", emits: true,
    pins: [pin("a", "A", "top"), pin("k", "K", "bottom"), pin("g", "G", "left", 2 / 3)],
    attributes: [modelAttr("SCR_PHOTO")],
    toSpice: subckt(["a", "k", "g"]),
  },
  SIDAC: {
    kind: "SIDAC", category: "Thyristor", refdesPrefix: "XT", label: "SIDAC", glyph: "SIDAC", emits: true,
    pins: [pin("a1", "A1", "left"), pin("a2", "A2", "right")],
    attributes: [modelAttr("SIDAC_GEN")],
    toSpice: subckt(["a1", "a2"]),
  },

  // ---- Control -----------------------------------------------------------
  GATEDRV: {
    kind: "GATEDRV", category: "Control", refdesPrefix: "XDRV", label: "Gate driver", glyph: "DRV", emits: true,
    pins: [pin("in", "IN", "left"), pin("out", "OUT", "right"), pin("vdd", "VDD", "top"), pin("gnd", "GND", "bottom")],
    attributes: [modelAttr("GATEDRV_GEN")],
    toSpice: subckt(["in", "out", "vdd", "gnd"]),
  },
  COMP: {
    kind: "COMP", category: "Control", refdesPrefix: "XCMP", label: "Comparator", glyph: "▷=", emits: true,
    pins: [pin("inp", "+", "left", 0.3), pin("inn", "−", "left", 0.7), pin("out", "OUT", "right")],
    attributes: [modelAttr("COMP_GEN")],
    toSpice: subckt(["inp", "inn", "out"]),
  },
  EAMP: {
    // Kept for old circuits only — not in the palette (use OPAMP).
    kind: "EAMP", category: "Control", refdesPrefix: "XEA", label: "Error amp / op-amp", glyph: "▷A", emits: true,
    // 0.25/0.75 keep +/− on the 16px wire grid with the 64×64 symbol box.
    pins: [pin("inp", "+", "left", 0.25), pin("inn", "−", "left", 0.75), pin("out", "OUT", "right")],
    attributes: [modelAttr("OPAMP_GEN")],
    toSpice: subckt(["inp", "inn", "out"]),
  },

  // ---- Opamps ------------------------------------------------------------
  OPAMP: {
    kind: "OPAMP", category: "Opamp", refdesPrefix: "XU", label: "Op-Amp", glyph: "▷", emits: true,
    // Same 0.25/0.75 grid alignment as EAMP on a 64×64 box.
    pins: [pin("inp", "+", "left", 0.25), pin("inn", "−", "left", 0.75), pin("out", "OUT", "right")],
    attributes: [modelAttr("OPAMP")],
    toSpice: subckt(["inp", "inn", "out"]),
  },
  OPAMP5: {
    kind: "OPAMP5", category: "Opamp", refdesPrefix: "XU", label: "Op-Amp (5-pin)", glyph: "▷±", emits: true,
    pins: [
      pin("inp", "+", "left", 32 / 96),
      pin("inn", "−", "left", 64 / 96),
      pin("out", "OUT", "right"),
      pin("vplus", "V+", "top"),
      pin("vminus", "V−", "bottom"),
    ],
    attributes: [modelAttr("OPAMP5")],
    toSpice: subckt(["inp", "inn", "out", "vplus", "vminus"]),
  },
  DIFFAMP: {
    kind: "DIFFAMP", category: "Opamp", refdesPrefix: "XU", label: "Differential amp", glyph: "Δ▷", emits: true,
    pins: [pin("inp", "+", "left", 0.25), pin("inn", "−", "left", 0.75), pin("out", "OUT", "right")],
    attributes: [modelAttr("DIFFAMP")],
    toSpice: subckt(["inp", "inn", "out"]),
  },

  // ---- Logic -------------------------------------------------------------
  AND: {
    kind: "AND", category: "Logic", refdesPrefix: "XU", label: "AND gate", glyph: "&", emits: true,
    pins: [pin("a", "A", "left", 0.3), pin("b", "B", "left", 0.7), pin("y", "Y", "right")],
    attributes: [modelAttr("AND2")],
    toSpice: subckt(["a", "b", "y"]),
  },
  OR: {
    kind: "OR", category: "Logic", refdesPrefix: "XU", label: "OR gate", glyph: "≥1", emits: true,
    pins: [pin("a", "A", "left", 0.3), pin("b", "B", "left", 0.7), pin("y", "Y", "right")],
    attributes: [modelAttr("OR2")],
    toSpice: subckt(["a", "b", "y"]),
  },
  NAND: {
    kind: "NAND", category: "Logic", refdesPrefix: "XU", label: "NAND gate", glyph: "&̄", emits: true,
    pins: [pin("a", "A", "left", 0.3), pin("b", "B", "left", 0.7), pin("y", "Y", "right")],
    attributes: [modelAttr("NAND2")],
    toSpice: subckt(["a", "b", "y"]),
  },
  NOR: {
    kind: "NOR", category: "Logic", refdesPrefix: "XU", label: "NOR gate", glyph: "≥1̄", emits: true,
    pins: [pin("a", "A", "left", 0.3), pin("b", "B", "left", 0.7), pin("y", "Y", "right")],
    attributes: [modelAttr("NOR2")],
    toSpice: subckt(["a", "b", "y"]),
  },
  XOR: {
    kind: "XOR", category: "Logic", refdesPrefix: "XU", label: "XOR gate", glyph: "=1", emits: true,
    pins: [pin("a", "A", "left", 0.3), pin("b", "B", "left", 0.7), pin("y", "Y", "right")],
    attributes: [modelAttr("XOR2")],
    toSpice: subckt(["a", "b", "y"]),
  },
  XNOR: {
    kind: "XNOR", category: "Logic", refdesPrefix: "XU", label: "XNOR gate", glyph: "=1̄", emits: true,
    pins: [pin("a", "A", "left", 0.3), pin("b", "B", "left", 0.7), pin("y", "Y", "right")],
    attributes: [modelAttr("XNOR2")],
    toSpice: subckt(["a", "b", "y"]),
  },
  NOT: {
    kind: "NOT", category: "Logic", refdesPrefix: "XU", label: "NOT gate", glyph: "1", emits: true,
    pins: [pin("a", "A", "left"), pin("y", "Y", "right")],
    attributes: [modelAttr("INV")],
    toSpice: subckt(["a", "y"]),
  },

  // ---- Flip-flops --------------------------------------------------------
  SRFF: {
    kind: "SRFF", category: "Flipflop", refdesPrefix: "XU", label: "S-R FF", glyph: "SR", emits: true,
    pins: [
      pin("s", "S", "left", 0.25),
      pin("r", "R", "left", 0.75),
      pin("q", "Q", "right", 0.25),
      pin("qn", "Q̅", "right", 0.75),
    ],
    attributes: [modelAttr("SRFF")],
    toSpice: subckt(["s", "r", "q", "qn"]),
  },
  JKFF: {
    kind: "JKFF", category: "Flipflop", refdesPrefix: "XU", label: "J-K FF", glyph: "JK", emits: true,
    pins: [
      pin("j", "J", "left", 0.2),
      pin("clk", "CLK", "left", 0.5),
      pin("k", "K", "left", 0.8),
      pin("q", "Q", "right", 0.3),
      pin("qn", "Q̅", "right", 0.7),
    ],
    attributes: [modelAttr("JKFF")],
    toSpice: subckt(["j", "clk", "k", "q", "qn"]),
  },
  TFF: {
    kind: "TFF", category: "Flipflop", refdesPrefix: "XU", label: "T FF", glyph: "T", emits: true,
    pins: [
      pin("t", "T", "left", 0.3),
      pin("clk", "CLK", "left", 0.7),
      pin("q", "Q", "right", 0.3),
      pin("qn", "Q̅", "right", 0.7),
    ],
    attributes: [modelAttr("TFF")],
    toSpice: subckt(["t", "clk", "q", "qn"]),
  },
  DFF: {
    kind: "DFF", category: "Flipflop", refdesPrefix: "XU", label: "D FF", glyph: "D", emits: true,
    pins: [
      pin("d", "D", "left", 0.3),
      pin("clk", "CLK", "left", 0.7),
      pin("q", "Q", "right", 0.3),
      pin("qn", "Q̅", "right", 0.7),
    ],
    attributes: [modelAttr("DFF")],
    toSpice: subckt(["d", "clk", "q", "qn"]),
  },

  // ---- Math (Simulink-like) ----------------------------------------------
  MATH_CONST: {
    kind: "MATH_CONST", category: "Math", refdesPrefix: "XC", label: "Constant", glyph: "1", emits: true,
    pins: [pin("y", "Y", "right")],
    attributes: [A("value", "Constant value", "text", "1"), modelAttr("CONST")],
    toSpice: (r, n, p) => `${r} ${n("y")} ${p.model ?? "CONST"}`,
  },
  MATH_SUM: {
    kind: "MATH_SUM", category: "Math", refdesPrefix: "XS", label: "Sum", glyph: "Σ", emits: true,
    pins: sumPinsFromSigns("+-"),
    attributes: [
      A("signs", "List of signs", "text", "+-", {
        hint: "One + or − per input (e.g. +- or ++-). | spaces ignored.",
      }),
      modelAttr("SUM"),
    ],
    toSpice: (r, n, p) => {
      const pins = sumPinsFromSigns(p.signs ?? "+-");
      return `${r} ${pins.map((x) => n(x.id)).join(" ")} ${p.model ?? "SUM"}`;
    },
  },
  MATH_PROD: {
    kind: "MATH_PROD", category: "Math", refdesPrefix: "XP", label: "Product", glyph: "×÷", emits: true,
    pins: productPinsFromOps("**"),
    attributes: [
      A("ops", "Number of inputs", "text", "**", {
        hint: "* = multiply, / = divide per input (e.g. **/ or *//).",
      }),
      modelAttr("PRODUCT"),
    ],
    toSpice: (r, n, p) => {
      const pins = productPinsFromOps(p.ops ?? "**");
      return `${r} ${pins.map((x) => n(x.id)).join(" ")} ${p.model ?? "PRODUCT"}`;
    },
  },
  MATH_GAIN: {
    kind: "MATH_GAIN", category: "Math", refdesPrefix: "XG", label: "Gain", glyph: "▷1", emits: true,
    pins: [pin("u", "U", "left"), pin("y", "Y", "right")],
    attributes: [A("gain", "Gain", "text", "1"), modelAttr("GAIN")],
    toSpice: (r, n, p) => `${r} ${n("u")} ${n("y")} ${p.model ?? "GAIN"}`,
  },
  MATH_REL: {
    kind: "MATH_REL", category: "Math", refdesPrefix: "XR", label: "Relational\nOperator", glyph: "≤", emits: true,
    pins: [pin("a", "A", "left", 0.3), pin("b", "B", "left", 0.7), pin("y", "Y", "right")],
    attributes: [
      A("op", "Relational operator", "select", "<=", {
        options: ["==", "~=", "<", "<=", ">=", ">"],
      }),
      A("zerocross", "Enable zero-crossing detection", "checkbox", "1"),
      modelAttr("RELOP"),
    ],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${n("y")} ${p.model ?? "RELOP"}`,
  },
  MATH_LOGIC: {
    kind: "MATH_LOGIC", category: "Math", refdesPrefix: "XL", label: "Logical\nOperator", glyph: "AND", emits: true,
    pins: logicPinsFromOp("AND", "2"),
    attributes: [
      A("op", "Operator", "select", "AND", {
        options: ["AND", "OR", "NAND", "NOR", "XOR", "XNOR", "NOT"],
      }),
      A("inputs", "Number of input ports", "number", "2", {
        hint: "Ignored when Operator is NOT (always 1 input).",
      }),
      modelAttr("LOGICOP"),
    ],
    toSpice: (r, n, p) => {
      const pins = logicPinsFromOp(p.op ?? "AND", p.inputs ?? "2");
      return `${r} ${pins.map((x) => n(x.id)).join(" ")} ${p.model ?? "LOGICOP"}`;
    },
  },

  // ---- Switches ----------------------------------------------------------
  SPST: {
    kind: "SPST", category: "Switch", refdesPrefix: "S", label: "SPST", glyph: "SW", emits: true,
    pins: [pin("a", "A", "left"), pin("b", "B", "right")],
    attributes: [A("state", "State", "select", "open", { options: ["open", "closed"] })],
    toSpice: (r, n, p) =>
      p.state === "closed"
        ? `${r} ${n("a")} ${n("b")} 1m`
        : `* ${r} SPST open (${n("a")} ${n("b")})`,
  },
  SPDT: {
    kind: "SPDT", category: "Switch", refdesPrefix: "S", label: "SPDT", glyph: "SW↕", emits: true,
    pins: [pin("c", "C", "left"), pin("no", "NO", "right", 0.3), pin("nc", "NC", "right", 0.7)],
    attributes: [A("throw", "Throw", "select", "no", { options: ["no", "nc"] })],
    toSpice: (r, n, p) =>
      p.throw === "nc"
        ? `${r} ${n("c")} ${n("nc")} 1m`
        : `${r} ${n("c")} ${n("no")} 1m`,
  },
  PB: {
    kind: "PB", category: "Switch", refdesPrefix: "S", label: "Push button", glyph: "PB", emits: true,
    pins: [pin("a", "A", "left"), pin("b", "B", "right")],
    attributes: [A("state", "State", "select", "open", { options: ["open", "closed"] })],
    toSpice: (r, n, p) =>
      p.state === "closed"
        ? `${r} ${n("a")} ${n("b")} 1m`
        : `* ${r} push-button open (${n("a")} ${n("b")})`,
  },

  // ---- Sense / Probe -----------------------------------------------------
  CSENSE: {
    kind: "CSENSE", category: "Sense / Probe", refdesPrefix: "Rs", label: "Current sense (shunt)", glyph: "Ω→", emits: true,
    pins: LR, attributes: [A("value", "Shunt", "text", "10m", { unit: "Ω" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${spiceOhm(p.value, "10m")}`,
    toProbes: (r) => [`I(${r})`],
  },
  VSENSE: {
    kind: "VSENSE", category: "Sense / Probe", refdesPrefix: "", label: "Voltage sense", glyph: "V⤢", emits: false,
    pins: [pin("p", "+", "left"), pin("n", "−", "right")],
    attributes: [A("name", "Signal name", "text", "vsns")],
    toSpice: () => null,
    toProbes: (_r, n) => [`V(${n("p")},${n("n")})`],
  },
  IPROBE: {
    kind: "IPROBE", category: "Sense / Probe", refdesPrefix: "Vpr", label: "Current probe (ammeter)", glyph: "A", emits: true,
    // classic 0 V source in series -> measure its branch current
    pins: LR, attributes: [],
    toSpice: (r, n) => `${r} ${n("a")} ${n("b")} 0`,
    toProbes: (r) => [`I(${r})`],
  },
  VPROBE: {
    kind: "VPROBE", category: "Sense / Probe", refdesPrefix: "", label: "Voltage probe", glyph: "V", emits: false,
    pins: [pin("p", "•", "top")],
    attributes: [],
    toSpice: () => null,
    toProbes: (_r, n) => [`V(${n("p")})`],
  },

  // ---- Structural --------------------------------------------------------
  GND: {
    kind: "GND", category: "Structural", refdesPrefix: "", label: "Ground", glyph: "⏚", emits: false,
    pins: [pin("g", "", "top")], attributes: [],
    toSpice: () => null, // ground is net 0, not a device
  },
  GND_SIG: {
    kind: "GND_SIG", category: "Structural", refdesPrefix: "", label: "DIG / ANG ground", glyph: "▽", emits: false,
    pins: [pin("g", "", "top")], attributes: [],
    toSpice: () => null,
  },
  GND_CH: {
    kind: "GND_CH", category: "Structural", refdesPrefix: "", label: "Chassis ground", glyph: "⑂", emits: false,
    pins: [pin("g", "", "top")], attributes: [],
    toSpice: () => null,
  },
  NODE: {
    kind: "NODE", category: "Structural", refdesPrefix: "", label: "Net label", glyph: "◦", emits: false,
    pins: [pin("g", "", "left")],
    attributes: [A("name", "Net name", "text", "net")],
    toSpice: () => null, // forces its net's NAME (see nets.ts)
  },
  /**
   * LTspice Label Net: plain text that names a net. An invisible join point
   * snaps to a wire or device pin under the text (no visible pin mark).
   */
  WIRELABEL: {
    kind: "WIRELABEL", category: "Structural", refdesPrefix: "", label: "Net name", glyph: "A", emits: false,
    pins: [pin("g", "", "bottom", 0.5)],
    attributes: [A("name", "Name", "text", "")],
    toSpice: () => null,
  },
  /** Dangling wire end (Esc mid-route). Not in palette; emits nothing. */
  TIP: {
    kind: "TIP", category: "Structural", refdesPrefix: "", label: "Wire end", glyph: "·", emits: false,
    pins: [pin("t", "", "left", 0.5)],
    attributes: [],
    toSpice: () => null,
  },
};

/** True for earth / signal / chassis ground symbols (all collapse to net 0). */
export function isGroundKind(kind: ComponentKind): boolean {
  return kind === "GND" || kind === "GND_SIG" || kind === "GND_CH";
}

/**
 * Effective pins for a part — math blocks derive ports from params
 * (Sum signs / Product ops / Logical NOT vs multi-input).
 */
export function getComponentPins(
  kind: ComponentKind,
  params: Record<string, string> = {},
): PinSpec[] {
  switch (kind) {
    case "MATH_SUM":
      return sumPinsFromSigns(params.signs ?? COMPONENT_SPECS.MATH_SUM.attributes[0]!.default);
    case "MATH_PROD":
      return productPinsFromOps(params.ops ?? COMPONENT_SPECS.MATH_PROD.attributes[0]!.default);
    case "MATH_LOGIC":
      return logicPinsFromOp(params.op ?? "AND", params.inputs ?? "2");
    default:
      return COMPONENT_SPECS[kind].pins;
  }
}

/** Build the default params map for a kind from its attribute schema. */
export function defaultParams(kind: ComponentKind): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of COMPONENT_SPECS[kind].attributes) out[a.key] = a.default;
  // Net-name join box is 16×16 (see layout.ts); marks labels so we don't
  // re-apply the old 64×48 → 16×16 position migration.
  if (kind === "WIRELABEL") out._lb = "2";
  return out;
}

/** Sort palette entries A→Z by visible label. */
function paletteAlpha(kinds: ComponentKind[]): ComponentKind[] {
  return [...kinds].sort((a, b) =>
    COMPONENT_SPECS[a].label.localeCompare(COMPONENT_SPECS[b].label),
  );
}

/** Fixed Sources list (spec §B) — includes GND. */
const SOURCE_KINDS: ComponentKind[] = [
  "BATTERY",
  "VAC",
  "I",
  "IAC",
  "VPULSE",
  "GND",
];

/** Category sections after Commonly used — A→Z by category, parts A→Z inside. */
const PALETTE_SECTIONS: { category: Category; kinds: ComponentKind[] }[] = [
  { category: "Capacitor", kinds: paletteAlpha(["C", "CFIXED", "CPOL", "CVAR"]) },
  { category: "Control", kinds: paletteAlpha(["COMP", "GATEDRV"]) },
  {
    category: "Flipflop",
    kinds: paletteAlpha(["DFF", "JKFF", "SRFF", "TFF"]),
  },
  { category: "Inductor", kinds: paletteAlpha(["L", "LVAR", "XFMR"]) },
  {
    category: "Logic",
    kinds: paletteAlpha(["AND", "NAND", "NOR", "NOT", "OR", "XNOR", "XOR"]),
  },
  {
    category: "Math",
    kinds: paletteAlpha([
      "MATH_CONST",
      "MATH_GAIN",
      "MATH_LOGIC",
      "MATH_PROD",
      "MATH_REL",
      "MATH_SUM",
    ]),
  },
  { category: "Opamp", kinds: paletteAlpha(["DIFFAMP", "OPAMP", "OPAMP5"]) },
  {
    category: "Passive",
    kinds: paletteAlpha(["ANT", "CMMC", "FBEAD", "XTAL"]),
  },
  {
    category: "Resistor",
    kinds: paletteAlpha(["LDR", "POT", "POTBOX", "R", "RBOX", "RVAR", "RVARBOX", "THERM"]),
  },
  {
    category: "Semiconductor",
    kinds: paletteAlpha([
      "D",
      "DS",
      "DTVS",
      "DTVSBI",
      "DZ",
      "LED",
      "SICMOS",
      "SICMOS_K",
    ]),
  },
  {
    category: "Sense / Probe",
    kinds: paletteAlpha(["CSENSE", "IPROBE", "VPROBE", "VSENSE"]),
  },
  { category: "Sources", kinds: SOURCE_KINDS },
  { category: "Structural", kinds: paletteAlpha(["GND_CH", "GND_SIG", "NODE"]) },
  { category: "Switch", kinds: paletteAlpha(["PB", "SPDT", "SPST"]) },
  {
    category: "Thyristor",
    kinds: paletteAlpha(["DIAC", "GTO", "SCR", "SCR_PH", "SCS", "SIDAC", "TRIAC"]),
  },
  {
    category: "Transistor",
    kinds: paletteAlpha([
      "GANHEMT",
      "IGBT",
      "IGBT_K",
      "NJFET",
      "NMOS",
      "NMOS_D",
      "NPN",
      "PJFET",
      "PMOS",
      "PMOS_D",
      "PNP",
      "UJT",
    ]),
  },
];

/**
 * Still in COMPONENT_SPECS (circuits / load / netlist work) — just not shown
 * in the left palette until we want them back.
 */
const PALETTE_HIDDEN = new Set<ComponentKind>([
  // Passives / RF extras
  "CMMC",
  "FBEAD",
  "ANT",
  // Inductor
  "XFMR",
  // Entire Math section
  "MATH_CONST",
  "MATH_SUM",
  "MATH_PROD",
  "MATH_GAIN",
  "MATH_REL",
  "MATH_LOGIC",
  // Entire Flipflop section
  "DFF",
  "JKFF",
  "SRFF",
  "TFF",
  // Entire Logic section
  "AND",
  "NAND",
  "NOR",
  "NOT",
  "OR",
  "XNOR",
  "XOR",
  // Entire Switch section
  "SPST",
  "SPDT",
  "PB",
  // Entire Sense / Probe section
  "CSENSE",
  "IPROBE",
  "VPROBE",
  "VSENSE",
  // Entire Thyristor section
  "DIAC",
  "GTO",
  "SCR",
  "SCR_PH",
  "SCS",
  "SIDAC",
  "TRIAC",
]);

export function isPaletteHidden(kind: ComponentKind): boolean {
  return PALETTE_HIDDEN.has(kind);
}

/**
 * Build the left palette: Commonly used (session) first, then A→Z categories.
 * `commonlyUsed` is ordered most-recent-first (callers may prepend pinned basics).
 */
export function buildPalette(
  commonlyUsed: readonly ComponentKind[] = [],
): { category: Category; kinds: ComponentKind[] }[] {
  const seen = new Set<ComponentKind>();
  const common: ComponentKind[] = [];
  for (const k of commonlyUsed) {
    if (!COMPONENT_SPECS[k] || k === "TIP" || k === "WIRELABEL") continue;
    if (PALETTE_HIDDEN.has(k)) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    common.push(k);
  }
  const sections = PALETTE_SECTIONS.map((sec) => ({
    ...sec,
    kinds: sec.kinds.filter((k) => !PALETTE_HIDDEN.has(k)),
  })).filter((sec) => sec.kinds.length > 0);
  return [
    { category: "Commonly used", kinds: common },
    ...sections,
  ];
}

/** @deprecated Prefer buildPalette(sessionKinds). Static snapshot without session history. */
export const PALETTE = buildPalette([]);
