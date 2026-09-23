import type { Node } from "@xyflow/react";
import type { ComponentData } from "../src/model/types";
import {
  inferKindFromDevice,
  inferKindFromRefdes,
  spiceInstanceBaseRefdes,
} from "../src/netlist/parseDeviceParams";
import { applyNetlistToGraph } from "../src/netlist/applyNetlistToGraph";

const checks: string[] = [];
const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
  checks.push(msg);
};

assert(spiceInstanceBaseRefdes("XD1") === "D1", "XD1 → D1");
assert(inferKindFromDevice("XD1", ["2", "3", "XFD11K48CA"]) === "DTVSBI", "XD1 kind");
assert(inferKindFromRefdes("c1") === "C", "c1 kind");

const nodes: Node<ComponentData>[] = [
  {
    id: "n1",
    type: "component",
    position: { x: 0, y: 0 },
    data: { kind: "DTVSBI", refdes: "D1", params: { model: "XFD11K48CA" } },
  },
  {
    id: "n2",
    type: "component",
    position: { x: 40, y: 0 },
    data: { kind: "DZ", refdes: "D2", params: { model: "DZEN" } },
  },
  {
    id: "n3",
    type: "component",
    position: { x: 80, y: 0 },
    data: { kind: "R", refdes: "R1", params: { value: "8" } },
  },
  {
    id: "n4",
    type: "component",
    position: { x: 120, y: 0 },
    data: { kind: "VAC", refdes: "V1", params: { stimulus: "PWL(0 24)" } },
  },
];

const text = `XD1 2 3 XFD11K48CA
D2 0 3 DZEN
R1 1 2 8
V1 1 0 PWL(0 24)
c1 7 8 1u
.options reltol=1e-3
.tran 250u 1
.end
`;

const r = applyNetlistToGraph(nodes, [], text);
assert(!r.deleted.includes("D1"), `D1 not deleted (got ${r.deleted.join(",")})`);
assert(!r.skippedUnknown.includes("XD1"), `XD1 not skipped (got ${r.skippedUnknown.join(",")})`);
assert(!r.skippedUnknown.includes("c1"), `c1 not skipped`);
assert(
  r.nodes.some((n) => n.data.refdes === "D1"),
  "D1 still on schematic",
);
assert(
  r.nodes.some((n) => /^c1$/i.test(n.data.refdes) || n.data.refdes === "C1"),
  "C1 added",
);

console.log("PASS xd1-apply:", checks.length, "checks");

const r2 = applyNetlistToGraph(nodes, [], `XD1 2 3 XFD11K48CA
c1 7 8
.tran 1u 1m
.end
`);
assert(!r2.deleted.includes("D1"), "incomplete c1: D1 kept");
assert(!r2.skippedUnknown.includes("c1"), "incomplete c1: recognized");
assert(
  r2.nodes.some((n) => /^c1$/i.test(n.data.refdes)),
  "incomplete c1: added with default value",
);
console.log("PASS incomplete c1 line");
