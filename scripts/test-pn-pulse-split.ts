/**
 * PN vs Pulse split: presets stay part-number rows; pulse ids stay separate.
 */
import { LOAD_DUMP_PULSES } from "../src/sim/loadDumpConditions";
import { LOAD_DUMP_PRESETS, findLoadDumpPreset } from "../src/sim/loadDumpPresets";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(LOAD_DUMP_PULSES.length >= 2, "pulse profiles exist");
assert(
  LOAD_DUMP_PRESETS.every((p) => p.pn && (p.diodeSlot === "D1" || p.diodeSlot === "D2")),
  "each preset is a PN with diode slot",
);
assert(
  LOAD_DUMP_PRESETS.filter((p) => p.diodeSlot === "D2").every((p) => /^SM/i.test(p.pn)),
  "SM → D2",
);
assert(
  LOAD_DUMP_PRESETS.filter((p) => p.diodeSlot === "D1").every((p) => /^XFD/i.test(p.pn)),
  "XFD → D1",
);

const row = findLoadDumpPreset("XFD11K48CA_24");
assert(row?.pn === "XFD11K48CA", "lookup PN");
assert(row?.diodeSlot === "D1", "XFD slot");
assert(row?.pulse === "ISO16750_A", "recommended pulse");
assert(row?.conditions.uaSupply === "24", "fills UA");
assert(row?.conditions.ri === "8", "fills Ri");

// Labels must not present PN rows as the pulse selector
assert(
  !LOAD_DUMP_PRESETS.some((p) => /ISO\s*16750|7637/i.test(p.label)),
  "PN labels are not pulse names",
);

console.log("PASS part-number vs pulse split");
