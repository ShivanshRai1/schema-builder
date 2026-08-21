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
  // ---- Passives ----------------------------------------------------------
  R: {
    kind: "R", category: "Passive", refdesPrefix: "R", label: "Resistor", glyph: "▭", emits: true,
    pins: LR, attributes: [A("value", "Resistance", "text", "10k", { unit: "Ω" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${p.value ?? "10k"}`,
  },
  L: {
    kind: "L", category: "Passive", refdesPrefix: "L", label: "Inductor", glyph: "◠◠", emits: true,
    pins: LR, attributes: [A("value", "Inductance", "text", "1u", { unit: "H" }), A("ic", "Initial current", "text", "", { unit: "A" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${p.value ?? "1u"}${p.ic ? ` ic=${p.ic}` : ""}`,
  },
  C: {
    kind: "C", category: "Passive", refdesPrefix: "C", label: "Capacitor", glyph: "||", emits: true,
    pins: LR, attributes: [A("value", "Capacitance", "text", "1n", { unit: "F" }), A("ic", "Initial voltage", "text", "", { unit: "V" })],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("b")} ${p.value ?? "1n"}${p.ic ? ` ic=${p.ic}` : ""}`,
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

  // ---- Semiconductors ----------------------------------------------------
  D: {
    kind: "D", category: "Semiconductor", refdesPrefix: "D", label: "Diode", glyph: "▷|", emits: true,
    pins: [pin("a", "A", "left"), pin("k", "K", "right")],
    attributes: [modelAttr("DGEN")],
    toSpice: (r, n, p) => `${r} ${n("a")} ${n("k")} ${p.model ?? "DGEN"}`,
  },
  NMOS: {
    kind: "NMOS", category: "Semiconductor", refdesPrefix: "M", label: "MOSFET (N)", glyph: "⊐N", emits: true,
    pins: [pin("d", "D", "top"), pin("g", "G", "left"), pin("s", "S", "bottom")],
    attributes: [modelAttr("NMOS_GEN"), A("bulk", "Bulk", "select", "source", { options: ["source", "explicit"] })],
    toSpice: (r, n, p) => `${r} ${n("d")} ${n("g")} ${n("s")} ${n("s")} ${p.model ?? "NMOS_GEN"}`,
  },
  PMOS: {
    kind: "PMOS", category: "Semiconductor", refdesPrefix: "M", label: "MOSFET (P)", glyph: "⊐P", emits: true,
    pins: [pin("d", "D", "bottom"), pin("g", "G", "left"), pin("s", "S", "top")],
    attributes: [modelAttr("PMOS_GEN")],
    toSpice: (r, n, p) => `${r} ${n("d")} ${n("g")} ${n("s")} ${n("s")} ${p.model ?? "PMOS_GEN"}`,
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
    pins: [pin("c", "C", "top"), pin("g", "G", "left"), pin("e", "E", "bottom")],
    attributes: [modelAttr("IGBT_GEN")],
    toSpice: subckt(["c", "g", "e"]),
  },
  IGBT_K: {
    kind: "IGBT_K", category: "Semiconductor", refdesPrefix: "XQK", label: "IGBT (Kelvin)", glyph: "IGBTₖ", emits: true,
    pins: [pin("c", "C", "top"), pin("g", "G", "left"), pin("e", "E", "bottom", 0.7), pin("ek", "EK", "bottom", 0.3)],
    attributes: [modelAttr("IGBT_KELVIN")],
    toSpice: subckt(["c", "g", "e", "ek"]),
  },
  NPN: {
    kind: "NPN", category: "Semiconductor", refdesPrefix: "Q", label: "BJT (NPN)", glyph: "⤳N", emits: true,
    pins: [pin("c", "C", "top"), pin("b", "B", "left"), pin("e", "E", "bottom")],
    attributes: [modelAttr("NPN_GEN")],
    toSpice: (r, n, p) => `${r} ${n("c")} ${n("b")} ${n("e")} ${p.model ?? "NPN_GEN"}`,
  },
  PNP: {
    kind: "PNP", category: "Semiconductor", refdesPrefix: "Q", label: "BJT (PNP)", glyph: "⤳P", emits: true,
    pins: [pin("c", "C", "bottom"), pin("b", "B", "left"), pin("e", "E", "top")],
    attributes: [modelAttr("PNP_GEN")],
    toSpice: (r, n, p) => `${r} ${n("c")} ${n("b")} ${n("e")} ${p.model ?? "PNP_GEN"}`,
  },
  SCR: {
    kind: "SCR", category: "Semiconductor", refdesPrefix: "XT", label: "Thyristor / SCR", glyph: "SCR", emits: true,
    pins: [pin("a", "A", "top"), pin("k", "K", "bottom"), pin("g", "G", "left")],
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
  { category: "Passive", kinds: ["R", "L", "C"] },
  { category: "Source", kinds: ["V", "I"] },
  { category: "Semiconductor", kinds: ["D", "NMOS", "PMOS", "SICMOS", "SICMOS_K", "GANHEMT", "IGBT", "IGBT_K", "NPN", "PNP", "SCR"] },
  { category: "Control", kinds: ["GATEDRV", "COMP", "EAMP"] },
  { category: "Sense / Probe", kinds: ["CSENSE", "VSENSE", "IPROBE", "VPROBE"] },
  { category: "Structural", kinds: ["GND", "NODE"] },
];
