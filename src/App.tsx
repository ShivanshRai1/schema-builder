import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
} from "@xyflow/react";
import { Canvas } from "./components/Canvas";
import { Palette } from "./components/Palette";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { NetlistPanel } from "./components/NetlistPanel";
import { ChatPanel } from "./components/ChatPanel";
import { COMPONENT_SPECS, defaultParams } from "./model/componentSpecs";
import type { ComponentData, ComponentKind } from "./model/types";
import { toNetlist } from "./netlist/toNetlist";
import type { Op } from "./llm/ops";

// --- seed circuit: V1 - R1 - C1 to ground ----------------------------------
const mk = (id: string, kind: ComponentKind, refdes: string, x: number, y: number): Node<ComponentData> => ({
  id, type: "component", position: { x, y },
  data: { kind, refdes, params: { ...defaultParams(kind) } },
});

const INITIAL_NODES: Node<ComponentData>[] = [
  mk("n1", "V", "V1", 40, 180),
  mk("n2", "R", "R1", 280, 90),
  mk("n3", "C", "C1", 540, 180),
  mk("n4", "GND", "", 280, 360),
];
const wire = (s: string, sh: string, t: string, th: string): Edge => ({ id: `${s}${sh}-${t}${th}`, source: s, sourceHandle: sh, target: t, targetHandle: th });
const INITIAL_EDGES: Edge[] = [
  wire("n1", "p", "n2", "a"),
  wire("n2", "b", "n3", "a"),
  wire("n3", "b", "n4", "g"),
  wire("n1", "n", "n4", "g"),
];

// Refdes allocator: numbers PER SPICE PREFIX so kinds that share a prefix
// (NMOS/PMOS -> M, NPN/PNP -> Q) never collide.
function makeAllocator(nodes: Node<ComponentData>[]) {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const pfx = COMPONENT_SPECS[n.data.kind].refdesPrefix;
    if (pfx) counts.set(pfx, (counts.get(pfx) ?? 0) + 1);
  }
  return (kind: ComponentKind): string => {
    const pfx = COMPONENT_SPECS[kind].refdesPrefix;
    if (!pfx) return "";
    const next = (counts.get(pfx) ?? 0) + 1;
    counts.set(pfx, next);
    return `${pfx}${next}`;
  };
}

interface Clipboard { nodes: Node<ComponentData>[]; edges: Edge[]; }

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ComponentData>>(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const idCounter = useRef(INITIAL_NODES.length);
  const placeCounter = useRef(0);
  const clipboard = useRef<Clipboard | null>(null);

  const netlist = useMemo(() => toNetlist(nodes, edges, { title: "SimulAI demo" }), [nodes, edges]);
  const selected = nodes.filter((n) => n.selected);
  const selectedNode = selected.length === 1 ? selected[0] : null;

  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge(c, eds)), [setEdges]);

  const newId = () => `n${++idCounter.current}`;

  const addComponent = useCallback((kind: ComponentKind) => {
    setNodes((ns) => {
      const alloc = makeAllocator(ns);
      const k = placeCounter.current++;
      return [...ns, mk(newId(), kind, alloc(kind), 240 + (k % 6) * 34, 200 + (k % 6) * 34)];
    });
  }, [setNodes]);

  // --- attribute + refdes editing (graph is the source of truth) -----------
  const changeParam = useCallback((nodeId: string, key: string, value: string) => {
    setNodes((ns) => ns.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, params: { ...n.data.params, [key]: value } } } : n));
  }, [setNodes]);

  const changeRefdes = useCallback((nodeId: string, refdes: string) => {
    setNodes((ns) => ns.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, refdes } } : n));
  }, [setNodes]);

  const deleteNodes = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setNodes((ns) => ns.filter((n) => !idSet.has(n.id)));
    setEdges((es) => es.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)));
  }, [setNodes, setEdges]);

  // --- clipboard: copy / cut / paste ---------------------------------------
  const copySelection = useCallback(() => {
    const sel = nodes.filter((n) => n.selected);
    if (!sel.length) return;
    const idSet = new Set(sel.map((n) => n.id));
    const internal = edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
    clipboard.current = {
      nodes: sel.map((n) => ({ ...n, data: { ...n.data, params: { ...n.data.params } } })),
      edges: internal.map((e) => ({ ...e })),
    };
  }, [nodes, edges]);

  const paste = useCallback(() => {
    const clip = clipboard.current;
    if (!clip || !clip.nodes.length) return;
    setNodes((ns) => {
      const alloc = makeAllocator(ns);
      const idMap = new Map<string, string>();
      const pasted: Node<ComponentData>[] = clip.nodes.map((n) => {
        const nid = newId();
        idMap.set(n.id, nid);
        return {
          ...n,
          id: nid,
          selected: true,
          position: { x: n.position.x + 40, y: n.position.y + 40 },
          data: { ...n.data, params: { ...n.data.params }, refdes: alloc(n.data.kind) },
        };
      });
      const deselected = ns.map((n) => (n.selected ? { ...n, selected: false } : n));
      // remap internal edges onto the new node ids
      setEdges((es) => [
        ...es,
        ...clip.edges.map((e) => ({
          ...e,
          id: `${idMap.get(e.source)}${e.sourceHandle}-${idMap.get(e.target)}${e.targetHandle}-${idCounter.current}`,
          source: idMap.get(e.source)!,
          target: idMap.get(e.target)!,
        })),
      ]);
      return [...deselected, ...pasted];
    });
  }, [setNodes, setEdges]);

  const cutSelection = useCallback(() => {
    copySelection();
    deleteNodes(nodes.filter((n) => n.selected).map((n) => n.id));
  }, [copySelection, deleteNodes, nodes]);

  // --- keyboard shortcuts (ignored while typing in a field / editor) -------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('input, textarea, select, [contenteditable="true"], .monaco-editor')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "c") { copySelection(); }
      else if (mod && e.key.toLowerCase() === "x") { e.preventDefault(); cutSelection(); }
      else if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); paste(); }
      else if (e.key === "Delete" || e.key === "Backspace") {
        const ids = nodes.filter((n) => n.selected).map((n) => n.id);
        if (ids.length) { e.preventDefault(); deleteNodes(ids); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copySelection, cutSelection, paste, deleteNodes, nodes]);

  // --- structured ops from the assistant panel -----------------------------
  const applyOps = useCallback((ops: Op[]) => {
    for (const op of ops) {
      if (op.type === "addComponent") addComponent(op.kind);
      else if (op.type === "setParam") setNodes((ns) => ns.map((n) => n.data.refdes === op.refdes ? { ...n, data: { ...n.data, params: { ...n.data.params, [op.key]: op.value } } } : n));
      else if (op.type === "deleteComponent") {
        const target = nodes.find((n) => n.data.refdes === op.refdes);
        if (target) deleteNodes([target.id]);
      }
    }
  }, [addComponent, setNodes, nodes, deleteNodes]);

  const onRequestEdit = useCallback(() => {
    alert(
      "Step 2 seam: this is where the netlist becomes an editable fallback.\n\n" +
      "Edits get parsed, diffed against the graph, and patched by refdes so the " +
      "schematic layout is preserved. Not wired in this step-1 foundation.",
    );
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">SimulAI · Schematic Editor</span>
        <span className="app-sub">graph-authoritative · netlist is a live projection · step-1 foundation</span>
        <span className="app-hint">drag pin→pin to wire · Ctrl/⌘ C/X/V · Del</span>
      </header>

      <div className="workspace">
        <Palette onAdd={addComponent} />

        <Canvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
        />

        <div className="right-col">
          <PropertiesPanel
            node={selectedNode}
            onChangeParam={changeParam}
            onChangeRefdes={changeRefdes}
            onDelete={(id) => deleteNodes([id])}
          />
          <NetlistPanel netlist={netlist} onRequestEdit={onRequestEdit} />
          <ChatPanel onApplyOps={applyOps} />
        </div>
      </div>
    </div>
  );
}
