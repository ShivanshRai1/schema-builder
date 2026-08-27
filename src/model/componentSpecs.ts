import type { AttributeSpec, Category, ComponentKind, PinSpec } from "./types";

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
    pins: LR, attributes: [A("value", "Resistance", "text", "10k", { unit: "Ω" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${p.value ?? "10k"}`,
  },
  RBOX: {
    kind: "RBOX", category: "Resistor", refdesPrefix: "R", label: "Fixed resistor (box)", glyph: "▭", emits: true,
    pins: LR, attributes: [A("value", "Resistance", "text", "10k", { unit: "Ω" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${p.value ?? "10k"}`,
  },
  RVAR: {
    kind: "RVAR", category: "Resistor", refdesPrefix: "R", label: "Variable / rheostat", glyph: "∿↗", emits: true,
    pins: LR, attributes: [A("value", "Resistance", "text", "10k", { unit: "Ω" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${p.value ?? "10k"}`,
  },
  RVARBOX: {
    kind: "RVARBOX", category: "Resistor", refdesPrefix: "R", label: "Variable (box)", glyph: "▭↗", emits: true,
    pins: LR, attributes: [A("value", "Resistance", "text", "10k", { unit: "Ω" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${p.value ?? "10k"}`,
  },
  POT: {
    kind: "POT", category: "Resistor", refdesPrefix: "R", label: "Potentiometer", glyph: "∿⊥", emits: true,
    pins: [pin("a", "a", "left"), pin("w", "w", "top"), pin("b", "b", "right")],
    attributes: [A("value", "Total resistance", "text", "10k", { unit: "Ω" })],
    // Two series halves sharing the wiper (standard schematic→SPICE mapping).
    toSpice: (r, n, p) => {
      const v = p.value ?? "10k";
      return `${r}A ${n("a")} ${n("w")} {${v}/2}\n${r}B ${n("w")} ${n("b")} {${v}/2}`;
    },
  },
  POTBOX: {
    kind: "POTBOX", category: "Resistor", refdesPrefix: "R", label: "Potentiometer (box)", glyph: "▭⊥", emits: true,
    pins: [pin("a", "a", "left"), pin("w", "w", "top"), pin("b", "b", "right")],
    attributes: [A("value", "Total resistance", "text", "10k", { unit: "Ω" })],
    toSpice: (r, n, p) => {
      const v = p.value ?? "10k";
      return `${r}A ${n("a")} ${n("w")} {${v}/2}\n${r}B ${n("w")} ${n("b")} {${v}/2}`;
    },
  },

  // ---- Inductors ---------------------------------------------------------
  L: {
    kind: "L", category: "Inductor", refdesPrefix: "L", label: "Air core inductor", glyph: "◠◠", emits: true,
    pins: LR, attributes: [A("value", "Inductance", "text", "1u", { unit: "H" }), A("ic", "Initial current", "text", "", { unit: "A" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${p.value ?? "1u"}${p.ic ? ` ic=${p.ic}` : ""}`,
  },
  LVAR: {
    kind: "LVAR", category: "Inductor", refdesPrefix: "L", label: "Variable inductor", glyph: "◠↗", emits: true,
    pins: LR, attributes: [A("value", "Inductance", "text", "1u", { unit: "H" }), A("ic", "Initial current", "text", "", { unit: "A" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${p.value ?? "1u"}${p.ic ? ` ic=${p.ic}` : ""}`,
  },

  // ---- Capacitors --------------------------------------------------------
  C: {
    kind: "C", category: "Capacitor", refdesPrefix: "C", label: "Non-polarized", glyph: "||", emits: true,
    pins: LR, attributes: [A("value", "Capacitance", "text", "1n", { unit: "F" }), A("ic", "Initial voltage", "text", "", { unit: "V" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${p.value ?? "1n"}${p.ic ? ` ic=${p.ic}` : ""}`,
  },
  CPOL: {
    kind: "CPOL", category: "Capacitor", refdesPrefix: "C", label: "Polarized", glyph: "|)", emits: true,
    pins: [pin("a", "+", "left"), pin("b", "−", "right")],
    attributes: [A("value", "Capacitance", "text", "10u", { unit: "F" }), A("ic", "Initial voltage", "text", "", { unit: "V" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${p.value ?? "10u"}${p.ic ? ` ic=${p.ic}` : ""}`,
  },
  CFIXED: {
    kind: "CFIXED", category: "Capacitor", refdesPrefix: "C", label: "Fixed capacitor", glyph: "|)", emits: true,
    pins: LR, attributes: [A("value", "Capacitance", "text", "1n", { unit: "F" }), A("ic", "Initial voltage", "text", "", { unit: "V" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${p.value ?? "1n"}${p.ic ? ` ic=${p.ic}` : ""}`,
  },
  CVAR: {
    kind: "CVAR", category: "Capacitor", refdesPrefix: "C", label: "Variable capacitor", glyph: "|)↗", emits: true,
    pins: LR, attributes: [A("value", "Capacitance", "text", "100p", { unit: "F" }), A("ic", "Initial voltage", "text", "", { unit: "V" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${p.value ?? "100p"}${p.ic ? ` ic=${p.ic}` : ""}`,
  },

  // ---- Sources -----------------------------------------------------------
  V: {
    kind: "V", category: "Source", refdesPrefix: "V", label: "Voltage source", glyph: "(~)", emits: true,
    pins: PN,
    attributes: [A("value", "Value / stimulus", "text", "DC 12", { hint: "e.g. DC 12, AC 1, PULSE(0 5 0 1n 1n 5u 10u)" })],
    toSpice: (r, n, p) => `${r} ${n("p")} ${n("n")} ${p.value ?? "DC 0"}`,
  },
  I: {
    kind: "I", category: "Source", refdesPrefix: "I", label: "Current source", glyph: "(→)", emits: true,
    pins: PN, attributes: [A("value", "Value / stimulus", "text", "DC 1", { hint: "e.g. DC 1, PWL(...)" })],
    toSpice: (r, n, p) => `${r} ${n("p")} ${n("n")} ${p.value ?? "DC 0"}`,
  },

  // ---- Transistors -------------------------------------------------------
  NMOS: {
    kind: "NMOS", category: "Transistor", refdesPrefix: "M", label: "MOSFET N (enh)", glyph: "⊐N", emits: true,
    pins: [pin("d", "D", "top"), pin("g", "G", "left"), pin("s", "S", "bottom")],
    attributes: [modelAttr("NMOS_GEN"), A("bulk", "Bulk", "select", "source", { options: ["source", "explicit"] })],
    toSpice: (r, n, p) => `${r} ${n("d")} ${n("g")} ${n("s")} ${n("s")} ${p.model ?? "NMOS_GEN"}`,
  },
  PMOS: {
    kind: "PMOS", category: "Transistor", refdesPrefix: "M", label: "MOSFET P (enh)", glyph: "⊐P", emits: true,
    pins: [pin("d", "D", "bottom"), pin("g", "G", "left"), pin("s", "S", "top")],
    attributes: [modelAttr("PMOS_GEN")],
    toSpice: (r, n, p) => `${r} ${n("d")} ${n("g")} ${n("s")} ${n("s")} ${p.model ?? "PMOS_GEN"}`,
  },
  NMOS_D: {
    kind: "NMOS_D", category: "Transistor", refdesPrefix: "M", label: "MOSFET N (dep)", glyph: "⊐Nd", emits: true,
    pins: [pin("d", "D", "top"), pin("g", "G", "left"), pin("s", "S", "bottom")],
    attributes: [modelAttr("NMOS_DEP")],
    toSpice: (r, n, p) => `${r} ${n("d")} ${n("g")} ${n("s")} ${n("s")} ${p.model ?? "NMOS_DEP"}`,
  },
  PMOS_D: {
    kind: "PMOS_D", category: "Transistor", refdesPrefix: "M", label: "MOSFET P (dep)", glyph: "⊐Pd", emits: true,
    pins: [pin("d", "D", "top"), pin("g", "G", "left"), pin("s", "S", "bottom")],
    attributes: [modelAttr("PMOS_DEP")],
    toSpice: (r, n, p) => `${r} ${n("d")} ${n("g")} ${n("s")} ${n("s")} ${p.model ?? "PMOS_DEP"}`,
  },
  NJFET: {
    kind: "NJFET", category: "Transistor", refdesPrefix: "J", label: "JFET (N)", glyph: "⊢N", emits: true,
    pins: [pin("d", "D", "top"), pin("g", "G", "left"), pin("s", "S", "bottom")],
    attributes: [modelAttr("NJF")],
    toSpice: (r, n, p) => `${r} ${n("d")} ${n("g")} ${n("s")} ${p.model ?? "NJF"}`,
  },
  PJFET: {
    kind: "PJFET", category: "Transistor", refdesPrefix: "J", label: "JFET (P)", glyph: "⊢P", emits: true,
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
    pins: [pin("c", "C", "bottom"), pin("b", "B", "left"), pin("e", "E", "top")],
    attributes: [modelAttr("PNP_GEN")],
    toSpice: (r, n, p) => `${r} ${n("c")} ${n("b")} ${n("e")} ${p.model ?? "PNP_GEN"}`,
  },

  // ---- Semiconductors (diode / power) ------------------------------------
  D: {
    kind: "D", category: "Semiconductor", refdesPrefix: "D", label: "Diode", glyph: "▷|", emits: true,
    pins: [pin("a", "A", "left"), pin("k", "K", "right")],
    attributes: [modelAttr("DGEN")],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("k")} ${p.model ?? "DGEN"}`,
  },
  SICMOS: {
    kind: "SICMOS", category: "Semiconductor", refdesPrefix: "XM", label: "SiC MOSFET", glyph: "SiC", emits: true,
    pins: [pin("d", "D", "top"), pin("g", "G", "left"), pin("s", "S", "bottom")],
    attributes: [modelAttr("SIC_MOS")],
    toSpice: subckt(["d", "g", "s"]),
  },
  SICMOS_K: {
    kind: "SICMOS_K", category: "Semiconductor", refdesPrefix: "XMK", label: "SiC MOSFET (Kelvin)", glyph: "SiCₖ", emits: true,
    // 4-terminal: power source S + Kelvin (gate-return) source SK.
    pins: [pin("d", "D", "top"), pin("g", "G", "left"), pin("s", "S", "bottom", 0.7), pin("sk", "SK", "bottom", 0.3)],
    attributes: [modelAttr("SIC_MOS_KELVIN")],
    toSpice: subckt(["d", "g", "s", "sk"]),
  },
  GANHEMT: {
    kind: "GANHEMT", category: "Semiconductor", refdesPrefix: "XG", label: "GaN HEMT", glyph: "GaN", emits: true,
    pins: [pin("d", "D", "top"), pin("g", "G", "left"), pin("s", "S", "bottom")],
    attributes: [modelAttr("GAN_HEMT")],
    toSpice: subckt(["d", "g", "s"]),
  },
  IGBT: {
    kind: "IGBT", category: "Semiconductor", refdesPrefix: "XQ", label: "IGBT", glyph: "IGBT", emits: true,
    // C/E sit on the right of the circle (matches reference); G on the left.
    pins: [pin("c", "C", "top", 0.625), pin("g", "G", "left"), pin("e", "E", "bottom", 0.625)],
    attributes: [modelAttr("IGBT_GEN")],
    toSpice: subckt(["c", "g", "e"]),
  },
  IGBT_K: {
    kind: "IGBT_K", category: "Semiconductor", refdesPrefix: "XQK", label: "IGBT (Kelvin)", glyph: "IGBTₖ", emits: true,
    pins: [
      pin("c", "C", "top", 0.625),
      pin("g", "G", "left"),
      pin("e", "E", "bottom", 0.72),
      pin("ek", "EK", "bottom", 0.4),
    ],
    attributes: [modelAttr("IGBT_KELVIN")],
    toSpice: subckt(["c", "g", "e", "ek"]),
  },
  SCR: {
    kind: "SCR", category: "Semiconductor", refdesPrefix: "XT", label: "Thyristor / SCR", glyph: "▷|⊥", emits: true,
    // Chart orientation: anode–cathode horizontal, gate from cathode junction down.
    pins: [pin("a", "A", "left"), pin("k", "K", "right"), pin("g", "G", "bottom", 0.75)],
    attributes: [modelAttr("SCR_GEN")],
    toSpice: subckt(["a", "k", "g"]),
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
    kind: "EAMP", category: "Control", refdesPrefix: "XEA", label: "Error amp / op-amp", glyph: "▷A", emits: true,
    // 0.25/0.75 keep +/− on the 16px wire grid with the 64×64 symbol box.
    pins: [pin("inp", "+", "left", 0.25), pin("inn", "−", "left", 0.75), pin("out", "OUT", "right")],
    attributes: [modelAttr("OPAMP_GEN")],
    toSpice: subckt(["inp", "inn", "out"]),
  },

  // ---- Opamps ------------------------------------------------------------
  OPAMP: {
    kind: "OPAMP", category: "Opamp", refdesPrefix: "XU", label: "Basic opamp", glyph: "▷", emits: true,
    // Same 0.25/0.75 grid alignment as EAMP on a 64×64 box.
    pins: [pin("inp", "+", "left", 0.25), pin("inn", "−", "left", 0.75), pin("out", "OUT", "right")],
    attributes: [modelAttr("OPAMP")],
    toSpice: subckt(["inp", "inn", "out"]),
  },
  OPAMP5: {
    kind: "OPAMP5", category: "Opamp", refdesPrefix: "XU", label: "General opamp", glyph: "▷±", emits: true,
    // h=96 → left pins at y=32 / y=64 stay on the 16px wire grid; supplies at top/bottom center.
    pins: [
      pin("inp", "+", "left", 32 / 96),
      pin("inn", "−", "left", 64 / 96),
      pin("out", "OUT", "right"),
      pin("vplus", "V+", "top"),
      pin("vminus", "V−", "bottom"),
    ],
    attributes: [modelAttr("OPAMP")],
    toSpice: subckt(["inp", "inn", "out", "vplus", "vminus"]),
  },

  // ---- Sense / Probe -----------------------------------------------------
  CSENSE: {
    kind: "CSENSE", category: "Sense / Probe", refdesPrefix: "Rs", label: "Current sense (shunt)", glyph: "Ω→", emits: true,
    pins: LR, attributes: [A("value", "Shunt", "text", "10m", { unit: "Ω" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${p.value ?? "10m"}`,
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
    pins: [pin("p", "•", "bottom")],
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
  NODE: {
    kind: "NODE", category: "Structural", refdesPrefix: "", label: "Net label", glyph: "◦", emits: false,
    pins: [pin("g", "", "left")],
    attributes: [A("name", "Net name", "text", "net")],
    toSpice: () => null, // forces its net's NAME (see nets.ts)
  },
  /** Dangling wire end (Esc mid-route). Not in palette; emits nothing. */
  TIP: {
    kind: "TIP", category: "Structural", refdesPrefix: "", label: "Wire end", glyph: "·", emits: false,
    pins: [pin("t", "", "left", 0.5)],
    attributes: [],
    toSpice: () => null,
  },
};

/** Build the default params map for a kind from its attribute schema. */
export function defaultParams(kind: ComponentKind): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of COMPONENT_SPECS[kind].attributes) out[a.key] = a.default;
  return out;
}

/** Palette layout: kinds grouped and ordered by category. */
export const PALETTE: { category: Category; kinds: ComponentKind[] }[] = [
  {
    category: "Resistor",
    // Chart order: fixed → variable/rheostat → potentiometer (zigzag + box each)
    kinds: ["R", "RBOX", "RVAR", "RVARBOX", "POT", "POTBOX"],
  },
  {
    category: "Capacitor",
    kinds: ["C", "CPOL", "CFIXED", "CVAR"],
  },
  { category: "Inductor", kinds: ["L", "LVAR"] },
  { category: "Source", kinds: ["V", "I"] },
  {
    category: "Transistor",
    // Chart order: BJT → JFET → depletion MOSFET → enhancement MOSFET
    kinds: ["NPN", "PNP", "NJFET", "PJFET", "NMOS_D", "PMOS_D", "NMOS", "PMOS"],
  },
  {
    category: "Semiconductor",
    kinds: ["D", "SICMOS", "SICMOS_K", "GANHEMT", "IGBT", "IGBT_K", "SCR"],
  },
  { category: "Opamp", kinds: ["OPAMP", "OPAMP5"] },
  { category: "Control", kinds: ["GATEDRV", "COMP", "EAMP"] },
  { category: "Sense / Probe", kinds: ["CSENSE", "VSENSE", "IPROBE", "VPROBE"] },
  { category: "Structural", kinds: ["GND", "NODE"] },
];
