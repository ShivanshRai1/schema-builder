// Verify graph -> netlist across the expanded catalog: SiC subckt calls, a
// gate driver, a current probe (ammeter), a voltage probe, and a NODE net label
// that names its net "SW". Runs the REAL modules headless.
import { toNetlist } from "./src/netlist/toNetlist.ts";
import { defaultParams } from "./src/model/componentSpecs.ts";

const mk = (id, kind, refdes, params = {}) => ({
  id, type: "component", position: { x: 0, y: 0 },
  data: { kind, refdes, params: { ...defaultParams(kind), ...params } },
});
const w = (s, sh, t, th) => ({ id: `${s}${sh}-${t}${th}`, source: s, sourceHandle: sh, target: t, targetHandle: th });

const nodes = [
  mk("v1", "V", "V1", { value: "DC 400" }),
  mk("m1", "SICMOS", "XM1", { model: "C3M0075120K" }),
  mk("m2", "SICMOS", "XM2", { model: "C3M0075120K" }),
  mk("drv", "GATEDRV", "XDRV1", { model: "UCC27714" }),
  mk("ip", "IPROBE", "Vpr1"),
  mk("vp", "VPROBE", ""),
  mk("lbl", "NODE", "", { name: "SW" }),
  mk("g", "GND", ""),
];

const edges = [
  w("v1", "p", "m1", "d"),   // VBUS
  w("v1", "n", "g", "g"),    // ground
  w("m1", "s", "m2", "d"),   // switch node
  w("m2", "d", "ip", "a"),   // -> current probe
  w("m2", "d", "vp", "p"),   // -> voltage probe
  w("m2", "d", "lbl", "g"),  // -> net label "SW"
  w("m2", "s", "g", "g"),    // ground leg
  w("drv", "out", "m1", "g"),
  w("drv", "gnd", "g", "g"),
];

console.log(toNetlist(nodes, edges, { title: "half-bridge smoke test" }));

// --- Step-2 v1: param patch by refdes (must not move/add/delete/rewire) -----
import { patchParamsByRefdes } from "./src/netlist/patchParamsByRefdes.ts";

const seed = [
  mk("n1", "V", "V1", { value: "DC 12" }),
  mk("n2", "R", "R1", { value: "10k" }),
  mk("n3", "C", "C1", { value: "1n" }),
];
const seedPos = seed.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));

const edited = `
* demo
V1 1 0 DC 24
R1 1 2 4.7k
C1 2 0 100n ic=0.5
.end
`;

const { nodes: patched, updated } = patchParamsByRefdes(seed, edited);
const byId = Object.fromEntries(patched.map((n) => [n.id, n]));

const assert = (cond, msg) => {
  if (!cond) throw new Error(`Step-2 patch assert failed: ${msg}`);
};

assert(updated.sort().join(",") === "C1,R1,V1", `updated=${updated}`);
assert(byId.n1.data.params.value === "DC 24", "V1 value");
assert(byId.n2.data.params.value === "4.7k", "R1 value");
assert(byId.n3.data.params.value === "100n", "C1 value");
assert(byId.n3.data.params.ic === "0.5", "C1 ic");
assert(patched.length === seed.length, "node count unchanged");
for (const p of seedPos) {
  const n = byId[p.id];
  assert(n.position.x === p.x && n.position.y === p.y, `position preserved for ${p.id}`);
}
console.log("\nStep-2 param patch smoke test — OK");

// --- Step-2 C/D: add / delete / rewire ------------------------------------
import { applyNetlistToGraph } from "./src/netlist/applyNetlistToGraph.ts";
import { extractNets } from "./src/netlist/nets.ts";

const gnd = mk("ng", "GND", "");
const baseNodes = [
  mk("n1", "V", "V1", { value: "DC 12" }),
  mk("n2", "R", "R1", { value: "10k" }),
  mk("n3", "C", "C1", { value: "1n" }),
  gnd,
];
baseNodes[0].position = { x: 40, y: 180 };
baseNodes[1].position = { x: 280, y: 90 };
baseNodes[2].position = { x: 540, y: 180 };
baseNodes[3].position = { x: 280, y: 360 };

const baseEdges = [
  w("n1", "p", "n2", "a"),
  w("n2", "b", "n3", "a"),
  w("n3", "b", "ng", "g"),
  w("n1", "n", "ng", "g"),
];

// Round-trip: apply own export — positions stay, circuit still connected to gnd
{
  const text = toNetlist(baseNodes, baseEdges, { title: "rt" });
  const r = applyNetlistToGraph(baseNodes, baseEdges, text);
  assert(r.deleted.length === 0, "round-trip deleted");
  assert(r.added.length === 0, "round-trip added");
  assert(r.nodes.find((n) => n.data.refdes === "R1").position.x === 280, "R1 x preserved");
  const { netOf } = extractNets(r.nodes, r.edges);
  const r1 = r.nodes.find((n) => n.data.refdes === "R1");
  const c1 = r.nodes.find((n) => n.data.refdes === "C1");
  assert(netOf(r1.id, "b") === netOf(c1.id, "a"), "R1-C1 still netted");
  assert(netOf(r.nodes.find((n) => n.data.kind === "GND").id, "g") === "0", "gnd is 0");
}

// Delete R1 from text → removed; add L1 → unplaced
{
  const text = `
V1 1 0 DC 12
L1 1 2 3.3u
C1 2 0 1n
.end
`;
  const r = applyNetlistToGraph(baseNodes, baseEdges, text);
  assert(r.deleted.includes("R1"), "deleted R1");
  assert(r.added.includes("L1"), "added L1");
  assert(!r.nodes.some((n) => n.data.refdes === "R1"), "R1 gone");
  const l1 = r.nodes.find((n) => n.data.refdes === "L1");
  assert(l1 && l1.data.unplaced === true, "L1 unplaced");
  assert(l1.data.params.value === "3.3u", "L1 value");
  assert(r.nodes.some((n) => n.data.kind === "GND"), "GND kept");
  const { netOf } = extractNets(r.nodes, r.edges);
  assert(netOf(l1.id, "a") === netOf(r.nodes.find((n) => n.data.refdes === "V1").id, "p"), "L1 wired to V1");
}

console.log("Step-2 add/delete/rewire smoke test — OK");
