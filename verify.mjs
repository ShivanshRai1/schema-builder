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
