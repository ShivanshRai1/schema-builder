import {
  evalSpiceNumericExpr,
  formatSpiceNumber,
  normalizeSpiceNumericInput,
  parseSpiceNumberToken,
} from "../src/model/spiceValue";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(parseSpiceNumberToken("1k") === 1000, "1k");
assert(parseSpiceNumberToken("2.2k") === 2200, "2.2k");
assert(parseSpiceNumberToken("10n") === 1e-8, "10n");
assert(parseSpiceNumberToken("1Meg") === 1e6, "1Meg");
assert(parseSpiceNumberToken("10e-9") === 1e-8, "10e-9");
assert(parseSpiceNumberToken("0.1e-3") === 1e-4, "0.1e-3");

assert(evalSpiceNumericExpr("1/1000") === 0.001, "1/1000");
assert(evalSpiceNumericExpr("1/10000") === 0.0001, "1/10000");
assert(evalSpiceNumericExpr("2*1k") === 2000, "2*1k");
assert(evalSpiceNumericExpr("{1/1000}") == null, "braces handled outside");

assert(normalizeSpiceNumericInput("1k") === "1k", "norm 1k");
assert(normalizeSpiceNumericInput("1/1000") === "0.001", "norm 1/1000 → 0.001");
assert(normalizeSpiceNumericInput("1/10000") === "100u", "norm 1/10000 → 100u");
assert(normalizeSpiceNumericInput("10e-9") === "10n", "norm 10e-9 → 10n");
assert(normalizeSpiceNumericInput("{1/1000}") === "0.001", "norm {1/1000}");

// Leave non-numeric alone
assert(
  normalizeSpiceNumericInput("PULSE(0 5 0 1n 1n 5u 10u)") ===
    "PULSE(0 5 0 1n 1n 5u 10u)",
  "leave PULSE",
);
assert(normalizeSpiceNumericInput("NMOS_GEN") === "NMOS_GEN", "leave model");
assert(normalizeSpiceNumericInput("V") === "V", "leave V placeholder");
assert(normalizeSpiceNumericInput("R") === "R", "leave R placeholder");

assert(formatSpiceNumber(1000) === "1k", "fmt 1000");
assert(formatSpiceNumber(0.001) === "0.001", "fmt 0.001");
assert(formatSpiceNumber(1e-9) === "1n", "fmt 1e-9");

console.log("test-spice-value: ok");
