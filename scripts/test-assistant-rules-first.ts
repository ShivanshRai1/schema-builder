/**
 * Phase C: rules-first assistant — known phrases must not hit a canned API loop.
 */
import { runAssistant } from "../src/llm/runAssistant";
import type { AssistantContext } from "../src/llm/assistantTypes";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const ctx: AssistantContext = {
  components: [
    { refdes: "R1", kind: "R", params: { value: "10k" }, pins: ["a", "b"] },
    { refdes: "C1", kind: "C", params: { value: "1n" }, pins: ["a", "b"] },
  ],
  wires: [],
  netlist: "R1 1 2 10k\nC1 2 0 1n\n.end",
};

{
  const r = await runAssistant("set R1 value 4.7k", ctx);
  assert(r.ops.length === 1, "set should produce an op");
  assert(r.ops[0]!.type === "setParam", "setParam");
  assert(r.source === "rules", "rules first");
  assert(!/try:/i.test(r.reply) || /4\.7k/i.test(r.reply), "not canned help");
}

{
  const r = await runAssistant("add 10k resistor", ctx);
  assert(r.ops.some((o) => o.type === "addComponent"), "add op");
  assert(r.source === "rules", "add via rules");
}

{
  const r = await runAssistant("blorp the flux capacitor", ctx);
  assert(r.ops.length === 0, "unknown → no ops");
  assert(/didn.t catch/i.test(r.reply), `short unknown reply, got: ${r.reply}`);
}

console.log("PASS assistant rules-first");
