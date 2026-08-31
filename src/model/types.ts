// ---------------------------------------------------------------------------
// Core circuit model.
//
// GRAPH IS THE SOURCE OF TRUTH. The React Flow graph (nodes + edges) plus the
// per-node `ComponentData` below IS the circuit. The netlist is a *derived*
// projection produced by src/netlist/toNetlist.ts. Nothing downstream should
// treat the netlist text as authoritative in step 1.
//
// STEP-2 SEAM: when the text panel becomes editable, a parser will diff the
// edited netlist against these structures and patch them BY REFDES, preserving
// node positions. That importer writes into exactly this model.
// ---------------------------------------------------------------------------

/**
 * Every component family. Grouped by category in the palette.
 * Add a new family = add a kind here + one entry in componentSpecs.ts.
 */
export type ComponentKind =
  // passives / resistors
  | "R" | "RBOX" | "RVAR" | "RVARBOX" | "POT" | "POTBOX"
  // inductors
  | "L" | "LVAR"
  // capacitors
  | "C" | "CPOL" | "CFIXED" | "CVAR"
  // sources
  | "V" | "I"
  // semiconductors
  | "D" | "DZ" | "NMOS" | "PMOS" | "NMOS_D" | "PMOS_D" | "NJFET" | "PJFET"
  | "SICMOS" | "SICMOS_K" | "GANHEMT"
  | "IGBT" | "IGBT_K" | "NPN" | "PNP" | "SCR"
  // drivers / control / opamps
  | "GATEDRV" | "COMP" | "EAMP" | "OPAMP" | "OPAMP5"
  // sense / probes
  | "CSENSE" | "VSENSE" | "IPROBE" | "VPROBE"
  // structural
  | "GND" | "NODE" | "TIP";

export type Category =
  | "Most used"
  | "Resistor"
  | "Capacitor"
  | "Inductor"
  | "Source"
  | "Transistor"
  | "Semiconductor"
  | "Opamp"
  | "Control"
  | "Sense / Probe"
  | "Structural";

/** A physical pin on a component (maps to a React Flow Handle). */
export interface PinSpec {
  /** Stable pin id, unique within the component (e.g. "a", "g", "d"). */
  id: string;
  /** Human label shown near the handle. */
  label: string;
  /** Which edge of the node box the handle sits on. */
  side: "left" | "right" | "top" | "bottom";
  /** 0..1 position along that side. */
  offset: number;
}

/** Input kind the attribute editor renders for a parameter. */
export type AttrType = "text" | "number" | "select";

/** Declarative schema for one editable attribute of a component. */
export interface AttributeSpec {
  /** Key stored in ComponentData.params. */
  key: string;
  label: string;
  type: AttrType;
  /** Default value (string form; numbers are stored as strings for SPICE). */
  default: string;
  /** Optional unit shown in the editor (e.g. "Ω", "F", "V"). */
  unit?: string;
  /** For type === "select". */
  options?: string[];
  /** Helper text under the field. */
  hint?: string;
}

/** Clockwise orientation; pin ids are stable — only Handle geometry changes. */
export type ComponentRotation = 0 | 90 | 180 | 270;

/** Where refdes / value text sits relative to the symbol body. */
export type LabelPosition = "auto" | "above" | "right" | "left" | "below" | "hidden";

/** Per-node data carried on every React Flow component node. */
export interface ComponentData {
  kind: ComponentKind;
  /** Reference designator, e.g. "R1". This is the join key to the netlist. */
  refdes: string;
  /** SPICE / attribute values keyed by attribute key. */
  params: Record<string, string>;
  /** Visual orientation (degrees CW). Omitted / 0 = catalog default. */
  rotation?: ComponentRotation;
  /** Label placement; auto uses pin-aware LTspice-style layout. */
  labelPos?: LabelPosition;
  [key: string]: unknown; // React Flow requires an index signature on node data
}
