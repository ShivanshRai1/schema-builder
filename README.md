# SimulAI — Circuit Schematic Editor

**A graph-authoritative schematic editor that generates a SPICE netlist, with an
embedded Monaco code panel and an AI assistant that edits the circuit through
structured operations.** React + TypeScript + Vite + `@xyflow/react` + Monaco.

This document is the engineer handoff. It explains the architecture, the data
model, every component in the catalog, how the schematic becomes a netlist, how
to extend it, and the roadmap for the two remaining pieces (editable text
round-trip, and the real LLM). Read it top to bottom once, then use it as a map.

---

## 0. Status — what's done, what's next

**Done (this foundation):**
- Graph editor (drag, wire pin-to-pin, multi-select) via `@xyflow/react`.
- Full component catalog: passives, sources, power semiconductors (incl. SiC ±
  Kelvin, GaN HEMT, IGBT ± Kelvin, BJT, thyristor), gate driver, comparator,
  error amp, current/voltage sense, current/voltage probes, ground, net label.
- **Attribute editor** — select a component, edit its attributes (values,
  model names, options). Driven entirely by each component's declared schema.
- **Cut / copy / paste / delete**, keyboard shortcuts, drag (from xyflow).
- **Live netlist generation** — pure `graph → SPICE` function feeding a
  read-only Monaco panel; ground → net 0, named nets, probes → `.save`.
- **Assistant panel** — natural-language edits → structured ops → graph. Uses a
  deterministic rule-based interpreter as a stand-in for the LLM.

**Next (clearly-seamed, see §9):**
1. **Editable text fallback** — make Monaco editable and round-trip netlist
   edits back onto the schematic (parse + diff-patch by refdes, preserve layout).
2. **Real LLM** — swap the rule-based interpreter for a model call whose tool
   schema mirrors the `Op` union. `App.applyOps` does not change.
3. **Fleet hookup** — POST the netlist to `sim_api.php` → D2SPICE (QSPICE),
   plot results with Chart.js to match the existing SimulAI demos.

---

## 1. Quick start

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # tsc type-check + production build to dist/
npx tsx verify.mjs  # headless check of the graph→netlist logic
```

Loads with a seed V1–R1–C1 circuit. Try:
- Drag from any pin (blue dot) to any other pin to wire them.
- Click a palette item to drop a component; select it to edit attributes on the right.
- Select + `Ctrl/⌘ C` / `X` / `V`, `Delete` to remove.
- Assistant: `add sic`, `set R1 value 4.7k`, `delete C1`.

Requirements: Node 18+ (built and tested on Node 22).

---

## 2. The mental model (read this first)

There is **one source of truth: the graph.** Everything else is derived.

```
   palette / assistant
          │ add, setParam, delete, wire, paste
          ▼
   ┌──────────────────────┐        toNetlist(nodes, edges)   ┌────────────────────┐
   │  GRAPH  (xyflow)      │  ── pure, deterministic ───────► │  netlist.cir       │
   │  nodes = components   │                                  │  (Monaco, read-only│
   │  edges = wires        │                                  │   in step 1)       │
   │  data  = ComponentData│  ◄── step 2: parse + diff-patch  └────────────────────┘
   └──────────────────────┘        BY REFDES (preserve layout)
          ▲
          │ Op[]  (addComponent / setParam / deleteComponent)
   ┌──────────────────────┐
   │  assistant panel      │  interpret()  ← step 3: real LLM returns the same Op[]
   └──────────────────────┘
```

Three rules that keep the whole thing coherent:

1. **The netlist is a projection, never a second source of truth.** In step 1
   it is read-only. In step 2 it becomes editable, but edits are *reconciled
   into the graph*, not kept as a parallel truth.
2. **`refdes` (e.g. `R1`, `XM3`) is the join key.** The same string identifies a
   part in the schematic, in the netlist, and (later) in the layout sidecar.
   This is what lets a text edit find "the same part" and patch it in place.
3. **The assistant edits via structured ops, not raw text.** Ops are validated,
   then applied to the graph — so the schematic and netlist can never drift.

Why graph-authoritative (not text-authoritative): users draw circuits; layout
lives naturally in the graph; the netlist carries **no geometry**, so rebuilding
the schematic from text would scramble placement. See §9 for the full argument.

---

## 3. Project structure

```
simulai-schematic/
├─ index.html                  Vite entry
├─ vite.config.ts              base:"./" → relative assets, host-agnostic
├─ src/
│  ├─ main.tsx                 React root
│  ├─ App.tsx                  orchestration: state, ops, clipboard, layout
│  ├─ styles.css               all styling (single file)
│  ├─ model/
│  │  ├─ types.ts              ComponentKind, ComponentData, PinSpec, AttributeSpec
│  │  └─ componentSpecs.ts     ★ THE CATALOG — one entry per component family
│  ├─ netlist/
│  │  ├─ nets.ts               union-find net extraction (ground=0, named nets)
│  │  └─ toNetlist.ts          ★ graph → SPICE (pure function)
│  ├─ nodes/
│  │  └─ ComponentNode.tsx     generic node renderer (reads the spec)
│  ├─ components/
│  │  ├─ Canvas.tsx            xyflow wrapper (loose connection mode)
│  │  ├─ Palette.tsx           grouped-by-category component palette
│  │  ├─ PropertiesPanel.tsx   ★ the attribute editor
│  │  ├─ NetlistPanel.tsx      Monaco (read-only in step 1) + "edit as text" seam
│  │  └─ ChatPanel.tsx         assistant UI
│  └─ llm/
│     └─ ops.ts                ★ Op union + interpret() (LLM stand-in, step-3 seam)
└─ verify.mjs                  headless netlist smoke test
```

The three files that matter most are marked ★. If you understand
`componentSpecs.ts`, `toNetlist.ts`, and `ops.ts`, you understand the app.

---

## 4. Data model

```ts
// model/types.ts
type ComponentKind = "R" | "L" | "C" | "V" | "I" | "D" | "NMOS" | "PMOS"
  | "SICMOS" | "SICMOS_K" | "GANHEMT" | "IGBT" | "IGBT_K" | "NPN" | "PNP"
  | "SCR" | "GATEDRV" | "COMP" | "EAMP" | "CSENSE" | "VSENSE" | "IPROBE"
  | "VPROBE" | "GND" | "NODE";

interface ComponentData {          // carried on every xyflow node
  kind: ComponentKind;
  refdes: string;                  // "R1", "XM3", ...  — the join key
  params: Record<string, string>;  // attribute values, e.g. { value: "4.7k" }
}
```

- A **component** is an xyflow `Node` with `type: "component"` and `data:
  ComponentData`.
- A **pin** is an xyflow `Handle`; its `id` is the pin id from the spec.
- A **wire** is an xyflow `Edge` connecting `(sourceNode, sourceHandle)` to
  `(targetNode, targetHandle)`.
- A **net** is a maximal set of pins joined by wires (computed in `nets.ts`).

Node `id` is stable identity (`n1`, `n2`, …) and is independent of `refdes`, so
renaming a refdes never breaks wiring or selection.

---

## 5. The component catalog

Every component is one entry in `model/componentSpecs.ts`. Each declares its
category, refdes prefix (which is also the **SPICE instance-name prefix**), pins,
attributes, and how it emits into the netlist.

| Component | kind | Pins | Key attributes | Netlist emission |
| --- | --- | --- | --- | --- |
| Resistor | `R` | a, b | value (Ω) | `R# a b value` |
| Inductor | `L` | a, b | value (H), ic | `L# a b value [ic=…]` |
| Capacitor | `C` | a, b | value (F), ic | `C# a b value [ic=…]` |
| Voltage source | `V` | +, − | value/stimulus | `V# + − value` |
| Current source | `I` | +, − | value/stimulus | `I# + − value` |
| Diode | `D` | A, K | model | `D# A K model` |
| MOSFET N | `NMOS` | D, G, S | model, bulk | `M# D G S S model` |
| MOSFET P | `PMOS` | D, G, S | model | `M# D G S S model` |
| **SiC MOSFET** | `SICMOS` | D, G, S | .subckt | `XM# D G S model` |
| **SiC MOSFET (Kelvin)** | `SICMOS_K` | D, G, S, **SK** | .subckt | `XMK# D G S SK model` |
| **GaN HEMT** | `GANHEMT` | D, G, S | .subckt | `XG# D G S model` |
| **IGBT** | `IGBT` | C, G, E | .subckt | `XQ# C G E model` |
| **IGBT (Kelvin)** | `IGBT_K` | C, G, E, **EK** | .subckt | `XQK# C G E EK model` |
| BJT NPN | `NPN` | C, B, E | model | `Q# C B E model` |
| BJT PNP | `PNP` | C, B, E | model | `Q# C B E model` |
| Thyristor / SCR | `SCR` | A, K, G | .subckt | `XT# A K G model` |
| Gate driver | `GATEDRV` | IN, OUT, VDD, GND | .subckt | `XDRV# IN OUT VDD GND model` |
| Comparator | `COMP` | +, −, OUT | .subckt | `XCMP# + − OUT model` |
| Error amp / op-amp | `EAMP` | +, −, OUT | .subckt | `XEA# + − OUT model` |
| Current sense (shunt) | `CSENSE` | a, b | shunt (Ω) | `Rs# a b value` + `.save I(Rs#)` |
| Voltage sense | `VSENSE` | +, − | signal name | *(no device)* + `.save V(+,−)` |
| Current probe (ammeter) | `IPROBE` | a, b | — | `Vpr# a b 0` + `.save I(Vpr#)` |
| Voltage probe | `VPROBE` | • | — | *(no device)* + `.save V(net)` |
| Ground | `GND` | g | — | *forces its net → `0`* |
| Net label | `NODE` | g | name | *forces its net's NAME* |

**Kelvin sense** (`SICMOS_K`, `IGBT_K`): the 4th pin (SK / EK) is the Kelvin
source/emitter — the gate-driver return that bypasses power-loop di/dt. It's a
distinct node in the subckt call, so a Kelvin part and a 3-terminal part produce
different netlists, exactly as intended.

**Why `X…` for the power/control parts:** SiC/GaN/IGBT/SCR and the control
blocks are behavioural or vendor **subcircuits**, not SPICE primitives. They emit
`X<refdes> <nodes> <MODEL>`, where `MODEL` is the `.subckt` name from the `model`
attribute (default e.g. `SIC_MOS`). You supply the actual `.subckt` bodies from
the vendor (EPC QSPICE, Infineon OptiMOS, Vishay) — see §11. The primitive
devices (R L C V I D M Q) emit native SPICE and need only a `.model` card.

> The exact emission strings for the complex parts are **sensible defaults, not
> gospel** — pin order and node count must match whatever vendor `.subckt` you
> drop in. Adjust `toSpice` per part when you wire real models. This is expected
> and is the main place you'll iterate.

---

## 6. How schematic → netlist works

`netlist/toNetlist.ts` is a pure function `(nodes, edges) → string`. Steps:

1. **Extract nets** (`nets.ts`) with union-find over pin endpoints
   `${nodeId}:${pinId}`:
   - every pin of every component is registered;
   - each wire unions its two endpoints;
   - all **ground** pins collapse into one net named `0`;
   - each **net label** (`NODE`) forces its group's name to the label's `name`;
   - remaining groups get sequential integer names `1, 2, 3, …`.
2. **Emit one device line per emitting component**, sorted by refdes, by calling
   its spec's `toSpice(refdes, netOf, params)`.
3. **Collect probes/senses** via each spec's optional `toProbes(...)` into a
   single `.save …` line so the simulator knows what to record.
4. **Append the directive block** (`.model`, `.tran`, `.options`, `.end`) — a
   **pass-through region**. In step 2 this becomes the user-editable text area
   that round-trips untouched (it has no graph representation).

Because it's pure and deterministic, it re-runs on every graph change (via
`useMemo` in `App.tsx`) and is trivial to unit-test (`verify.mjs`).

---

## 7. Adding a new component (worked example)

Say you want a **transformer**. Add one entry to `COMPONENT_SPECS` and one line
to `PALETTE`. Nothing else changes — renderer, palette, attribute editor, and
exporter all read the registry.

```ts
XFMR: {
  kind: "XFMR", category: "Passive", refdesPrefix: "K", label: "Transformer",
  glyph: "⧖", emits: true,
  pins: [
    pin("p1", "P+", "left", 0.3), pin("p2", "P-", "left", 0.7),
    pin("s1", "S+", "right", 0.3), pin("s2", "S-", "right", 0.7),
  ],
  attributes: [
    A("lp", "Primary L", "text", "1m", { unit: "H" }),
    A("ls", "Secondary L", "text", "1m", { unit: "H" }),
    A("k",  "Coupling",    "text", "0.99"),
  ],
  // Two coupled inductors + a K statement is the usual SPICE idiom; emit
  // whatever your simulator expects here.
  toSpice: (r, n, p) =>
    `Lp_${r} ${n("p1")} ${n("p2")} ${p.lp}\nLs_${r} ${n("s1")} ${n("s2")} ${p.ls}\n${r} Lp_${r} Ls_${r} ${p.k}`,
},
```

Then add `"XFMR"` to `ComponentKind` in `types.ts` and to a `PALETTE` group.
That's the entire extension surface.

**Attribute types** the editor renders: `"text"`, `"number"`, `"select"` (with
`options`). Add `unit` and `hint` for UX. The properties panel is generated from
this schema — you never write per-component form code.

---

## 8. Edit operations

- **Wire:** drag from any pin to any pin. `ConnectionMode.Loose` (in
  `Canvas.tsx`) lets any handle connect to any handle — a schematic has no
  source/target direction. Multiple wires may land on one pin (a junction);
  union-find merges them into one net.
- **Select:** click; shift-click / drag-box for multi-select (xyflow built-in).
- **Move:** drag (xyflow built-in). Position lives on the node — this is the
  layout the netlist can't carry and that step 2 must preserve.
- **Delete:** `Delete` / `Backspace`, or the properties-panel button.
- **Copy / Cut / Paste:** `Ctrl/⌘ C / X / V`. Paste clones the selected nodes
  and the wires *between* them, assigns fresh node ids and fresh refdes (via the
  per-prefix allocator), and offsets position. Shortcuts are suppressed while a
  text field or the editor has focus (`App.tsx` keydown guard).

Refdes allocation (`makeAllocator` in `App.tsx`) numbers **per SPICE prefix**, so
NMOS+PMOS share the `M#` sequence and NPN+PNP share `Q#` — no collisions.

---

## 9. Roadmap & the seams

### Step 2 — editable text fallback (the round-trip)

Goal: the user edits the netlist in Monaco (or the LLM writes netlist text) and
the schematic updates **without losing layout**.

- **Seam:** `NetlistPanel`'s "edit as text" button → `App.onRequestEdit`.
- **Plan:** flip Monaco to `readOnly: false`; on change, *parse* the netlist,
  *diff* against the current graph, and *patch by refdes*:
  - value/param change → update that node's params, keep position;
  - new device → add node, place near its nets, flag **"unplaced"** for a drag;
  - removed device → delete node + dangling wires;
  - rewire → update just the affected edges.
- **Layout sidecar:** store `x/y` + wire routing in a JSON keyed by refdes (or as
  `* @pos R1 120 40` comments in the netlist). The netlist stays the truth for
  connectivity/values; the sidecar is the truth for geometry. Reconcile by
  refdes. This is why netlist→graph never has to auto-layout an existing drawing.
- **Cold paste** (raw netlist, no prior layout) is the only case that needs
  auto-layout — defer it; consider `elkjs` or `dagre` (see §11).

Keep it **graph-authoritative**: text edits are reconciled *into* the graph, not
promoted to a competing source of truth. Optionally gate editing to one side at a
time (canvas read-only while typing in text, and vice-versa) for a clear "who's
driving" without ever discarding layout.

### Step 3 — the real LLM

- **Seam:** `interpret()` in `llm/ops.ts`. Replace the rule-based body with a
  model call whose tool/function schema mirrors the `Op` union:
  `addComponent{kind}`, `setParam{refdes,key,value}`, `deleteComponent{refdes}`
  (extend with `connectPins`, `setNetName`, etc.). Return validated `Op[]`.
- `App.applyOps` is unchanged — it already applies ops to the graph.
- **Context to send the model:** the current component list + the generated
  netlist (both cheap to produce from the graph).
- **Security:** call the model through a **same-origin proxy** (mirror
  `sim_api.php` / `sim_config.php`) so the API key never ships to the browser.
  Prefer returning ops over raw netlist text; if you do let the LLM write netlist
  text, run it through the step-2 parse+diff-patch path so it can't desync.

### Fleet integration

- POST the generated netlist to `sim_api.php`, which whitelists directives and
  maps engine aliases `D1SPICE` (ngspice) / `D2SPICE` (qspice).
- Render results with Chart.js to match `tvs_demo` / `sic_demo` / `esd_demo`.
- Real QSPICE jobs from this editor double as functional load for the fleet
  reliability work (Workstream A).

---

## 10. Known limitations / TODO

- **Complex-part emissions are placeholders.** Pin order/count in the `X…` lines
  must match the real vendor `.subckt`. Verify per model (§11).
- **No `.subckt` library management yet.** `model` is just a name; add a way to
  attach/import the actual subckt bodies and prepend them to the netlist.
- **Monaco loads from a CDN by default.** To match SimulAI's "no CDN,
  self-contained" hosting, self-host it via `loader.config({ paths: { vs: … } })`
  pointing at a local `monaco-editor` copy before shipping.
- **SPICE syntax highlighting** uses `ini` as a stand-in. Add a Monaco Monarch
  grammar for real SPICE tokens (`.tran`, device letters, models).
- **No undo/redo** yet — add via an xyflow history stack (ops make this clean).
- **No persistence** — add save/load of `{nodes, edges}` (+ layout sidecar).
- NMOS bulk is tied to source; add the explicit-bulk 4th pin when needed.

---

## 11. References

**Framework & build**
- React — https://react.dev/learn
- TypeScript handbook — https://www.typescriptlang.org/docs/
- Vite — https://vite.dev/guide/

**Graph editor (`@xyflow/react`, formerly React Flow)**
- Docs / learn — https://reactflow.dev/learn
- Custom nodes — https://reactflow.dev/learn/customization/custom-nodes
- Handles (pins) — https://reactflow.dev/api-reference/components/handle
- Connection mode (loose wiring) — https://reactflow.dev/api-reference/types/connection-mode
- `useNodesState` / `useEdgesState` — https://reactflow.dev/api-reference/hooks/use-nodes-state
- TypeScript guide — https://reactflow.dev/learn/advanced-use/typescript
- npm — https://www.npmjs.com/package/@xyflow/react

**Embedded code editor (Monaco)**
- `@monaco-editor/react` — https://www.npmjs.com/package/@monaco-editor/react
- Monaco API — https://microsoft.github.io/monaco-editor/
- Custom languages (Monarch, for a SPICE grammar) — https://microsoft.github.io/monaco-editor/monarch.html

**SPICE / netlist**
- ngspice manual — https://ngspice.sourceforge.io/docs.html
- QSPICE — https://www.qorvo.com/design-hub/design-tools/interactive/qspice
- Netlist / device-line syntax primer — https://ngspice.sourceforge.io/ngspice-tutorial.html

**Vendor device models (the `.subckt` bodies)**
- EPC GaN (QSPICE models + cross-ref) — https://epc-co.com/epc/design-support/gan-fet-models
- Infineon OptiMOS / IGBT SPICE — https://www.infineon.com/cms/en/design-support/tools/dbase/spice-models/
- Vishay SPICE models — https://www.vishay.com/en/how/spice-models/

**Auto-layout (only needed for cold-netlist import, step 2)**
- elkjs — https://github.com/kieler/elkjs
- dagre — https://github.com/dagrejs/dagre

**LLM integration (step 3)**
- Claude API tool use / function calling — https://docs.claude.com/en/docs/build-with-claude/tool-use
- Messages API — https://docs.claude.com/en/api/messages

---

## 12. Glossary

- **refdes** — reference designator (`R1`, `XM3`). The unique label per part and
  the join key across schematic ↔ netlist ↔ layout.
- **net** — an electrical node; a set of pins joined by wires. `0` is ground.
- **subckt** — a SPICE subcircuit; how vendor/behavioural device models are
  packaged. Called with `X<refdes> <nodes> <name>`.
- **Kelvin sense** — a separate source/emitter connection for the gate return,
  isolating the gate loop from power-loop di/dt (lower switching loss/ringing).
- **projection** — the netlist; derived from the graph, not a second truth.
- **op** — a structured circuit edit (`addComponent` / `setParam` / …); the
  contract between the assistant and the graph.
