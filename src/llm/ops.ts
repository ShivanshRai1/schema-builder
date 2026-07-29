import type { ComponentKind } from "../model/types";

// ---------------------------------------------------------------------------
// Structured circuit edit operations.
//
// This is the contract between the assistant panel and the graph. The LLM's
// job (step 3) is to RETURN these ops, not raw netlist text — they are
// validated, then applied to the graph as the single source of truth. That
// keeps schematic + netlist consistent and gives an undoable, auditable stream.
//
// STEP-3 SEAM: replace `interpret()` below (a deterministic rule-based
// stand-in) with a real model call whose tool schema mirrors this Op union.
// Everything downstream — App.applyOps — stays exactly the same.
// ---------------------------------------------------------------------------

export type Op =
  | { type: "addComponent"; kind: ComponentKind }
  | { type: "setParam"; refdes: string; key: string; value: string }
  | { type: "deleteComponent"; refdes: string };

export interface InterpretResult {
  ops: Op[];
  /** Assistant-facing reply text. */
  reply: string;
}

const KIND_WORDS: Record<string, ComponentKind> = {
  resistor: "R", r: "R",
  inductor: "L", l: "L",
  capacitor: "C", cap: "C", c: "C",
  vsource: "V", voltage: "V", v: "V",
  isource: "I", current: "I",
  diode: "D", d: "D",
  mosfet: "NMOS", nmos: "NMOS", pmos: "PMOS",
  sic: "SICMOS", gan: "GANHEMT", igbt: "IGBT",
  bjt: "NPN", npn: "NPN", pnp: "PNP",
  thyristor: "SCR", scr: "SCR",
  driver: "GATEDRV", gatedriver: "GATEDRV",
  comparator: "COMP", comp: "COMP",
  opamp: "EAMP", eamp: "EAMP", erroramp: "EAMP",
  shunt: "CSENSE",
  vprobe: "VPROBE", iprobe: "IPROBE",
  ground: "GND", gnd: "GND",
  node: "NODE", label: "NODE",
};

/**
 * Rule-based stand-in for the LLM. Understands a few commands so the full loop
 * (chat -> ops -> graph -> netlist) is live without a network call:
 *   "add resistor"          -> addComponent R
 *   "add capacitor"         -> addComponent C
 *   "set R1 value 4.7k"     -> setParam R1 value 4.7k
 *   "set M1 model NMOS_GEN" -> setParam M1 model NMOS_GEN
 *   "delete R2"             -> deleteComponent R2
 */
export function interpret(input: string): InterpretResult {
  const text = input.trim().toLowerCase();

  const add = text.match(/^add\s+(?:a\s+|an\s+)?([a-z]+)/);
  if (add) {
    const kind = KIND_WORDS[add[1]];
    if (kind) return { ops: [{ type: "addComponent", kind }], reply: `Added a ${add[1]}.` };
    return { ops: [], reply: `I don't recognize component "${add[1]}".` };
  }

  const set = input.trim().match(/^set\s+([A-Za-z]+\d+)\s+(\w+)\s+(.+)$/i);
  if (set) {
    const [, refdes, key, value] = set;
    return {
      ops: [{ type: "setParam", refdes: refdes.toUpperCase(), key: key.toLowerCase(), value: value.trim() }],
      reply: `Set ${refdes.toUpperCase()} ${key.toLowerCase()} = ${value.trim()}.`,
    };
  }

  const del = text.match(/^(?:delete|remove)\s+([a-z]+\d+)/);
  if (del) {
    return { ops: [{ type: "deleteComponent", refdes: del[1].toUpperCase() }], reply: `Removed ${del[1].toUpperCase()}.` };
  }

  return {
    ops: [],
    reply:
      'Rule-based stand-in for the LLM. Try: "add resistor", "set R1 value 4.7k", "delete C1". ' +
      "Step 3 swaps this for a model that returns the same structured ops.",
  };
}
