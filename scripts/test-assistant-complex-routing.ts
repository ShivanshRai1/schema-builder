/**
 * Routing: simple edits → rules; questions / multi-step → prefers LLM.
 */
import { prefersLlmAssistant, runAssistant } from "../src/llm/runAssistant";
import type { AssistantContext } from "../src/llm/assistantTypes";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(!prefersLlmAssistant("set R1 value 4.7k"), "simple set → rules");
assert(!prefersLlmAssistant("add 10k resistor"), "simple add → rules");
assert(prefersLlmAssistant("Why is Vout ringing after the load dump?"), "why → LLM");
assert(prefersLlmAssistant("How does the TVS clamp Us?"), "how → LLM");
assert(
  prefersLlmAssistant("add a 10k resistor and then connect it to C1 and set C1 to 100n"),
  "multi-step → LLM",
);
assert(prefersLlmAssistant("Explain what this netlist is doing"), "explain → LLM");

const ctx: AssistantContext = {
  components: [
    { refdes: "R1", kind: "R", params: { value: "10k" }, pins: ["a", "b"] },
    { refdes: "C1", kind: "C", params: { value: "1n" }, pins: ["a", "b"] },
  ],
  wires: [],
  netlist: "R1 1 2 10k\nC1 2 0 1n\n.end",
  directives: [".tran 1u 1m"],
};

{
  const r = await runAssistant("set R1 value 4.7k", ctx);
  assert(r.ops.length === 1 && r.ops[0]!.type === "setParam", "simple edit ops");
  assert(r.source === "rules", "simple via rules");
}

console.log("PASS complex assistant routing");
