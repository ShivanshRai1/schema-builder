import {
  coerceSetParam,
  validateOps,
  looksLikeModelName,
} from "../src/llm/validateOps.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// Heuristic: value key + model-like name → model (fixes D1 bug)
{
  const c = coerceSetParam("value", "SM8S36A", "DTVSBI");
  assert(c && c.key === "model" && c.value === "SM8S36A", "DTVSBI value→model");
}
{
  const c = coerceSetParam("value", "4.7k", "R");
  assert(c && c.key === "value" && c.value === "4.7k", "R keeps value");
}
{
  const c = coerceSetParam("value", "SM8S36A", null);
  assert(c && c.key === "model", "heuristic without kind");
}
{
  const c = coerceSetParam("model", "XFD11K54CA", "DTVSBI");
  assert(c && c.key === "model", "explicit model ok");
}
{
  const c = coerceSetParam("value", "2", "R");
  assert(c && c.key === "value", "numeric value stays value");
}
{
  // R has no model attr — drop model-only junk
  const c = coerceSetParam("model", "FooBar", "R");
  assert(c === null, "R rejects model key");
}
assert(looksLikeModelName("SM8S36A") && !looksLikeModelName("4.7k"), "looksLike helpers");

{
  const ops = validateOps(
    [{ type: "setParam", refdes: "D1", key: "value", value: "SM8S36A" }],
    { kindByRefdes: { D1: "DTVSBI" } },
  );
  assert(
    ops.length === 1 &&
      ops[0]!.type === "setParam" &&
      ops[0].key === "model" &&
      ops[0].value === "SM8S36A",
    "validateOps rewrites D1",
  );
}

{
  const ops = validateOps(
    [{ type: "setParam", refdes: "R1", key: "value", value: "10k" }],
    { kindByRefdes: { R1: "R" } },
  );
  assert(ops[0]?.type === "setParam" && ops[0].key === "value", "R1 value ok");
}

console.log("PASS B3 coerce/validate");
