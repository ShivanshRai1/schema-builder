import { interpret } from "../src/llm/ops.ts";
import { validateOps } from "../src/llm/validateOps.ts";

function check(msg: string, wantKey: string, wantVal: string) {
  const r = interpret(msg);
  const op = r.ops[0];
  const ok =
    op &&
    op.type === "setParam" &&
    op.key === wantKey &&
    op.value === wantVal;
  if (!ok) {
    console.error("FAIL", msg, r);
    process.exitCode = 1;
  } else {
    console.log("OK", msg, "→", op);
  }
}

check("set R1 value 4.7k", "value", "4.7k");
check("set R1 to 10k", "value", "10k");
check("set D1 model SM8S36A", "model", "SM8S36A");
check("set D2 model to XFD11K54CA", "model", "XFD11K54CA");
check("set D1 to model FooBar", "model", "FooBar");
check("use model Baz for D1", "model", "Baz");
check("change model of D2 to MyLib", "model", "MyLib");

const v = validateOps([{ type: "setParam", refdes: "d1", key: "part", value: "ABC" }]);
if (v[0]?.type !== "setParam" || v[0].key !== "model" || v[0].value !== "ABC") {
  console.error("FAIL alias", v);
  process.exitCode = 1;
} else console.log("OK alias part→model", v[0]);

const v2 = validateOps([{ type: "setParam", refdes: "R1", key: "value", value: "" }]);
if (v2.length !== 0) {
  console.error("FAIL empty value", v2);
  process.exitCode = 1;
} else console.log("OK empty value dropped");

if (!process.exitCode) console.log("PASS B1 smoke");
