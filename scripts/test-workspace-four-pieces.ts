/**
 * Phase B: workspace save unit keeps lastSim per tab (results) with models.
 */
import {
  buildWorkspaceFile,
  parseWorkspaceFile,
  tabFromSnapshot,
  type WorkspaceTabLastSim,
} from "../src/persistence/workspaceFile";
import { emptySchematic } from "../src/model/schematicTabs";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const lastSim: WorkspaceTabLastSim = {
  ok: true,
  source: "demo",
  message: "ok",
  engine: "D2SPICE",
  series: [{ name: "V(out)", x: [0, 1], y: [0, 12] }],
  conditionsSummary: "pulse=ISO16750_A",
};

const snap = emptySchematic({
  library: ".model DZEN D (BV=33)\n",
  directives: [".tran 1u 1m"],
});

const ws = buildWorkspaceFile({
  name: "Four pieces",
  activeTabId: "t1",
  tabs: [
    tabFromSnapshot("t1", "Cond A", snap, { lastSim }),
    tabFromSnapshot("t2", "Cond B", snap, {
      lastSim: {
        ...lastSim,
        series: [{ name: "V(mid)", x: [0], y: [5] }],
      },
    }),
  ],
});

const round = parseWorkspaceFile(JSON.parse(JSON.stringify(ws)));
assert(round.tabs[0]!.library?.includes("DZEN"), "models in workspace");
assert(round.tabs[0]!.lastSim?.series[0]?.name === "V(out)", "results tab1");
assert(round.tabs[1]!.lastSim?.series[0]?.name === "V(mid)", "results tab2");
assert(round.tabs[0]!.nodes && round.tabs[0]!.directives, "schematic + directives");

// Ordinary re-save must not wipe other tabs' results when only active is updated
const resaved = buildWorkspaceFile({
  name: round.name,
  activeTabId: "t1",
  tabs: round.tabs.map((t) =>
    tabFromSnapshot(t.id, t.title, {
      nodes: t.nodes,
      edges: t.edges,
      directives: t.directives,
      library: t.library ?? "",
      sectionOrder: t.sectionOrder,
    }, {
      hiddenCrossingKeys: t.hiddenCrossingKeys,
      nextId: t.nextId,
      lastSim: t.lastSim,
    }),
  ),
});
assert(resaved.tabs[1]!.lastSim?.series[0]?.name === "V(mid)", "resave keeps tab2 results");

console.log("PASS workspace four-piece save unit");
