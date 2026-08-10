import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { SimPanel } from "./components/SimPanel";
import { LibraryPanel } from "./components/LibraryPanel";
import { COMPONENT_SPECS, defaultParams } from "./model/componentSpecs";
import type { ComponentData, ComponentKind } from "./model/types";
import { nextRotation } from "./model/rotation";
import { toNetlist } from "./netlist/toNetlist";
import { extractDirectives } from "./netlist/parseDeviceParams";
import { applyNetlistToGraph } from "./netlist/applyNetlistToGraph";
import { createHistory, type CircuitSnapshot } from "./history/circuitHistory";
import { downloadCircuit, readCircuitFile } from "./persistence/circuitFile";
import type { Op } from "./llm/ops";
import type { AssistantContext } from "./llm/assistantTypes";
import {
  connectEndpoints,
  defaultPin,
  disconnectEndpoints,
  endpointLabel,
  findNodeByRefdes,
} from "./llm/wireOps";

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
const wire = (s: string, sh: string, t: string, th: string): Edge => ({
  id: `${s}${sh}-${t}${th}`,
  type: "smoothstep",
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
});
const INITIAL_EDGES: Edge[] = [
  wire("n1", "p", "n2", "a"),
  wire("n2", "b", "n3", "a"),
  wire("n3", "b", "n4", "g"),
  wire("n1", "n", "n4", "g"),
];

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

function syncIdCounter(nodes: Node<ComponentData>[], idCounter: { current: number }) {
  let max = 0;
  for (const n of nodes) {
    const m = /^n(\d+)$/.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  idCounter.current = Math.max(idCounter.current, max);
}

interface Clipboard { nodes: Node<ComponentData>[]; edges: Edge[]; }

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ComponentData>>(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const idCounter = useRef(INITIAL_NODES.length);
  const placeCounter = useRef(0);
  const clipboard = useRef<Clipboard | null>(null);
  const history = useRef(createHistory());
  const dragOrigin = useRef<CircuitSnapshot | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [textEditMode, setTextEditMode] = useState(false);
  const [draftNetlist, setDraftNetlist] = useState("");
  const [netlistStatus, setNetlistStatus] = useState<string | null>(null);
  const [directives, setDirectives] = useState<string[] | undefined>(undefined);
  const [library, setLibrary] = useState("");
  const [showLibrary, setShowLibrary] = useState(false);
  const [histTick, setHistTick] = useState(0);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const directivesRef = useRef(directives);
  const libraryRef = useRef(library);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  directivesRef.current = directives;
  libraryRef.current = library;

  const snapshot = useCallback((): CircuitSnapshot => ({
    nodes: nodesRef.current,
    edges: edgesRef.current,
    directives: directivesRef.current,
    library: libraryRef.current,
  }), []);

  const pushHistory = useCallback(() => {
    history.current.push(snapshot());
    setHistTick((t) => t + 1);
  }, [snapshot]);

  const restore = useCallback((s: CircuitSnapshot) => {
    setNodes(s.nodes);
    setEdges(s.edges);
    setDirectives(s.directives);
    setLibrary(s.library);
    syncIdCounter(s.nodes, idCounter);
    setHistTick((t) => t + 1);
  }, [setNodes, setEdges]);

  const undo = useCallback(() => {
    const prev = history.current.undo(snapshot());
    if (prev) restore(prev);
  }, [snapshot, restore]);

  const redo = useCallback(() => {
    const next = history.current.redo(snapshot());
    if (next) restore(next);
  }, [snapshot, restore]);

  const netlist = useMemo(
    () => toNetlist(nodes, edges, { title: "SimulAI demo", directives, library }),
    [nodes, edges, directives, library],
  );
  const selected = nodes.filter((n) => n.selected);
  const selectedNode = selected.length === 1 ? selected[0] : null;

  const onConnect = useCallback((c: Connection) => {
    pushHistory();
    setEdges((eds) => addEdge({ ...c, type: "smoothstep" }, eds));
  }, [setEdges, pushHistory]);

  const rotateSelected = useCallback(() => {
    const sel = nodes.filter((n) => n.selected);
    if (!sel.length) return;
    pushHistory();
    setNodes((ns) =>
      ns.map((n) =>
        n.selected
          ? { ...n, data: { ...n.data, rotation: nextRotation(n.data.rotation) } }
          : n,
      ),
    );
  }, [nodes, setNodes, pushHistory]);

  const newId = () => `n${++idCounter.current}`;

  const addComponent = useCallback((kind: ComponentKind) => {
    pushHistory();
    setNodes((ns) => {
      const alloc = makeAllocator(ns);
      const k = placeCounter.current++;
      return [...ns, mk(newId(), kind, alloc(kind), 240 + (k % 6) * 34, 200 + (k % 6) * 34)];
    });
  }, [setNodes, pushHistory]);

  const addComponentAt = useCallback((kind: ComponentKind, x: number, y: number) => {
    pushHistory();
    setNodes((ns) => {
      const alloc = makeAllocator(ns);
      return [...ns, mk(newId(), kind, alloc(kind), x, y)];
    });
  }, [setNodes, pushHistory]);

  const replaceComponent = useCallback((nodeId: string, kind: ComponentKind) => {
    const target = nodesRef.current.find((n) => n.id === nodeId);
    if (!target || target.data.kind === kind) return;
    pushHistory();
    const pinIds = new Set(COMPONENT_SPECS[kind].pins.map((p) => p.id));
    setNodes((ns) => {
      const alloc = makeAllocator(ns);
      return ns.map((n) =>
        n.id !== nodeId
          ? n
          : {
              ...n,
              data: {
                kind,
                refdes: alloc(kind),
                params: { ...defaultParams(kind) },
              },
            },
      );
    });
    setEdges((es) =>
      es.filter((e) => {
        if (e.source === nodeId && e.sourceHandle && !pinIds.has(e.sourceHandle)) return false;
        if (e.target === nodeId && e.targetHandle && !pinIds.has(e.targetHandle)) return false;
        return true;
      }),
    );
  }, [setNodes, setEdges, pushHistory]);

  const changeParam = useCallback((nodeId: string, key: string, value: string) => {
    pushHistory();
    setNodes((ns) => ns.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, params: { ...n.data.params, [key]: value } } } : n));
  }, [setNodes, pushHistory]);

  const changeRefdes = useCallback((nodeId: string, refdes: string) => {
    pushHistory();
    setNodes((ns) => ns.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, refdes } } : n));
  }, [setNodes, pushHistory]);

  const deleteNodes = useCallback((ids: string[]) => {
    if (!ids.length) return;
    pushHistory();
    const idSet = new Set(ids);
    setNodes((ns) => ns.filter((n) => !idSet.has(n.id)));
    setEdges((es) => es.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)));
  }, [setNodes, setEdges, pushHistory]);

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
    pushHistory();
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
  }, [setNodes, setEdges, pushHistory]);

  const cutSelection = useCallback(() => {
    copySelection();
    deleteNodes(nodes.filter((n) => n.selected).map((n) => n.id));
  }, [copySelection, deleteNodes, nodes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('input, textarea, select, [contenteditable="true"], .monaco-editor')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
      else if (mod && e.key.toLowerCase() === "c") { copySelection(); }
      else if (mod && e.key.toLowerCase() === "x") { e.preventDefault(); cutSelection(); }
      else if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); paste(); }
      else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        downloadCircuit(snapshot());
      }
      else if (e.key === "Delete" || e.key === "Backspace") {
        const ids = nodes.filter((n) => n.selected).map((n) => n.id);
        if (ids.length) { e.preventDefault(); deleteNodes(ids); }
      }
      else if (!mod && e.key.toLowerCase() === "r") {
        const hasSel = nodes.some((n) => n.selected);
        if (hasSel) { e.preventDefault(); rotateSelected(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copySelection, cutSelection, paste, deleteNodes, nodes, undo, redo, snapshot, rotateSelected]);

  const startTextEdit = useCallback(() => {
    setDraftNetlist(netlist);
    setTextEditMode(true);
    setNetlistStatus(null);
  }, [netlist]);

  const cancelTextEdit = useCallback(() => {
    setTextEditMode(false);
    setDraftNetlist("");
    setNetlistStatus(null);
  }, []);

  const applyTextEdit = useCallback(() => {
    pushHistory();
    const result = applyNetlistToGraph(nodes, edges, draftNetlist);
    setNodes(result.nodes);
    setEdges(result.edges);
    syncIdCounter(result.nodes, idCounter);

    const dirs = extractDirectives(draftNetlist);
    if (dirs.length) setDirectives(dirs);

    setTextEditMode(false);
    setDraftNetlist("");

    const parts: string[] = [];
    if (result.updated.length) parts.push(`updated ${result.updated.join(", ")}`);
    if (result.added.length) parts.push(`added ${result.added.join(", ")} (unplaced — drag to position)`);
    if (result.deleted.length) parts.push(`deleted ${result.deleted.join(", ")}`);
    if (result.skippedUnknown.length) parts.push(`skipped unknown ${result.skippedUnknown.join(", ")}`);
    if (!parts.length) parts.push("no device changes");
    if (result.rewired) parts.push("wires rebuilt from nets");
    setNetlistStatus(parts.join(" · "));
  }, [nodes, edges, draftNetlist, setNodes, setEdges, pushHistory]);

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      for (const c of changes) {
        if (c.type === "position" && c.dragging === true && !dragOrigin.current) {
          dragOrigin.current = snapshot();
        }
        if (c.type === "position" && c.dragging === false && dragOrigin.current) {
          history.current.push(dragOrigin.current);
          dragOrigin.current = null;
          setHistTick((t) => t + 1);
        }
      }
      onNodesChange(changes);
      const placedIds = changes.flatMap((c) =>
        c.type === "position" && c.dragging === false ? [c.id] : [],
      );
      if (!placedIds.length) return;
      const idSet = new Set(placedIds);
      setNodes((ns) =>
        ns.map((n) =>
          idSet.has(n.id) && n.data.unplaced
            ? { ...n, data: { ...n.data, unplaced: false } }
            : n,
        ),
      );
    },
    [onNodesChange, setNodes, snapshot],
  );

  const onSave = useCallback(() => {
    downloadCircuit(snapshot());
  }, [snapshot]);

  const onLoadClick = useCallback(() => fileInputRef.current?.click(), []);

  const onLoadFile = useCallback(async (file: File | null) => {
    if (!file) return;
    try {
      const loaded = await readCircuitFile(file);
      pushHistory();
      restore(loaded);
      setNetlistStatus(`loaded ${file.name}`);
    } catch (e) {
      setNetlistStatus(`load failed: ${e instanceof Error ? e.message : "error"}`);
    }
  }, [pushHistory, restore]);

  const onLibraryChange = useCallback((text: string) => {
    setLibrary(text);
  }, []);

  const applyOpsSafe = useCallback((ops: Op[]) => {
    if (!ops.length) return;
    pushHistory();
    for (const op of ops) {
      if (op.type === "addComponent") {
        setNodes((ns) => {
          const alloc = makeAllocator(ns);
          const k = placeCounter.current++;
          return [...ns, mk(newId(), op.kind, alloc(op.kind), 240 + (k % 6) * 34, 200 + (k % 6) * 34)];
        });
      } else if (op.type === "setParam") {
        const want = op.refdes.toUpperCase();
        setNodes((ns) =>
          ns.map((n) =>
            n.data.refdes.toUpperCase() === want
              ? { ...n, data: { ...n.data, params: { ...n.data.params, [op.key]: op.value } } }
              : n,
          ),
        );
      } else if (op.type === "deleteComponent") {
        const want = op.refdes.toUpperCase();
        const target = nodesRef.current.find((n) => n.data.refdes.toUpperCase() === want);
        if (target) {
          const idSet = new Set([target.id]);
          setNodes((ns) => ns.filter((n) => !idSet.has(n.id)));
          setEdges((es) => es.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)));
        }
      } else if (op.type === "connectPins") {
        setEdges((es) => {
          const nodes = nodesRef.current;
          const a = findNodeByRefdes(nodes, op.aRefdes);
          const b = findNodeByRefdes(nodes, op.bRefdes);
          if (!a || !b) return es;
          const aPin = op.aPin || defaultPin(a, "from");
          const bPin = op.bPin || defaultPin(b, "to");
          return connectEndpoints(es, a, aPin, b, bPin);
        });
      } else if (op.type === "disconnectPins") {
        setEdges((es) => {
          const nodes = nodesRef.current;
          const a = findNodeByRefdes(nodes, op.aRefdes);
          if (!a) return es;
          const b = op.bRefdes ? findNodeByRefdes(nodes, op.bRefdes) : undefined;
          return disconnectEndpoints(es, a, op.aPin, b, op.bPin);
        });
      }
    }
  }, [pushHistory, setNodes, setEdges]);

  const getAssistantContext = useCallback((): AssistantContext => {
    const components = nodes.map((n) => {
      const refdes =
        n.data.refdes ||
        (n.data.kind === "GND" ? "GND" : n.data.kind === "NODE" ? (n.data.params.name || "NODE") : "");
      return {
        refdes,
        kind: n.data.kind,
        params: { ...n.data.params },
        pins: COMPONENT_SPECS[n.data.kind].pins.map((p) => p.id),
      };
    }).filter((c) => c.refdes);

    const wires = edges
      .filter((e) => e.sourceHandle && e.targetHandle)
      .map((e) => {
        const a = nodes.find((n) => n.id === e.source);
        const b = nodes.find((n) => n.id === e.target);
        if (!a || !b) return null;
        return {
          a: endpointLabel(a, e.sourceHandle!),
          b: endpointLabel(b, e.targetHandle!),
        };
      })
      .filter((w): w is { a: string; b: string } => w !== null);

    return { components, wires, netlist };
  }, [nodes, edges, netlist]);

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">SimulAI · Schematic Editor</span>
        <div className="app-actions">
          <button type="button" className="ghost-btn" disabled={histTick < 0 || !history.current.canUndo()} onClick={undo} title="Undo (Ctrl+Z)">Undo</button>
          <button type="button" className="ghost-btn" disabled={histTick < 0 || !history.current.canRedo()} onClick={redo} title="Redo (Ctrl+Y)">Redo</button>
          <button type="button" className="ghost-btn" onClick={onSave} title="Save circuit JSON (Ctrl+S)">Save</button>
          <button type="button" className="ghost-btn" onClick={onLoadClick} title="Load circuit JSON">Load</button>
          <button type="button" className="ghost-btn" onClick={() => setShowLibrary((v) => !v)}>
            {showLibrary ? "Hide models" : "Models"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              void onLoadFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </div>
        <span className="app-hint">Ctrl/⌘ Z/Y undo/redo · S save · C/X/V · Del</span>
      </header>

      <div className="workspace">
        <Palette onAdd={addComponent} />

        <Canvas
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReplace={replaceComponent}
          onAddAt={addComponentAt}
        />

        <div className="right-col">
          <PropertiesPanel
            node={selectedNode}
            onChangeParam={changeParam}
            onChangeRefdes={changeRefdes}
            onRotate={rotateSelected}
            onDelete={(id) => deleteNodes([id])}
          />
          <NetlistPanel
            netlist={netlist}
            editing={textEditMode}
            draft={draftNetlist}
            status={netlistStatus}
            onStartEdit={startTextEdit}
            onDraftChange={setDraftNetlist}
            onApply={applyTextEdit}
            onCancel={cancelTextEdit}
          />
          {showLibrary && (
            <LibraryPanel library={library} onChange={onLibraryChange} />
          )}
          <SimPanel netlist={netlist} />
          <ChatPanel onApplyOps={applyOpsSafe} getContext={getAssistantContext} />
        </div>
      </div>
    </div>
  );
}
