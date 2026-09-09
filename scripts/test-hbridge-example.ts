/**
 * Smoke-test: simplified H-bridge example parses and emits runnable SPICE.
 * Does not touch Apply / ExpressPCB refusal / starter circuit.
 */
import hbridge from "../examples/hbridge-simplified.json";
import { parseCircuitFile } from "../src/persistence/circuitFile";
import { toNetlist } from "../src/netlist/toNetlist";
import { classifyNetlistText } from "../src/netlist/netlistFormat";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const snap = parseCircuitFile(hbridge);
const nl = toNetlist(snap.nodes, snap.edges, {
  title: "H-bridge simplified",
  directives: snap.directives,
  library: snap.library,
});

assert(classifyNetlistText(nl).kind === "spice", "generated netlist must be spice");
assert(nl.includes("XQ1") && nl.includes("SIC_MOS"), "FETs present");
assert(nl.includes("PULSE("), "gate PULSE present");
assert(!/ExpressPCB/i.test(nl), "not ExpressPCB");
assert(!/V=if/i.test(nl), "no behavioral if()");
assert(/\bVin\b/.test(nl) && /\bLout\b/.test(nl), "passives present");
assert(nl.includes(".save V(A)") || nl.includes(".save V(A) V(B)"), "probes");

console.log("ok: hbridge-simplified example");
