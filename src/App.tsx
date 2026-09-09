import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
} from "@xyflow/react";
import { Canvas, type CanvasMode, type CanvasViewApi, type WireCompletePayload, type WirePartialPayload } from "./components/Canvas";
import { Palette } from "./components/Palette";
import { NetNameDialog } from "./components/NetNameDialog";
import { ModeToolbar } from "./components/ModeToolbar";
import {
  ComponentPropertiesDialog,
  type ComponentPropsDraft,
} from "./components/ComponentPropertiesDialog";
import { NetlistPanel } from "./components/NetlistPanel";
import { ChatPanel } from "./components/ChatPanel";
import { SimPanel, type SimControlApi, type SimRunState } from "./components/SimPanel";
import { SimResultContext } from "./sim/SimResultContext";
import { ClearProbesOnSimChange, ProbeProvider } from "./sim/ProbeContext";
import type { SimResult } from "./sim/runSimulation";
import { LibraryPanel } from "./components/LibraryPanel";
import { FloatingWindow } from "./components/FloatingWindow";
import { COMPONENT_SPECS, defaultParams, getComponentPins, isGroundKind } from "./model/componentSpecs";
import { readCommonlyUsed, recordCommonlyUsed } from "./model/commonlyUsed";
import type { ComponentData, ComponentKind, ComponentRotation } from "./model/types";
import { normalizeRotation } from "./model/rotation";
import { toNetlist } from "./netlist/toNetlist";
import { extractDirectives } from "./netlist/parseDeviceParams";
import { applyNetlistToGraph } from "./netlist/applyNetlistToGraph";
import { createHistory, type CircuitSnapshot } from "./history/circuitHistory";
import { downloadCircuit, parseCircuitFile, readCircuitFile } from "./persistence/circuitFile";
import starterCircuit from "../examples/demo-circuit.json";
import hbridgeSimplifiedCircuit from "../examples/hbridge-simplified.json";
import { applyTheme, readStoredTheme, type UiTheme } from "./theme";
import type { Op } from "./llm/ops";
import type { AssistantContext } from "./llm/assistantTypes";
import {
  connectEndpoints,
  defaultPin,
  disconnectEndpoints,
  endpointLabel,
  findNodeByRefdes,
} from "./llm/wireOps";
import { applyCutMove, detachPartForMove, edgesCoveredByRect, nodesCoveredByRect, nodesInRect, reconnectPartsOnTips, reconnectTipsOnPins, type FlowRect } from "./wiring/cutMove";
import { attachPartsToWires, attachNetNameToNearestPin } from "./wiring/insertOnWire";
import {
  detachWireForMove,
  detachWireSegmentForDrag,
  finalizeConnectedPartMove,
  finalizePartRotate,
  planConnectedPartMove,
  planNearAlignPartNudge,
  promoteInlinePinTees,
  straightenWire,
} from "./wiring/wireMove";
import {
  clearTipStubsOnPins,
  pruneOrphanTips,
  collapsePassThroughTips,
  collapseOnePassThroughTip,
  pruneGhostTipsOnPins,
  absorbTipsOntoPins,
} from "./wiring/tipCleanup";
import { dissolveJunctionTip, wireMarkKey } from "./wiring/junctions";
import { pinWorldPoint } from "./wiring/pinGeometry";
import {
  computeEdgePolyline,
  distToPolyline,
  hitTestWirePolyline,
  polylineToStoredWaypoints,
} from "./wiring/wireGeometry";
import type { SchematicWireData } from "./edges/SchematicWireEdge";
import {
  cleanEdgeTrailingNubs,
  isDanglingOrTrailingEdge,
  isFullyDanglingLeftover,
  isShortDanglingStub,
  normalizeWires,
  planDeleteSelectedSegment,
  planScissorWireDelete,
  removeDanglingOrTrailingEdges,
  trimEdgeEndsToJoins,
  type ScissorDeletePlan,
} from "./wiring/normalizeWires";
import {
  instantiateClipboard,
  partOccupancy,
  rotateClipboardCw,
  type CircuitClipboard,
} from "./model/circuitClipboard";
import { WIRE_GRID, type Point } from "./wiring/orthogonal";

// --- seed circuit: examples/demo-circuit.json (Restore starter uses the same) ---
const mk = (
  id: string,
  kind: ComponentKind,
  refdes: string,
  x: number,
  y: number,
  rotation: ComponentRotation = 0,
  paramsExtra?: Record<string, string>,
): Node<ComponentData> => ({
  id, type: "component", position: { x, y },
  data: {
    kind,
    refdes,
    params: { ...defaultParams(kind), ...paramsExtra },
    rotation,
  },
});

const STARTER = parseCircuitFile(starterCircuit);
const INITIAL_NODES: Node<ComponentData>[] = STARTER.nodes;
const INITIAL_EDGES: Edge[] = STARTER.edges;

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

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ComponentData>>(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const idCounter = useRef(INITIAL_NODES.length);
  const placeCounter = useRef(0);
  const clipboard = useRef<CircuitClipboard | null>(null);
  const history = useRef(createHistory());
  const dragOrigin = useRef<CircuitSnapshot | null>(null);
  const connectedMoveRef = useRef(false);
  const moveSeverGuard = useRef<{ nodeId: string; at: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const migratedValueDefaults = useRef(false);

  // One-time: replace old numeric factory defaults with letter placeholders (R/C/L/V/I).
  useEffect(() => {
    if (migratedValueDefaults.current) return;
    migratedValueDefaults.current = true;
    const migrateValue = (kind: string, value: string): string | null => {
      const v = value.trim();
      if (kind === "V" && /^DC\s*12$/i.test(v)) return "V";
      if (kind === "I" && /^DC\s*1$/i.test(v)) return "I";
      if (
        (kind === "R" || kind === "RBOX" || kind === "RVAR" || kind === "RVARBOX" ||
          kind === "POT" || kind === "POTBOX") &&
        /^10k$/i.test(v)
      ) {
        return "R";
      }
      if (kind === "CSENSE" && /^10m$/i.test(v)) return "R";
      if ((kind === "L" || kind === "LVAR") && /^1u$/i.test(v)) return "L";
      if ((kind === "C" || kind === "CFIXED") && /^1n$/i.test(v)) return "C";
      if (kind === "CPOL" && /^10u$/i.test(v)) return "C";
      if (kind === "CVAR" && /^100p$/i.test(v)) return "C";
      return null;
    };
    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        const cur = n.data.params.value ?? "";
        const to = migrateValue(n.data.kind, cur);
        if (!to) return n;
        changed = true;
        return {
          ...n,
          data: { ...n.data, params: { ...n.data.params, value: to } },
        };
      });
      return changed ? next : ns;
    });
  }, [setNodes]);

  // One-time: shrink net-name node box 64×48 → 16×16 without moving the join.
  useEffect(() => {
    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        if (n.data.kind !== "WIRELABEL") return n;
        if (n.data.params._lb === "2") return n;
        changed = true;
        // Old join was bottom-center of 64×48; keep that world point on 16×16.
        return {
          ...n,
          position: {
            x: n.position.x + (64 - 16) / 2,
            y: n.position.y + (48 - 16),
          },
          data: {
            ...n.data,
            params: { ...n.data.params, _lb: "2" },
          },
        };
      });
      return changed ? next : ns;
    });
  }, [setNodes]);

  const [textEditMode, setTextEditMode] = useState(false);
  const [uiTheme, setUiTheme] = useState<UiTheme>(() => readStoredTheme());
  const [draftNetlist, setDraftNetlist] = useState("");
  const [netlistStatus, setNetlistStatus] = useState<string | null>(null);
  const [netlistStatusError, setNetlistStatusError] = useState(false);
  const [directives, setDirectives] = useState<string[] | undefined>(
    () => STARTER.directives,
  );
  const [library, setLibrary] = useState(() => STARTER.library ?? "");
  const [showLibrary, setShowLibrary] = useState(false);
  const [netlistFloating, setNetlistFloating] = useState(false);
  const [simFloating, setSimFloating] = useState(false);
  const [rightWidth, setRightWidth] = useState(380);
  const [slotFr, setSlotFr] = useState({
    netlist: 1.2,
    sim: 1.0,
    chat: 1.0,
    library: 0.55,
  });
  const rightColRef = useRef<HTMLDivElement>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("explore");
  const canvasViewApiRef = useRef<CanvasViewApi | null>(null);
  const simControlRef = useRef<SimControlApi | null>(null);
  const [simRunState, setSimRunState] = useState<SimRunState>("idle");
  /** Last successful/failed sim waveforms — enables canvas probe hover when ok. */
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [placeKind, setPlaceKind] = useState<ComponentKind | null>(null);
  const [placeParams, setPlaceParams] = useState<Record<string, string> | null>(null);
  /** Session palette “Commonly used” (most recent first). */
  const [commonlyUsed, setCommonlyUsed] = useState<ComponentKind[]>(() => readCommonlyUsed());
  const noteCommonlyUsed = useCallback((...kinds: ComponentKind[]) => {
    if (!kinds.length) return;
    setCommonlyUsed(recordCommonlyUsed(...kinds));
  }, []);
  const [netNameDialog, setNetNameDialog] = useState(false);
  const lastWireLabelName = useRef("");
  /** Last flow-space click on a wire — Delete uses scissors here, not whole-edge wipe. */
  const lastWireClickRef = useRef<{ edgeId: string; point: Point } | null>(null);
  const deleteEdgeWithToolRef = useRef<
    (edgeId: string, clickPoint?: Point, forcedPlan?: ScissorDeletePlan) => void
  >(() => {});
  const [pasteClip, setPasteClip] = useState<CircuitClipboard | null>(null);
  /** Ctrl+C copy-marquee tool (dotted box); finishes into pasteClip. */
  const [copyMarquee, setCopyMarquee] = useState(false);
  const [hiddenCrossingKeys, setHiddenCrossingKeys] = useState<string[]>([]);
  const [propsDialog, setPropsDialog] = useState<{
    nodeId: string;
    x: number;
    y: number;
  } | null>(null);
  const [histTick, setHistTick] = useState(0);

  useEffect(() => {
    applyTheme(uiTheme);
  }, [uiTheme]);

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
  const propsDialogNode = propsDialog
    ? nodes.find((n) => n.id === propsDialog.nodeId && n.data.kind !== "TIP") ?? null
    : null;

  // Part deleted/replaced while dialog open → close it.
  useEffect(() => {
    if (propsDialog && !propsDialogNode) setPropsDialog(null);
  }, [propsDialog, propsDialogNode]);

  const beginRowSplit = useCallback(
    (upper: keyof typeof slotFr, lower: keyof typeof slotFr, e: React.PointerEvent) => {
      const col = rightColRef.current;
      if (!col) return;
      e.preventDefault();
      const startY = e.clientY;
      const startUpper = slotFr[upper];
      const startLower = slotFr[lower];
      const colH = Math.max(1, col.clientHeight);
      const onMove = (ev: PointerEvent) => {
        const dFr = ((ev.clientY - startY) / colH) * (startUpper + startLower);
        const minFr = 0.22;
        let u = startUpper + dFr;
        let l = startLower - dFr;
        if (u < minFr) {
          l -= minFr - u;
          u = minFr;
        }
        if (l < minFr) {
          u -= minFr - l;
          l = minFr;
        }
        setSlotFr((s) => ({ ...s, [upper]: Math.max(minFr, u), [lower]: Math.max(minFr, l) }));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [slotFr],
  );

  const beginColResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightWidth;
    const onMove = (ev: PointerEvent) => {
      setRightWidth(Math.max(260, Math.min(720, startW - (ev.clientX - startX))));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [rightWidth]);

  const TIP_SIZE = 8;
  const newId = () => `n${++idCounter.current}`;
  const makeTipNode = (tipId: string, end: { x: number; y: number }) => ({
    id: tipId,
    type: "component" as const,
    position: { x: end.x, y: end.y - TIP_SIZE / 2 },
    data: { kind: "TIP" as const, refdes: "", params: {} },
    style: { width: TIP_SIZE, height: TIP_SIZE },
    selected: false,
    draggable: false,
  });

  const onWire = useCallback((payload: WireCompletePayload) => {
    const { waypoints, freeStart, ...rest } = payload;
    let c = rest;
    let ns = nodesRef.current;
    let eds = edgesRef.current;

    if (freeStart && !c.source) {
      const tipId = newId();
      ns = [...ns, makeTipNode(tipId, freeStart)];
      c = { ...c, source: tipId, sourceHandle: "t" };
    }

    if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return;
    if (c.source === c.target && c.sourceHandle === c.targetHandle) return;

    pushHistory();
    const srcNode = ns.find((n) => n.id === c.source);
    const tgtNode = ns.find((n) => n.id === c.target);

    // TIP endpoints: always ADD the new run. Never "dissolve tip → drop all its
    // edges → rebuild" — that wiped half/most of free-wire meshes whenever you
    // extended from a tip and finished on the same net / mid-rail / other tip.
    // Straight pass-throughs are healed afterward with collapseOnePassThroughTip.
    if (srcNode?.data.kind === "TIP" || tgtNode?.data.kind === "TIP") {
      if (tgtNode && tgtNode.data.kind !== "TIP") {
        const cleared = clearTipStubsOnPins(ns, eds, [
          { nodeId: c.target, handle: c.targetHandle },
        ]);
        ns = cleared.nodes;
        eds = cleared.edges;
      } else if (srcNode && srcNode.data.kind !== "TIP") {
        const cleared = clearTipStubsOnPins(ns, eds, [
          { nodeId: c.source, handle: c.sourceHandle },
        ]);
        ns = cleared.nodes;
        eds = cleared.edges;
      }

      let nextNodes = ns;
      let nextEdges = addEdge(
        { ...c, type: "schematic", data: { waypoints, directPath: true } },
        eds,
      );

      // Only collapse tips that were dangling (deg 1) before this add and are
      // now a straight H/V through-run. Junction tips (deg ≥ 2) stay put.
      const degBefore = (id: string) =>
        eds.reduce(
          (n, e) => n + (e.source === id || e.target === id ? 1 : 0),
          0,
        );
      if (srcNode?.data.kind === "TIP" && degBefore(c.source) === 1) {
        const collapsed = collapseOnePassThroughTip(nextNodes, nextEdges, c.source);
        nextNodes = collapsed.nodes;
        nextEdges = collapsed.edges;
      }
      if (tgtNode?.data.kind === "TIP" && degBefore(c.target) === 1) {
        // Target tip id still valid after optional source collapse.
        if (nextNodes.some((n) => n.id === c.target)) {
          const collapsed = collapseOnePassThroughTip(nextNodes, nextEdges, c.target);
          nextNodes = collapsed.nodes;
          nextEdges = collapsed.edges;
        }
      }

      const pruned = pruneOrphanTips(nextNodes, nextEdges);
      setNodes(pruned.nodes);
      setEdges(pruned.edges);
      return;
    }

    // Real pin → real pin: replace any Move/Esc tip stubs on those pins first.
    const cleared = clearTipStubsOnPins(ns, eds, [
      { nodeId: c.source, handle: c.sourceHandle },
      { nodeId: c.target, handle: c.targetHandle },
    ]);
    const pruned = pruneOrphanTips(cleared.nodes, cleared.edges);
    // Do NOT normalizeWires here — that rewrote unrelated edges (e.g. V1–R1
    // when finishing R1–C1). User bends stay literal via directPath.
    setNodes(pruned.nodes);
    setEdges(
      addEdge(
        { ...c, type: "schematic", data: { waypoints, directPath: true } },
        pruned.edges,
      ),
    );
  }, [setNodes, setEdges, pushHistory]);

  const onWirePartial = useCallback((payload: WirePartialPayload) => {
    const { source, sourceHandle, freeStart, waypoints, end } = payload;
    pushHistory();
    if (!source || !sourceHandle) {
      if (!freeStart) return;
      const a = newId();
      const b = newId();
      const nextNodes = [
        ...nodesRef.current,
        makeTipNode(a, freeStart),
        makeTipNode(b, end),
      ];
      const nextEdges = addEdge(
        {
          id: `${a}t-${b}t`,
          type: "schematic",
          source: a,
          sourceHandle: "t",
          target: b,
          targetHandle: "t",
          data: { waypoints, directPath: true },
        },
        edgesRef.current,
      );
      setNodes(nextNodes);
      setEdges(nextEdges);
      return;
    }

    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;
    const sourceNode = currentNodes.find((node) => node.id === source);
    const sourceDegree = currentEdges.reduce(
      (count, edge) =>
        count + (edge.source === source || edge.target === source ? 1 : 0),
      0,
    );
    const tipId = newId();
    const nextNodes = [...currentNodes, makeTipNode(tipId, end)];
    const nextEdges = addEdge(
      {
        id: `${source}${sourceHandle}-${tipId}t`,
        type: "schematic",
        source,
        sourceHandle,
        target: tipId,
        targetHandle: "t",
        data: { waypoints, directPath: true },
      },
      currentEdges,
    );
    // Extending an existing free wire end turns that old TIP into a degree-2
    // pass-through point. Merge *only that tip* when the run is straight —
    // never scan the whole mesh (that wiped free-wire drawings on finish).
    if (sourceNode?.data.kind === "TIP" && sourceDegree === 1) {
      const collapsed = collapseOnePassThroughTip(nextNodes, nextEdges, source);
      setNodes(collapsed.nodes);
      setEdges(collapsed.edges);
      return;
    }
    setNodes(nextNodes);
    setEdges(nextEdges);
  }, [setNodes, setEdges, pushHistory]);

  /**
   * Split an existing edge at branchPoint, inserting a new TIP node there.
   * Returns the new TIP's node id so the caller can immediately complete a wire
   * draft to it. Uses flushSync so the new node is in React state synchronously.
   */
  const splitEdgeAtPoint = useCallback(
    (
      edgeId: string,
      branchPoint: Point,
      graph?: { nodes: Node<ComponentData>[]; edges: Edge[] },
    ): string | null => {
      const ns = graph?.nodes ?? nodesRef.current;
      const es = graph?.edges ?? edgesRef.current;
      const edge = es.find((e) => e.id === edgeId);
      if (!edge) return null;

      const poly = computeEdgePolyline(ns, edge);
      if (poly.length < 2) return null;

      let splitIdx = 0;
      let bestD = Infinity;
      let splitPoint = poly[0]!;
      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i]!;
        const b = poly[i + 1]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        let t =
          lenSq < 0.01
            ? 0
            : ((branchPoint.x - a.x) * dx + (branchPoint.y - a.y) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const cx = a.x + t * dx;
        const cy = a.y + t * dy;
        const d = Math.hypot(branchPoint.x - cx, branchPoint.y - cy);
        if (d < bestD) {
          bestD = d;
          splitIdx = i;
          splitPoint = { x: cx, y: cy };
        }
      }

      const withoutAdjacentDuplicates = (points: Point[]) =>
        points.filter(
          (p, i) =>
            i === 0 ||
            Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y) > 0.5,
        );
      const beforePath = withoutAdjacentDuplicates([
        ...poly.slice(0, splitIdx + 1),
        splitPoint,
      ]);
      const afterPath = withoutAdjacentDuplicates([
        splitPoint,
        ...poly.slice(splitIdx + 1),
      ]);
      // Both new edges touch a TIP, so their waypoints represent the complete
      // rendered path between endpoints (including the original pin stub).
      const beforeBranch = beforePath.slice(1, -1);
      const afterBranch = afterPath.slice(1, -1);
      const tipId = newId();
      const TIP_SIZE = 8;

      flushSync(() => {
        setNodes([
          ...ns,
          {
            id: tipId,
            type: "component" as const,
            position: { x: splitPoint.x, y: splitPoint.y - TIP_SIZE / 2 },
            data: { kind: "TIP" as const, refdes: "", params: {} },
            style: { width: TIP_SIZE, height: TIP_SIZE },
            selected: false,
            draggable: false,
          },
        ]);
        setEdges([
          ...es.filter((e) => e.id !== edgeId),
          {
            ...edge,
            id: `${edge.source}${edge.sourceHandle}-${tipId}t`,
            target: tipId,
            targetHandle: "t",
            // Freeze the pre-split geometry — without directPath, tip routing
            // re-injects pin stubs and the bus jogs the moment you branch.
            data: { waypoints: beforeBranch, directPath: true },
            selected: false,
          },
          {
            ...edge,
            id: `${tipId}t-${edge.target}${edge.targetHandle}`,
            source: tipId,
            sourceHandle: "t",
            data: { waypoints: afterBranch, directPath: true },
            selected: false,
          },
        ]);
      });

      return tipId;
    },
    [setNodes, setEdges],
  );

  const onWireBranch = useCallback(
    (
      edgeId: string,
      branchPoint: Point,
      graph?: { nodes: Node<ComponentData>[]; edges: Edge[] },
    ): string | null => {
      pushHistory();
      return splitEdgeAtPoint(edgeId, branchPoint, graph);
    },
    [pushHistory, splitEdgeAtPoint],
  );

  const onCancelWireBranch = useCallback((tipId: string) => {
    const es = edgesRef.current;
    const degree = es.reduce(
      (count, edge) =>
        count + (edge.source === tipId || edge.target === tipId ? 1 : 0),
      0,
    );
    if (degree !== 2) return;
    // Only heal this branch tip — do not collapse unrelated free-wire corners.
    const collapsed = collapseOnePassThroughTip(nodesRef.current, es, tipId);
    setNodes(collapsed.nodes);
    setEdges(collapsed.edges);
  }, [setNodes, setEdges]);

  const onSelectEdge = useCallback(
    (edgeId: string, clickPoint?: Point, opts?: { additive?: boolean }) => {
      if (!edgeId) {
        lastWireClickRef.current = null;
        setEdges((eds) =>
          eds.map((e) => {
            if (!e.selected && (e.data as SchematicWireData | undefined)?.selectedSegIndex == null) {
              return e;
            }
            const data = { ...(e.data as object) } as SchematicWireData;
            delete data.selectedSegIndex;
            return { ...e, selected: false, data };
          }),
        );
        setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
        return;
      }

      const additive = Boolean(opts?.additive);

      // Ctrl/⌘+click: toggle whole-wire selection (no segment highlight).
      // Plain click needs a point so only one H/V run lights up.
      if (additive) {
        lastWireClickRef.current = clickPoint
          ? { edgeId, point: clickPoint }
          : lastWireClickRef.current?.edgeId === edgeId
            ? lastWireClickRef.current
            : null;
        setEdges((eds) =>
          eds.map((e) => {
            if (e.id !== edgeId) return e;
            const data = { ...(e.data as object) } as SchematicWireData;
            delete data.selectedSegIndex;
            return { ...e, selected: !e.selected, data };
          }),
        );
        return;
      }

      let segIndex: number | undefined;
      const point =
        clickPoint ??
        (lastWireClickRef.current?.edgeId === edgeId
          ? lastWireClickRef.current.point
          : undefined);
      if (!point) {
        // Refuse whole-snake select from click paths that forgot the point.
        return;
      }
      lastWireClickRef.current = { edgeId, point };
      const edge = edgesRef.current.find((e) => e.id === edgeId);
      if (edge) {
        const poly = computeEdgePolyline(nodesRef.current, edge);
        const hit = hitTestWirePolyline(poly, point, {
          tipWire:
            nodesRef.current.find((n) => n.id === edge.source)?.data.kind === "TIP" ||
            nodesRef.current.find((n) => n.id === edge.target)?.data.kind === "TIP",
        });
        if (hit?.kind === "segment") segIndex = hit.segIndex;
        else if (hit?.kind === "corner") {
          segIndex = Math.max(0, Math.min(poly.length - 2, hit.polyIndex - 1));
        } else if (poly.length >= 2) {
          // Fallback: nearest segment.
          let best = 0;
          let bestD = Infinity;
          for (let i = 0; i < poly.length - 1; i++) {
            const a = poly[i]!;
            const b = poly[i + 1]!;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const lenSq = dx * dx + dy * dy;
            const t =
              lenSq < 0.01
                ? 0
                : Math.max(
                    0,
                    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq),
                  );
            const d = Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
          segIndex = best;
        }
      }
      if (segIndex == null) return;

      setEdges((eds) =>
        eds.map((e) => {
          const data = { ...(e.data as object) } as SchematicWireData;
          delete data.selectedSegIndex;
          if (e.id === edgeId) {
            return {
              ...e,
              selected: true,
              data: { ...data, selectedSegIndex: segIndex },
            };
          }
          return e.selected || (e.data as SchematicWireData | undefined)?.selectedSegIndex != null
            ? { ...e, selected: false, data }
            : e;
        }),
      );
      setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    },
    [setEdges, setNodes],
  );

  /** RF can select several overlapping edges at a junction — coerce to one.
   * Whole-edge select is ignored: segment select must go through onSelectEdge
   * (needs a click point). Marquee uses onSelectRegion directly. */
  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      const rest = changes.filter((c) => {
        if (c.type !== "select") return true;
        // Allow deselect; ignore select-true (would paint the whole snake amber).
        return c.selected === false;
      });
      if (rest.length) onEdgesChange(rest);
    },
    [onEdgesChange],
  );

  const onCutMoveRegion = useCallback((rect: FlowRect) => {
    const result = applyCutMove(nodesRef.current, edgesRef.current, rect, newId);
    if (!result.didCut && !result.moveIds.length) return;
    pushHistory();
    setNodes(result.nodes);
    setEdges(result.edges);
  }, [setNodes, setEdges, pushHistory]);

  /** Box-select real parts in a rectangle (Ctrl/⌘ = add to selection). */
  const onSelectRegion = useCallback(
    (rect: FlowRect, additive: boolean) => {
      const ns = nodesRef.current;
      const es = edgesRef.current;
      const hit = new Set(
        nodesInRect(ns, rect).filter((id) => {
          const n = ns.find((x) => x.id === id);
          return Boolean(n && n.data.kind !== "TIP");
        }),
      );
      const tipHits = nodesInRect(ns, rect).filter((id) => {
        const n = ns.find((x) => x.id === id);
        return n?.data.kind === "TIP";
      });
      // Same coverage idea as Move/Drag / copy-marquee: include wires in the box.
      const coveredEdges = new Set(edgesCoveredByRect(ns, es, rect, 0.7));
      const endpointOk = new Set([...hit, ...tipHits]);
      for (const e of es) {
        if (endpointOk.has(e.source) && endpointOk.has(e.target)) coveredEdges.add(e.id);
      }

      if (!hit.size && !coveredEdges.size && !additive) {
        setNodes((cur) => cur.map((n) => (n.selected ? { ...n, selected: false } : n)));
        setEdges((cur) =>
          cur.map((e) => {
            if (!e.selected && (e.data as SchematicWireData | undefined)?.selectedSegIndex == null) {
              return e;
            }
            const data = { ...(e.data as object) } as SchematicWireData;
            delete data.selectedSegIndex;
            return { ...e, selected: false, data };
          }),
        );
        return;
      }
      if (!hit.size && !coveredEdges.size) return;

      lastWireClickRef.current = null;
      setNodes((cur) =>
        cur.map((n) => {
          if (n.data.kind === "TIP") {
            const next = tipHits.includes(n.id) || (additive && n.selected);
            return n.selected === next ? n : { ...n, selected: next };
          }
          const next = hit.has(n.id) || (additive && n.selected);
          return n.selected === next ? n : { ...n, selected: next };
        }),
      );
      // Marquee = whole wires (no segment highlight).
      setEdges((cur) =>
        cur.map((e) => {
          const next = coveredEdges.has(e.id) || (additive && e.selected);
          const data = { ...(e.data as object) } as SchematicWireData;
          delete data.selectedSegIndex;
          if (e.selected === next && (e.data as SchematicWireData | undefined)?.selectedSegIndex == null) {
            return e;
          }
          return { ...e, selected: next, data };
        }),
      );
    },
    [setNodes, setEdges],
  );

  /**
   * Pickup for Move / Drag tools.
   * - Drag (default connected): keep electrical edges attached; long free TIP wires ride along.
   * - Move (`detach: true`): sever wires first, then translate the part alone.
   */
  const onMoveDisconnect = useCallback(
    (
      nodeId: string,
      grabPoint?: { x: number; y: number },
      opts?: { additive?: boolean; detach?: boolean },
    ) => {
      let nodesNow = nodesRef.current;
      let edgesNow = edgesRef.current;
      const detach =
        Boolean(opts?.detach) ||
        // Labels name a net; they must not rubber-band wires when relocated.
        nodesNow.find((n) => n.id === nodeId)?.data.kind === "WIRELABEL";

      // Multi-select: move the whole selected group of real parts together.
      let selectedParts = nodesNow.filter(
        (n) => n.selected && n.data.kind !== "TIP",
      );
      const clicked = nodesNow.find((n) => n.id === nodeId);
      if (opts?.additive && clicked && !clicked.selected && clicked.data.kind !== "TIP") {
        selectedParts = [...selectedParts, clicked];
        setNodes((ns) =>
          ns.map((n) => (n.id === nodeId ? { ...n, selected: true } : n)),
        );
      }

      // --- Move tool: always disconnect, then move part(s) alone --------------
      if (detach) {
        connectedMoveRef.current = false;
        const ids =
          selectedParts.length > 1 && selectedParts.some((n) => n.id === nodeId)
            ? selectedParts.map((n) => n.id)
            : [nodeId];
        const before = snapshot();
        let ns = nodesNow;
        let es = edgesNow;
        let cutCount = 0;
        let moveIds: string[] = [];
        for (const id of ids) {
          const result = detachPartForMove(
            ns,
            es,
            id,
            newId,
            id === nodeId ? grabPoint : undefined,
          );
          ns = result.nodes;
          es = result.edges;
          cutCount += result.cutCount;
          moveIds = [...new Set([...moveIds, ...result.moveIds])];
        }
        const pruned = pruneOrphanTips(ns, es);
        moveSeverGuard.current = { nodeId, at: Date.now() };
        if (cutCount > 0 && !dragOrigin.current) dragOrigin.current = before;
        flushSync(() => {
          setNodes(pruned.nodes);
          setEdges(pruned.edges);
        });
        const idSet = new Set(moveIds);
        return {
          moveIds,
          origins: pruned.nodes
            .filter((n) => idSet.has(n.id))
            .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })),
          cutCount,
        };
      }

      // --- Drag tool: keep wires connected -----------------------------------
      // T-spliced pins (both rail halves on one pin) rubber-band into a U —
      // lift those tees onto a junction tip before the drag.
      const moveGroupIds =
        selectedParts.length > 1 && selectedParts.some((n) => n.id === nodeId)
          ? selectedParts.map((n) => n.id)
          : [nodeId];
      {
        const lifted = promoteInlinePinTees(
          nodesNow,
          edgesNow,
          moveGroupIds,
          newId,
        );
        if (lifted.promoted > 0) {
          nodesNow = lifted.nodes;
          edgesNow = lifted.edges;
          nodesRef.current = lifted.nodes;
          edgesRef.current = lifted.edges;
          flushSync(() => {
            setNodes(lifted.nodes);
            setEdges(lifted.edges);
          });
        }
      }

      if (
        selectedParts.length > 1 &&
        selectedParts.some((n) => n.id === nodeId)
      ) {
        connectedMoveRef.current = true;
        const moveIds = selectedParts.map((n) => n.id);
        const idSet = new Set(moveIds);
        return {
          moveIds,
          origins: nodesNow
            .filter((n) => idSet.has(n.id))
            .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })),
          cutCount: 0,
        };
      }

      // Keep wires connected during the drag (TIP re-route / waypoint clear).
      const plan = planConnectedPartMove(nodesNow, edgesNow, nodeId);
      if (plan) {
        connectedMoveRef.current = true;
        const dropTips = new Set(plan.dropStubTipIds);
        const dropEdges = new Set(plan.dropStubEdgeIds);
        const clearSet = new Set(plan.clearWaypointEdgeIds);
        const needsGraphSync =
          dropTips.size > 0 || dropEdges.size > 0 || clearSet.size > 0;
        if (needsGraphSync) {
          const nextNodes = dropTips.size
            ? nodesNow.filter((n) => !dropTips.has(n.id))
            : nodesNow;
          const nextEdges = edgesNow
            .filter((e) => !dropEdges.has(e.id))
            .map((e) =>
              clearSet.has(e.id)
                ? {
                    ...e,
                    data: {
                      ...(e.data as object),
                      waypoints: [],
                      directPath: true,
                    },
                  }
                : e,
            );
          edgesNow = nextEdges;
          flushSync(() => {
            if (dropTips.size) setNodes(nextNodes);
            setEdges(nextEdges);
          });
          const idSet = new Set(plan.moveIds);
          const partOrigin = nextNodes.find((n) => n.id === nodeId);
          const tipOrigins = nextNodes
            .filter((n) => idSet.has(n.id) && n.id !== nodeId)
            .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
          if (!partOrigin) return null;
          return {
            moveIds: plan.moveIds,
            origins: [
              { id: nodeId, x: partOrigin.position.x, y: partOrigin.position.y },
              ...tipOrigins,
            ],
            cutCount: 0,
          };
        }
        const idSet = new Set(plan.moveIds);
        const partOrigin = nodesNow.find((n) => n.id === nodeId);
        const tipOrigins = nodesNow
          .filter((n) => idSet.has(n.id) && n.id !== nodeId)
          .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
        if (!partOrigin) return null;
        return {
          moveIds: plan.moveIds,
          origins: [
            { id: nodeId, x: partOrigin.position.x, y: partOrigin.position.y },
            ...tipOrigins,
          ],
          cutCount: 0,
        };
      }

      // Disconnected / fresh part — Drag still translates without severing.
      connectedMoveRef.current = true;
      const partOrigin = nodesNow.find((n) => n.id === nodeId);
      if (!partOrigin) return null;
      return {
        moveIds: [nodeId],
        origins: [
          { id: nodeId, x: partOrigin.position.x, y: partOrigin.position.y },
        ],
        cutCount: 0,
      };
    },
    [snapshot, setNodes, setEdges],
  );

  const rotateSelected = useCallback(() => {
    const nodesNow = nodesRef.current;
    const edgesNow = edgesRef.current;
    const sel = nodesNow.filter((n) => n.selected && n.data.kind !== "TIP");
    if (!sel.length) return;
    // Same path as Properties → Rotate (one part at a time so wires stay clean).
    pushHistory();
    let ns = nodesNow;
    let es = edgesNow;
    for (const part of sel) {
      const finalized = finalizePartRotate(ns, es, new Set([part.id]));
      ns = finalized.nodes;
      es = finalized.edges;
      // Sibling pins may still sit mid-rail after rotate — attach them.
      const attached = attachPartsToWires(ns, es, [part.id]);
      if (attached.attached) {
        ns = attached.nodes;
        es = attached.edges;
      }
    }
    // Tips left sitting on pins draw open squares — absorb into the pin.
    const absorbed = absorbTipsOntoPins(ns, es);
    ns = absorbed.nodes;
    es = absorbed.edges;
    const ghosts = pruneGhostTipsOnPins(ns, es);
    ns = ghosts.nodes;
    es = ghosts.edges;
    nodesRef.current = ns;
    edgesRef.current = es;
    flushSync(() => {
      setNodes(ns);
      setEdges(es);
    });
  }, [setNodes, setEdges, pushHistory]);


  /** Palette click: enter stamp tool (toggle off if same kind). Wire label asks for a name first. */
  const pickPlaceKind = useCallback((kind: ComponentKind) => {
    setPasteClip(null);
    setCopyMarquee(false);
    if (kind === "WIRELABEL") {
      setPlaceKind(null);
      setPlaceParams(null);
      setNetNameDialog(true);
      return;
    }
    setPlaceParams(null);
    setPlaceKind((cur) => (cur === kind ? null : kind));
  }, []);

  const cancelPlace = useCallback(() => {
    setPlaceKind(null);
    setPlaceParams(null);
    setPasteClip(null);
    setCopyMarquee(false);
  }, []);

  const beginCopyMarquee = useCallback(() => {
    setPlaceKind(null);
    setPlaceParams(null);
    setPasteClip(null);
    // Fresh copy-tool selection (highlight builds while in this mode).
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
    setCopyMarquee(true);
  }, [setNodes, setEdges]);

  const cancelCopyMarquee = useCallback(() => {
    setCopyMarquee(false);
  }, []);

  const beginWireLabelStamp = useCallback((name: string) => {
    lastWireLabelName.current = name;
    setPasteClip(null);
    setCopyMarquee(false);
    setPlaceParams({ name });
    setPlaceKind("WIRELABEL");
    setNetNameDialog(false);
  }, []);

  const addComponentAt = useCallback((kind: ComponentKind, x: number, y: number, rotation: ComponentRotation = 0) => {
    pushHistory();
    const id = newId();
    const alloc = makeAllocator(nodesRef.current);
    const extra =
      kind === "WIRELABEL" && placeParams
        ? placeParams
        : undefined;
    const placed = mk(id, kind, alloc(kind), x, y, rotation, extra);
    let nextNodes = [...nodesRef.current, placed];
    let nextEdges = edgesRef.current;
    const attached = attachPartsToWires(nextNodes, nextEdges, [id]);
    if (attached.attached) {
      // Do not run normalizeWires here — it rewrites waypoints and puts 16px
      // pin stubs back on a rail we just split (the stair-step "break").
      const absorbed = absorbTipsOntoPins(attached.nodes, attached.edges);
      nodesRef.current = absorbed.nodes;
      edgesRef.current = absorbed.edges;
      setNodes(absorbed.nodes);
      setEdges(absorbed.edges);
      noteCommonlyUsed(kind);
      return;
    }
    if (kind === "WIRELABEL") {
      const onPin = attachNetNameToNearestPin(nextNodes, nextEdges, id);
      if (onPin.attached) {
        nodesRef.current = onPin.nodes;
        edgesRef.current = onPin.edges;
        setNodes(onPin.nodes);
        setEdges(onPin.edges);
        noteCommonlyUsed(kind);
        return;
      }
    }
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    noteCommonlyUsed(kind);
  }, [setNodes, setEdges, pushHistory, placeParams, noteCommonlyUsed]);

  const setCanvasModeAndClearPlace = useCallback((mode: CanvasMode) => {
    setPlaceKind(null);
    setPlaceParams(null);
    setPasteClip(null);
    setCopyMarquee(false);
    setCanvasMode(mode);
  }, []);

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
    noteCommonlyUsed(kind);
  }, [setNodes, setEdges, pushHistory, noteCommonlyUsed]);

  /**
   * DC voltage ↔ Pulse generator in place: same node id, refdes, wires, rotation.
   * Properties dialog Mode radio — does not mint a new Vn.
   */
  const convertVoltageSourceMode = useCallback(
    (
      nodeId: string,
      mode: "DC" | "Pulse",
      draft?: { params?: Record<string, string>; refdes?: string },
    ) => {
      const nextKind: ComponentKind = mode === "Pulse" ? "VPULSE" : "BATTERY";
      const target = nodesRef.current.find((n) => n.id === nodeId);
      if (!target) return;
      if (target.data.kind === nextKind) return;
      if (target.data.kind !== "BATTERY" && target.data.kind !== "VPULSE") return;
      pushHistory();
      const prev = { ...target.data.params, ...(draft?.params ?? {}) };
      const params = { ...defaultParams(nextKind) };
      if (nextKind === "VPULSE") {
        const dc = (prev.dc ?? "").trim();
        params.vinitial = (prev.vinitial ?? "").trim() || "0";
        params.von = (prev.von ?? "").trim() || dc || params.von || "V";
        for (const k of ["tdelay", "trise", "tfall", "ton", "tperiod"] as const) {
          if ((prev[k] ?? "").trim()) params[k] = prev[k]!;
        }
      } else {
        const von = (prev.von ?? "").trim();
        params.dc = (prev.dc ?? "").trim() || von || params.dc || "V";
        if ((prev.rser ?? "").trim()) params.rser = prev.rser!;
      }
      const refdes =
        (draft?.refdes ?? "").trim() || target.data.refdes;
      setNodes((ns) =>
        ns.map((n) =>
          n.id !== nodeId
            ? n
            : {
                ...n,
                data: {
                  ...n.data,
                  kind: nextKind,
                  refdes,
                  params,
                },
              },
        ),
      );
      noteCommonlyUsed(nextKind);
    },
    [setNodes, pushHistory, noteCommonlyUsed],
  );

  const openComponentProps = useCallback(
    (nodeId: string, x: number, y: number) => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node || node.data.kind === "TIP") return;
      setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === nodeId })));
      setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
      setPropsDialog({ nodeId, x, y });
    },
    [setNodes, setEdges],
  );

  const applyComponentProps = useCallback(
    (nodeId: string, draft: ComponentPropsDraft) => {
      pushHistory();
      const target = nodesRef.current.find((n) => n.id === nodeId);
      const nextParams = target
        ? { ...target.data.params, ...draft.params }
        : { ...draft.params };
      const kind = target?.data.kind;
      const pinIds =
        kind != null
          ? new Set(getComponentPins(kind, nextParams).map((p) => p.id))
          : null;
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== nodeId) return n;
          return {
            ...n,
            data: {
              ...n.data,
              refdes: draft.refdes,
              params: nextParams,
              labelPos: draft.labelPos === "auto" ? undefined : draft.labelPos,
              rotation: normalizeRotation(draft.rotation),
            },
          };
        }),
      );
      if (pinIds) {
        setEdges((es) =>
          es.filter((e) => {
            if (e.source === nodeId && e.sourceHandle && !pinIds.has(e.sourceHandle)) return false;
            if (e.target === nodeId && e.targetHandle && !pinIds.has(e.targetHandle)) return false;
            return true;
          }),
        );
      }
      setPropsDialog(null);
    },
    [setNodes, setEdges, pushHistory],
  );

  const rotateNodeLive = useCallback(
    (nodeId: string) => {
      const nodesNow = nodesRef.current;
      const edgesNow = edgesRef.current;
      const target = nodesNow.find((n) => n.id === nodeId && n.data.kind !== "TIP");
      if (!target) return;
      pushHistory();
      const moved = new Set([nodeId]);
      const finalized = finalizePartRotate(nodesNow, edgesNow, moved);
      let ns = finalized.nodes;
      let es = finalized.edges;
      const attached = attachPartsToWires(ns, es, [nodeId]);
      if (attached.attached) {
        ns = attached.nodes;
        es = attached.edges;
      }
      const absorbed = absorbTipsOntoPins(ns, es);
      ns = absorbed.nodes;
      es = absorbed.edges;
      const ghosts = pruneGhostTipsOnPins(ns, es);
      ns = ghosts.nodes;
      es = ghosts.edges;
      nodesRef.current = ns;
      edgesRef.current = es;
      flushSync(() => {
        setNodes(ns);
        setEdges(es);
      });
    },
    [setNodes, setEdges, pushHistory],
  );

  const deleteNodes = useCallback((ids: string[]) => {
    if (!ids.length) return;
    pushHistory();
    const idSet = new Set(ids);
    const nextNodes = nodesRef.current.filter((n) => !idSet.has(n.id));
    const nextEdges = edgesRef.current.filter(
      (e) => !idSet.has(e.source) && !idSet.has(e.target),
    );
    const pruned = pruneOrphanTips(nextNodes, nextEdges);
    const collapsed = collapsePassThroughTips(pruned.nodes, pruned.edges);
    setNodes(collapsed.nodes);
    setEdges(collapsed.edges);
  }, [setNodes, setEdges, pushHistory]);

  /** Delete selected parts/wires, or toggle scissors when nothing is selected. */
  const deleteSelectionOrToggleScissors = useCallback(() => {
    const nodesNow = nodesRef.current;
    const edgesNow = edgesRef.current;
    const selectedNodeIds = nodesNow.filter((n) => n.selected).map((n) => n.id);
    const selectedEdgeIds = edgesNow.filter((e) => e.selected).map((e) => e.id);
    if (!selectedNodeIds.length && !selectedEdgeIds.length) {
      setPlaceKind(null);
      setPlaceParams(null);
      setPasteClip(null);
      setCopyMarquee(false);
      setCanvasMode("delete");
      return;
    }

    // Free-wire snakes are one edge. Delete on a tip/spur must trim that stub —
    // not wipe the whole orange path the user thought was "one small wire".
    const selectedTips = nodesNow.filter(
      (n) => n.selected && n.data.kind === "TIP",
    );
    if (
      selectedTips.length === 1 &&
      selectedNodeIds.every((id) => selectedTips.some((t) => t.id === id))
    ) {
      const tip = selectedTips[0]!;
      const tipEdge =
        edgesNow.find(
          (e) =>
            (selectedEdgeIds.length === 0 || selectedEdgeIds.includes(e.id)) &&
            (e.source === tip.id || e.target === tip.id),
        ) ?? edgesNow.find((e) => e.source === tip.id || e.target === tip.id);
      if (tipEdge) {
        const tipPt = pinWorldPoint(tip, "t") ?? {
          x: tip.position.x,
          y: tip.position.y + 4,
        };
        deleteEdgeWithToolRef.current(tipEdge.id, tipPt);
        return;
      }
    }

    if (selectedEdgeIds.length === 1 && selectedNodeIds.length === 0) {
      const edgeId = selectedEdgeIds[0]!;
      const edge = edgesNow.find((e) => e.id === edgeId);
      const segIdx = (edge?.data as SchematicWireData | undefined)?.selectedSegIndex;
      if (edge && typeof segIdx === "number") {
        // Exact segment index — never wipe the whole free-wire snake.
        const plan = planDeleteSelectedSegment(nodesNow, edgesNow, edgeId, segIdx);
        if (plan) {
          deleteEdgeWithToolRef.current(edgeId, undefined, plan);
          return;
        }
      }
      const click =
        lastWireClickRef.current?.edgeId === edgeId
          ? lastWireClickRef.current.point
          : undefined;
      if (edge && click) {
        deleteEdgeWithToolRef.current(edgeId, click);
        return;
      }
      // Whole-edge selection (marquee / no segment): delete that one edge only.
    }

    pushHistory();
    const dropNodes = new Set(selectedNodeIds);
    const dropEdges = new Set(selectedEdgeIds);
    const nextNodes = nodesNow.filter((n) => !dropNodes.has(n.id));
    const nextEdges = edgesNow.filter(
      (e) =>
        !dropEdges.has(e.id) &&
        !dropNodes.has(e.source) &&
        !dropNodes.has(e.target),
    );
    const pruned = pruneOrphanTips(nextNodes, nextEdges);
    const collapsed = collapsePassThroughTips(pruned.nodes, pruned.edges);
    setNodes(collapsed.nodes);
    setEdges(collapsed.edges);
  }, [pushHistory, setNodes, setEdges]);

  const deleteNodeWithTool = useCallback((nodeId: string) => {
    const nodesNow = nodesRef.current;
    const node = nodesNow.find((n) => n.id === nodeId);
    if (!node) return;

    // TIP on a long free wire: scissors at the tip (trim stub), never drop the rail.
    if (node.data.kind === "TIP") {
      const tipEdge = edgesRef.current.find(
        (e) => e.source === nodeId || e.target === nodeId,
      );
      if (tipEdge) {
        const tipPt = pinWorldPoint(node, "t") ?? {
          x: node.position.x,
          y: node.position.y + 4,
        };
        deleteEdgeWithToolRef.current(tipEdge.id, tipPt);
        return;
      }
    }

    pushHistory();
    const nextNodes = nodesNow.filter((n) => n.id !== nodeId);
    const nextEdges = edgesRef.current.filter(
      (edge) => edge.source !== nodeId && edge.target !== nodeId,
    );
    const pruned = pruneOrphanTips(nextNodes, nextEdges);
    const collapsed = collapsePassThroughTips(pruned.nodes, pruned.edges);
    setNodes(collapsed.nodes);
    setEdges(collapsed.edges);
  }, [setNodes, setEdges, pushHistory]);

  const deleteEdgeWithTool = useCallback((
    edgeId: string,
    clickPoint?: Point,
    forcedPlan?: ScissorDeletePlan,
  ) => {
    const edgesNow = edgesRef.current;
    const nodesNow = nodesRef.current;
    if (!edgesNow.some((edge) => edge.id === edgeId)) return;

    let plan =
      forcedPlan ?? planScissorWireDelete(nodesNow, edgesNow, edgeId, clickPoint);
    // Scissors on a normal rail (e.g. pin↔pin): trim logic may refuse; still
    // delete the clicked wire instead of silently no-op + leaving it selected.
    if (!plan) {
      plan = { action: "delete", edgeId };
    }

    if (plan.action === "trimTip") {
      const clicked = edgesNow.find((edge) => edge.id === plan.edgeId);
      if (!clicked) return;
      pushHistory();
      const tipNode = nodesNow.find((n) => n.id === plan.tipId);
      const nextNodes =
        tipNode?.data.kind === "TIP"
          ? nodesNow.map((node) =>
              node.id === plan.tipId
                ? { ...node, position: plan.tipPosition }
                : node,
            )
          : nodesNow;
      // Pin↔pin tip peels: store the exact remaining path so pin-exit stubs
      // do not regenerate. Tip wires keep the usual waypoint encoding.
      const nextWaypoints = plan.directPath
        ? plan.trimmedPoly.length <= 2
          ? []
          : plan.trimmedPoly.slice(1, -1)
        : polylineToStoredWaypoints(nextNodes, clicked, plan.trimmedPoly);
      const nextEdges = edgesNow.map((edge) =>
        edge.id === plan.edgeId
          ? {
              ...edge,
              data: {
                ...(edge.data as object),
                waypoints: nextWaypoints,
                ...(plan.directPath ? { directPath: true } : {}),
              },
            }
          : edge,
      );
      setNodes(nextNodes);
      setEdges(nextEdges);
      return;
    }

    if (plan.action === "peelToNewTip") {
      const clicked = edgesNow.find((edge) => edge.id === plan.edgeId);
      if (!clicked) return;
      pushHistory();
      const tipId = newId();
      const TIP_SIZE = 8;
      const newTip = {
        id: tipId,
        type: "component" as const,
        position: plan.newTipPosition,
        data: { kind: "TIP" as const, refdes: "", params: {} },
        style: { width: TIP_SIZE, height: TIP_SIZE },
      };
      const nextNodes = [...nodesNow, newTip];
      const rewired = {
        ...clicked,
        source: plan.atStart ? tipId : clicked.source,
        target: plan.atStart ? clicked.target : tipId,
        sourceHandle: plan.atStart ? "t" : clicked.sourceHandle,
        targetHandle: plan.atStart ? clicked.targetHandle : "t",
      };
      const nextWaypoints = polylineToStoredWaypoints(
        nextNodes,
        rewired,
        plan.trimmedPoly,
      );
      const nextEdges = edgesNow.map((edge) =>
        edge.id === plan.edgeId
          ? {
              ...rewired,
              data: { ...(edge.data as object), waypoints: nextWaypoints },
            }
          : edge,
      );
      const pruned = pruneOrphanTips(nextNodes, nextEdges);
      setNodes(pruned.nodes);
      setEdges(pruned.edges);
      return;
    }

    if (plan.action === "cutOpen") {
      const clicked = edgesNow.find((edge) => edge.id === plan.edgeId);
      if (!clicked) return;
      pushHistory();
      const TIP_SIZE = 8;
      const tipAt = (pt: Point) => ({
        x: pt.x,
        y: pt.y - TIP_SIZE / 2,
      });
      const interior = (poly: Point[]) =>
        poly.length <= 2 ? [] : poly.slice(1, -1);

      let nextNodes = [...nodesNow];
      const nextEdges = edgesNow.filter((edge) => edge.id !== plan.edgeId);
      const added: Edge[] = [];

      if (plan.beforePoly) {
        const end = plan.beforePoly[plan.beforePoly.length - 1]!;
        const tipId = newId();
        nextNodes.push({
          id: tipId,
          type: "component" as const,
          position: tipAt(end),
          data: { kind: "TIP" as const, refdes: "", params: {} },
          style: { width: TIP_SIZE, height: TIP_SIZE },
          selected: false,
          draggable: false,
        });
        added.push({
          ...clicked,
          id: `${clicked.source}${clicked.sourceHandle ?? ""}-${tipId}t`,
          target: tipId,
          targetHandle: "t",
          data: {
            waypoints: interior(plan.beforePoly),
            directPath: true,
          },
          selected: false,
        });
      }

      if (plan.afterPoly) {
        const start = plan.afterPoly[0]!;
        const tipId = newId();
        nextNodes.push({
          id: tipId,
          type: "component" as const,
          position: tipAt(start),
          data: { kind: "TIP" as const, refdes: "", params: {} },
          style: { width: TIP_SIZE, height: TIP_SIZE },
          selected: false,
          draggable: false,
        });
        added.push({
          ...clicked,
          id: `${tipId}t-${clicked.target}${clicked.targetHandle ?? ""}`,
          source: tipId,
          sourceHandle: "t",
          data: {
            waypoints: interior(plan.afterPoly),
            directPath: true,
          },
          selected: false,
        });
      }

      const pruned = pruneOrphanTips(nextNodes, [...nextEdges, ...added]);
      const collapsed = collapsePassThroughTips(pruned.nodes, pruned.edges);
      setNodes(collapsed.nodes);
      setEdges(collapsed.edges);
      return;
    }

    pushHistory();
    const nextEdges = edgesNow.filter((edge) => edge.id !== plan.edgeId);
    const pruned = pruneOrphanTips(nodesNow, nextEdges);
    const collapsed = collapsePassThroughTips(pruned.nodes, pruned.edges);
    setNodes(collapsed.nodes);
    setEdges(collapsed.edges);
  }, [setNodes, setEdges, pushHistory]);
  deleteEdgeWithToolRef.current = deleteEdgeWithTool;

  /** Delete-mode scissors on a junction square or crossing ring. */
  const deleteWireMarkWithTool = useCallback(
    (
      kind: "junction" | "crossing",
      point: Point,
      meta?: { tipId?: string; edgeIds?: [string, string] },
    ) => {
      const nodesNow = nodesRef.current;
      const edgesNow = edgesRef.current;

      if (kind === "junction") {
        let tipId = meta?.tipId;
        if (!tipId) {
          let best: { id: string; d: number } | null = null;
          const deg = new Map<string, number>();
          for (const e of edgesNow) {
            deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
            deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
          }
          for (const n of nodesNow) {
            if (n.data.kind !== "TIP") continue;
            if ((deg.get(n.id) ?? 0) < 2) continue;
            const pt = pinWorldPoint(n, "t");
            if (!pt) continue;
            const d = Math.hypot(pt.x - point.x, pt.y - point.y);
            if (d <= 14 && (!best || d < best.d)) best = { id: n.id, d };
          }
          tipId = best?.id;
        }
        if (!tipId) return; // Square with no shared tip — don't delete rails.
        const dissolved = dissolveJunctionTip(nodesNow, edgesNow, tipId, newId);
        if (!dissolved) return;
        pushHistory();
        const pruned = pruneOrphanTips(dissolved.nodes, dissolved.edges);
        setNodes(pruned.nodes);
        setEdges(pruned.edges);
        return;
      }

      // Crossing hop: if either rail is a short free stub, delete that stub.
      // Otherwise only hide the visual hop (wires stay).
      setHiddenCrossingKeys((prev) => {
        const k = wireMarkKey(point);
        return prev.includes(k) ? prev : [...prev, k];
      });
      const ids = meta?.edgeIds;
      if (ids?.length) {
        const stub = ids
          .map((id) => edgesNow.find((e) => e.id === id))
          .filter((e): e is Edge => Boolean(e))
          .find(
            (e) =>
              isShortDanglingStub(nodesNow, edgesNow, e, 96) ||
              isFullyDanglingLeftover(nodesNow, edgesNow, e, 96),
          );
        if (stub) {
          deleteEdgeWithToolRef.current(stub.id, point);
          return;
        }
      }
    },
    [setNodes, setEdges, pushHistory],
  );

  const straightenEdge = useCallback((edgeId: string, clickPoint?: Point) => {
    let nodesNow = nodesRef.current;
    let edgesNow = edgesRef.current;
    let edge = edgesNow.find((candidate) => candidate.id === edgeId);
    if (!edge) return;

    // Mid-wire splice tips (R—TIP—C) draw a filled junction square. Merge them
    // into one pin↔pin edge first so double-click can near-align the parts.
    const healed = collapsePassThroughTips(nodesNow, edgesNow);
    if (healed.merged > 0) {
      nodesNow = healed.nodes;
      edgesNow = healed.edges;
      const stillThere = edgesNow.find((candidate) => candidate.id === edgeId);
      if (stillThere) {
        edge = stillThere;
      } else {
        // Old half-edge was removed; pick the merged rail under the click.
        const hit = clickPoint
          ? edgesNow
              .map((candidate) => {
                const poly = computeEdgePolyline(nodesNow, candidate);
                return { candidate, d: distToPolyline(poly, clickPoint) };
              })
              .sort((a, b) => a.d - b.d)[0]
          : null;
        edge = hit && hit.d < 24 ? hit.candidate : edgesNow[edgesNow.length - 1];
      }
      if (!edge) return;
    }

    const result = straightenWire(nodesNow, edge, clickPoint, edgesNow);
    if (!result) return;

    pushHistory();
    let nextNodes = nodesNow;
    const movedPartIds = new Set<string>();
    if (result.tipMoves?.length) {
      const byId = new Map(result.tipMoves.map((m) => [m.id, m]));
      nextNodes = nodesNow.map((node) => {
        const move = byId.get(node.id);
        if (!move) return node;
        if (node.data.kind !== "TIP") movedPartIds.add(node.id);
        return { ...node, position: { x: move.x, y: move.y } };
      });
    }

    let nextEdges: Edge[] = edgesNow.map((candidate) =>
      candidate.id === edge!.id
        ? {
            ...candidate,
            data: {
              ...(candidate.data as object),
              waypoints: result.waypoints,
              selectedSegIndex: undefined,
            },
            selected: false,
          }
        : {
            ...candidate,
            selected: false,
            data: (() => {
              const data = { ...(candidate.data as object) } as SchematicWireData;
              delete data.selectedSegIndex;
              return data;
            })(),
          },
    );

    // Part nudge to kill a 1–2 grid stair: re-route every wire on that part.
    if (movedPartIds.size) {
      const finalized = finalizeConnectedPartMove(nextNodes, nextEdges, movedPartIds);
      nextNodes = finalized.nodes;
      nextEdges = finalized.edges.map((candidate) =>
        candidate.id === edge!.id
          ? {
              ...candidate,
              selected: false,
              data: (() => {
                const data = { ...(candidate.data as object) } as SchematicWireData;
                delete data.selectedSegIndex;
                return data;
              })(),
            }
          : candidate,
      );
    }

    // Drop tiny dangling stubs that share a pin with this wire (leftover nubs
    // after a part move often sit on the same pin as the real connection).
    const pinKeys = new Set(
      [
        `${edge.source}:${edge.sourceHandle ?? ""}`,
        `${edge.target}:${edge.targetHandle ?? ""}`,
      ].filter((k) => !k.endsWith(":")),
    );
    const stubIds = nextEdges
      .filter(
        (candidate) =>
          candidate.id !== edge!.id &&
          isShortDanglingStub(nextNodes, nextEdges, candidate) &&
          (pinKeys.has(`${candidate.source}:${candidate.sourceHandle ?? ""}`) ||
            pinKeys.has(`${candidate.target}:${candidate.targetHandle ?? ""}`)),
      )
      .map((candidate) => candidate.id);
    if (stubIds.length) {
      const pruned = removeDanglingOrTrailingEdges(nextNodes, nextEdges, {
        onlyEdgeIds: stubIds,
      });
      nextNodes = pruned.nodes;
      nextEdges = pruned.edges;
    }

    // Degree-2 tips that became collinear after the tip slide should collapse.
    const collapsed = collapsePassThroughTips(nextNodes, nextEdges);
    nextNodes = collapsed.nodes;
    const keepId = edge.id;
    nextEdges = collapsed.edges.map((candidate) =>
      candidate.id === keepId ? { ...candidate, selected: true } : candidate,
    );

    // Final pass: if the (possibly merged) pin↔pin run is still a tiny stair,
    // nudge again now that splice tips are gone.
    const focused =
      nextEdges.find((candidate) => candidate.selected) ??
      nextEdges.find((candidate) => candidate.id === keepId);
    if (focused) {
      const align = planNearAlignPartNudge(nextNodes, nextEdges, focused, {
        clickPoint,
      });
      if (align) {
        nextNodes = nextNodes.map((node) =>
          node.id === align.id
            ? { ...node, position: { x: align.x, y: align.y } }
            : node,
        );
        const finalized = finalizeConnectedPartMove(
          nextNodes,
          nextEdges.map((candidate) =>
            candidate.id === focused.id
              ? {
                  ...candidate,
                  data: { ...(candidate.data as object), waypoints: [] },
                  selected: true,
                }
              : candidate,
          ),
          new Set([align.id]),
        );
        nextNodes = finalized.nodes;
        nextEdges = finalized.edges.map((candidate) =>
          candidate.id === focused.id ||
          (candidate.source === focused.source &&
            candidate.target === focused.target)
            ? { ...candidate, selected: true }
            : candidate,
        );
      }
    }

    setNodes(nextNodes);
    setEdges(nextEdges);
  }, [setNodes, setEdges, pushHistory]);

  /**
   * After Move drop: tip↔pin reconnect (incl. multi-tip GND T restore), then
   * 1-pin mid-rail splice for GND placed onto a continuous wire.
   */
  const reconnectDroppedParts = useCallback(
    (placed: { id: string; position: { x: number; y: number } }[]) => {
      if (!placed.length) return;
      const posById = new Map(placed.map((p) => [p.id, p.position]));
      const movedIds = [...posById.keys()];
      const withPositions = nodesRef.current.map((n) => {
        if (!posById.has(n.id)) return n;
        const { internals, ...rest } = n as Node<ComponentData> & {
          internals?: unknown;
        };
        void internals;
        return { ...rest, position: posById.get(n.id)! };
      });

      const partRec = reconnectPartsOnTips(
        withPositions,
        edgesRef.current,
        movedIds,
      );
      let ns = partRec.reconnected ? partRec.nodes : withPositions;
      let es = partRec.reconnected ? partRec.edges : edgesRef.current;

      const tipRec = reconnectTipsOnPins(ns, es, movedIds);
      if (tipRec.reconnected) {
        ns = tipRec.nodes;
        es = tipRec.edges;
      }

      // Free pins landing on rails → per-pin T (or series insert above).
      const attached = attachPartsToWires(ns, es, movedIds);
      if (attached.attached) {
        ns = attached.nodes;
        es = attached.edges;
      }

      // Labels dropped on a device pin (not mid-wire).
      let labelPinned = 0;
      for (const id of movedIds) {
        if (ns.find((n) => n.id === id)?.data.kind !== "WIRELABEL") continue;
        const onPin = attachNetNameToNearestPin(ns, es, id);
        if (onPin.attached) {
          ns = onPin.nodes;
          es = onPin.edges;
          labelPinned++;
        }
      }

      // Tips parked on pins (look like open pin squares) → absorb / drop.
      const absorbed = absorbTipsOntoPins(ns, es);
      ns = absorbed.nodes;
      es = absorbed.edges;

      // Ghost free tips sitting on pins that already have a real wire (GND □).
      // Runs after multi-tip reconnect so the second T stub isn't deleted.
      const ghosts = pruneGhostTipsOnPins(ns, es);
      ns = ghosts.nodes;
      es = ghosts.edges;

      // Ensure rejoined edges don't keep frozen tip-path doglegs.
      if (partRec.reconnected || tipRec.reconnected) {
        const touched = new Set(movedIds);
        es = es.map((e) => {
          if (!touched.has(e.source) && !touched.has(e.target)) return e;
          const wps =
            ((e.data as { waypoints?: unknown[] } | undefined)?.waypoints) ?? [];
          if (!wps.length && !(e.data as { directPath?: boolean } | undefined)?.directPath) {
            return e;
          }
          return {
            ...e,
            data: { ...(e.data as object), waypoints: [], directPath: false },
          };
        });
      }

      const collapsed = collapsePassThroughTips(ns, es);
      const pruned = pruneOrphanTips(collapsed.nodes, collapsed.edges);
      ns = pruned.nodes;
      es = pruned.edges;

      const changed =
        partRec.reconnected ||
        tipRec.reconnected ||
        attached.attached > 0 ||
        labelPinned > 0 ||
        absorbed.changed > 0 ||
        ghosts.removed > 0 ||
        collapsed.merged > 0;

      nodesRef.current = ns;
      edgesRef.current = es;
      if (!changed) {
        // Still commit dropped positions.
        setNodes(ns);
        return;
      }
      setNodes(ns);
      setEdges(es);
    },
    [setNodes, setEdges],
  );

  const TIP_TRIM_SIZE = 8;

  /**
   * Esc (not while drawing):
   * - Short dangling/trailing stubs → remove that stub only.
   * - Wires with bends → peel one bend (step-by-step).
   * - Long dangling wires with no bends → remove the dangling wire.
   * - Connected wire with no bends → do nothing (use Delete to remove).
   * - Also retracts free tip ends past mid-wire joins before peeling.
   */
  const trimSelectedWires = useCallback(() => {
    const nodesNow = nodesRef.current;
    const edgesNow = edgesRef.current;

    let selectedEdges = edgesNow.filter((e) => e.selected);
    const selectedTipIds = new Set(
      nodesNow.filter((n) => n.selected && n.data.kind === "TIP").map((n) => n.id),
    );

    // Tip selected but no edge selected: prefer short stubs; else one dangling edge.
    if (!selectedEdges.length && selectedTipIds.size) {
      selectedEdges = edgesNow.filter(
        (e) =>
          (selectedTipIds.has(e.source) || selectedTipIds.has(e.target)) &&
          isShortDanglingStub(nodesNow, edgesNow, e),
      );
      if (!selectedEdges.length) {
        selectedEdges = edgesNow.filter(
          (e) =>
            (selectedTipIds.has(e.source) || selectedTipIds.has(e.target)) &&
            isDanglingOrTrailingEdge(nodesNow, edgesNow, e),
        );
      }
    }
    if (!selectedEdges.length && !selectedTipIds.size) {
      // Esc with nothing selected: clear leftover junction squares from
      // deg-2 splice tips (rail still split after a branch was deleted).
      const collapsed = collapsePassThroughTips(nodesNow, edgesNow);
      if (collapsed.merged > 0) {
        pushHistory();
        const normalized = normalizeWires(collapsed.nodes, collapsed.edges);
        setNodes(normalized.nodes);
        setEdges(normalized.edges);
        return true;
      }
      return false;
    }

    // Tips touched by the current selection (selected edges + selected tips).
    const tipIds = new Set(selectedTipIds);
    for (const e of selectedEdges) {
      const src = nodesNow.find((n) => n.id === e.source);
      const tgt = nodesNow.find((n) => n.id === e.target);
      if (src?.data.kind === "TIP") tipIds.add(e.source);
      if (tgt?.data.kind === "TIP") tipIds.add(e.target);
    }

    // 1a) Short dangling stubs attached to selection tips (not the selected long wire).
    if (tipIds.size) {
      const attachedShort = edgesNow.filter(
        (e) =>
          (tipIds.has(e.source) || tipIds.has(e.target)) &&
          isShortDanglingStub(nodesNow, edgesNow, e) &&
          !selectedEdges.some((s) => s.id === e.id),
      );
      if (attachedShort.length) {
        pushHistory();
        const pruned = removeDanglingOrTrailingEdges(nodesNow, edgesNow, {
          onlyEdgeIds: attachedShort.map((e) => e.id),
        });
        const keep = new Set(selectedEdges.map((e) => e.id));
        setNodes(pruned.nodes);
        setEdges(
          pruned.edges.map((e) => ({
            ...e,
            selected: keep.has(e.id),
          })),
        );
        return true;
      }
    }

    // 1b) Selected short stubs only → delete those. Long dangling wires peel below.
    const selectedShortStubs = selectedEdges.filter((e) =>
      isShortDanglingStub(nodesNow, edgesNow, e),
    );
    if (
      selectedShortStubs.length &&
      selectedShortStubs.length === selectedEdges.length
    ) {
      pushHistory();
      const pruned = removeDanglingOrTrailingEdges(nodesNow, edgesNow, {
        onlyEdgeIds: selectedShortStubs.map((e) => e.id),
      });
      setNodes(pruned.nodes);
      setEdges(pruned.edges);
      return true;
    }

    if (!selectedEdges.length) return false;

    // 1.5) Retract free tip ends to mid-path joins/crossings (stubs above/below).
    // This is the Esc fix for a straight vertical that crosses other wires:
    // do NOT delete the whole wire — trim dangling ends to the join points first.
    {
      let trimmedAny = false;
      let nextNodes = nodesNow;
      let nextEdges = edgesNow;
      for (const edge of selectedEdges) {
        const cur = nextEdges.find((e) => e.id === edge.id) ?? edge;
        const { nodes: ns, edge: cleaned, changed } = trimEdgeEndsToJoins(
          nextNodes,
          nextEdges,
          cur,
        );
        if (!changed) continue;
        trimmedAny = true;
        nextNodes = ns;
        nextEdges = nextEdges.map((e) =>
          e.id === edge.id ? { ...cleaned, selected: true } : e,
        );
      }
      if (trimmedAny) {
        pushHistory();
        const keep = new Set(selectedEdges.map((e) => e.id));
        setNodes(nextNodes);
        setEdges(
          nextEdges.map((e) => ({
            ...e,
            selected: keep.has(e.id),
          })),
        );
        return true;
      }
    }

    // 2) Trim short trailing nubs on the selected main wire (same-edge L-tails).
    {
      let cleanedAny = false;
      let nextNodes = nodesNow;
      let nextEdges = edgesNow;
      for (const edge of selectedEdges) {
        const cur = nextEdges.find((e) => e.id === edge.id) ?? edge;
        const { edge: cleaned, nodes: ns, changed } = cleanEdgeTrailingNubs(
          nextNodes,
          nextEdges,
          cur,
        );
        if (!changed) continue;
        cleanedAny = true;
        nextNodes = ns;
        nextEdges = nextEdges.map((e) =>
          e.id === edge.id ? { ...cleaned, selected: true } : e,
        );
      }
      if (cleanedAny) {
        pushHistory();
        const keep = new Set(selectedEdges.map((e) => e.id));
        setNodes(nextNodes);
        setEdges(
          nextEdges.map((e) => ({
            ...e,
            selected: keep.has(e.id),
          })),
        );
        return true;
      }
    }

    // 3) Peel one bend, or remove dangling stubs when no bends remain.
    // Connected wires with no bends stay — use Delete to remove those.
    let nextNodes = nodesNow.map((n) => ({ ...n, selected: false }));
    let nextEdges = edgesNow;
    const tipsToRemove = new Set<string>();
    const keepEdgeSelected = new Set<string>();
    let changed = false;

    for (const edge of selectedEdges) {
      // Short stubs already handled above.
      if (isShortDanglingStub(nodesNow, edgesNow, edge)) continue;

      const waypoints = [
        ...((((edge.data as { waypoints?: { x: number; y: number }[] } | undefined)?.waypoints) ?? [])),
      ];
      const tgt = nextNodes.find((n) => n.id === edge.target);
      const src = nextNodes.find((n) => n.id === edge.source);
      const targetIsTip = tgt?.data.kind === "TIP";
      const sourceIsTip = src?.data.kind === "TIP";

      if (waypoints.length > 0) {
        changed = true;
        if (targetIsTip) {
          const end = waypoints[waypoints.length - 1]!;
          const kept = waypoints.slice(0, -1);
          nextNodes = nextNodes.map((n) =>
            n.id === edge.target
              ? {
                  ...n,
                  position: { x: end.x, y: end.y - TIP_TRIM_SIZE / 2 },
                  selected: false,
                  draggable: false,
                }
              : n,
          );
          nextEdges = nextEdges.map((e) =>
            e.id === edge.id
              ? { ...e, data: { ...(e.data as object), waypoints: kept }, selected: true }
              : { ...e, selected: false },
          );
          keepEdgeSelected.add(edge.id);
        } else if (sourceIsTip) {
          const end = waypoints[0]!;
          const kept = waypoints.slice(1);
          nextNodes = nextNodes.map((n) =>
            n.id === edge.source
              ? {
                  ...n,
                  position: { x: end.x, y: end.y - TIP_TRIM_SIZE / 2 },
                  selected: false,
                  draggable: false,
                }
              : n,
          );
          nextEdges = nextEdges.map((e) =>
            e.id === edge.id
              ? { ...e, data: { ...(e.data as object), waypoints: kept }, selected: true }
              : { ...e, selected: false },
          );
          keepEdgeSelected.add(edge.id);
        } else {
          // Finished pin↔pin wire: peel target end into a dangling tip.
          const end = waypoints[waypoints.length - 1]!;
          const kept = waypoints.slice(0, -1);
          const tipId = newId();
          nextNodes = [
            ...nextNodes,
            {
              id: tipId,
              type: "component" as const,
              position: { x: end.x, y: end.y - TIP_TRIM_SIZE / 2 },
              data: { kind: "TIP" as const, refdes: "", params: {} },
              style: { width: TIP_TRIM_SIZE, height: TIP_TRIM_SIZE },
              selected: false,
              draggable: false,
            },
          ];
          nextEdges = nextEdges.map((e) =>
            e.id === edge.id
              ? {
                  ...e,
                  target: tipId,
                  targetHandle: "t",
                  data: { ...(e.data as object), waypoints: kept },
                  selected: true,
                }
              : { ...e, selected: false },
          );
          keepEdgeSelected.add(edge.id);
        }
        continue;
      }

      // No bends left.
      // Dangling/trailing (free tip) → remove that stub only.
      // Connected wire → keep it; user presses Delete to remove the whole wire.
      if (isDanglingOrTrailingEdge(nodesNow, edgesNow, edge)) {
        changed = true;
        nextEdges = nextEdges.filter((e) => e.id !== edge.id);
        if (targetIsTip) tipsToRemove.add(edge.target);
        if (sourceIsTip) tipsToRemove.add(edge.source);
      } else {
        keepEdgeSelected.add(edge.id);
      }
    }

    if (!changed) {
      // Straight connected wire: Esc does nothing (Delete removes it).
      return false;
    }

    pushHistory();

    if (tipsToRemove.size) {
      const stillUsed = new Set<string>();
      for (const e of nextEdges) {
        stillUsed.add(e.source);
        stillUsed.add(e.target);
      }
      nextNodes = nextNodes.filter(
        (n) => !(tipsToRemove.has(n.id) && !stillUsed.has(n.id)),
      );
    }

    nextEdges = nextEdges.map((e) =>
      keepEdgeSelected.has(e.id) ? { ...e, selected: true } : e,
    );

    setNodes(nextNodes);
    setEdges(nextEdges);
    return true;
  }, [setNodes, setEdges, pushHistory]);

  const onWirePathUpdate = useCallback(
    (edgeId: string, waypoints: { x: number; y: number }[]) => {
      // Live path edits — history is recorded once by the caller when the edit starts.
      setEdges((prev) =>
        prev.map((e) =>
          e.id === edgeId
            ? {
                ...e,
                data: {
                  ...(e.data as object),
                  waypoints,
                  // Authored segment/bend drag — not Move rubber-band.
                  directPath: false,
                },
                selected: true,
              }
            : e,
        ),
      );
    },
    [setEdges],
  );


  const onMoveWireDisconnect = useCallback(
    (edgeId: string, opts?: { fromIndex: number; toIndex: number }) => {
      const result = opts
        ? detachWireSegmentForDrag(
            nodesRef.current,
            edgesRef.current,
            edgeId,
            opts.fromIndex,
            opts.toIndex,
            newId,
          )
        : detachWireForMove(
            nodesRef.current,
            edgesRef.current,
            edgeId,
            newId,
          );
      if (!result) return null;

      if (!dragOrigin.current) {
        dragOrigin.current = snapshot();
      }

      flushSync(() => {
        setNodes(result.nodes);
        setEdges(result.edges);
      });

      const idSet = new Set(result.moveIds);
      return {
        moveIds: result.moveIds,
        origins: result.nodes
          .filter((n) => idSet.has(n.id))
          .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })),
        edgeId: result.edgeId,
        baseWaypoints: result.baseWaypoints,
        cutCount: result.didCut ? 1 : 0,
      };
    },
    [setNodes, setEdges, snapshot],
  );

  const armPasteFromIds = useCallback(
    (nodeIdList: Iterable<string>, edgeIdList: Iterable<string>) => {
      const ns = nodesRef.current;
      const es = edgesRef.current;
      const selectedNodeIds = new Set(nodeIdList);
      const selectedEdgeIds = new Set(edgeIdList);
      for (const e of es) {
        if (selectedNodeIds.has(e.source) && selectedNodeIds.has(e.target)) {
          selectedEdgeIds.add(e.id);
        }
      }
      for (const e of es) {
        if (!selectedEdgeIds.has(e.id)) continue;
        selectedNodeIds.add(e.source);
        selectedNodeIds.add(e.target);
      }
      const hasPart = [...selectedNodeIds].some((id) => {
        const n = ns.find((x) => x.id === id);
        return Boolean(n && n.data.kind !== "TIP");
      });
      if (!hasPart && !selectedEdgeIds.size) return false;
      if (!selectedNodeIds.size) return false;

      const clip: CircuitClipboard = {
        nodes: ns
          .filter((n) => selectedNodeIds.has(n.id))
          .map((n) => ({
            ...n,
            selected: false,
            data: { ...n.data, params: { ...n.data.params } },
          })),
        edges: es
          .filter((e) => selectedEdgeIds.has(e.id))
          .map((e) => {
            const data = e.data as { waypoints?: Point[] } | undefined;
            return {
              ...e,
              selected: false,
              data: data
                ? { ...data, waypoints: (data.waypoints ?? []).map((p) => ({ ...p })) }
                : e.data,
            };
          }),
      };
      clipboard.current = clip;
      setPlaceKind(null);
      setPlaceParams(null);
      setCopyMarquee(false);
      setPasteClip(clip);
      return true;
    },
    [],
  );

  const copySelection = useCallback(() => {
    const ns = nodesRef.current;
    const es = edgesRef.current;
    armPasteFromIds(
      ns.filter((n) => n.selected).map((n) => n.id),
      es.filter((e) => e.selected).map((e) => e.id),
    );
  }, [armPasteFromIds]);

  /** Copy-mode: left-click one part → copy immediately (paste ghost). */
  const copyPartImmediate = useCallback(
    (nodeId: string) => {
      armPasteFromIds([nodeId], []);
    },
    [armPasteFromIds],
  );

  /** Copy-mode: left-click one wire → copy immediately (paste ghost). */
  const copyEdgeImmediate = useCallback(
    (edgeId: string) => {
      const e = edgesRef.current.find((x) => x.id === edgeId);
      if (!e) return;
      armPasteFromIds([e.source, e.target], [edgeId]);
    },
    [armPasteFromIds],
  );

  /**
   * Copy-mode marquee: ≥70% coverage.
   * Plain drag → copy immediately. Ctrl+drag → add to highlight only (Enter to commit).
   */
  const selectCopyRegion = useCallback((rect: FlowRect, additive: boolean) => {
    const ns = nodesRef.current;
    const es = edgesRef.current;
    const coveredNodes = new Set(
      nodesCoveredByRect(ns, rect, 0.7).filter((id) => {
        const n = ns.find((x) => x.id === id);
        return Boolean(n && n.data.kind !== "TIP");
      }),
    );
    const coveredTips = nodesCoveredByRect(ns, rect, 0.7).filter((id) => {
      const n = ns.find((x) => x.id === id);
      return n?.data.kind === "TIP";
    });
    const coveredEdges = new Set(edgesCoveredByRect(ns, es, rect, 0.7));
    const endpointOk = new Set([...coveredNodes, ...coveredTips]);
    for (const e of es) {
      if (endpointOk.has(e.source) && endpointOk.has(e.target)) coveredEdges.add(e.id);
    }

    if (!coveredNodes.size && !coveredEdges.size && !additive) {
      setNodes((cur) => cur.map((n) => (n.selected ? { ...n, selected: false } : n)));
      setEdges((cur) => cur.map((e) => (e.selected ? { ...e, selected: false } : e)));
      return;
    }
    if (!coveredNodes.size && !coveredEdges.size) return;

    if (!additive) {
      armPasteFromIds([...coveredNodes, ...coveredTips], coveredEdges);
      return;
    }

    setNodes((cur) =>
      cur.map((n) => {
        if (n.data.kind === "TIP") {
          const next = coveredTips.includes(n.id) || n.selected;
          return n.selected === next ? n : { ...n, selected: next };
        }
        const next = coveredNodes.has(n.id) || n.selected;
        return n.selected === next ? n : { ...n, selected: next };
      }),
    );
    setEdges((cur) =>
      cur.map((e) => {
        const next = coveredEdges.has(e.id) || e.selected;
        return e.selected === next ? e : { ...e, selected: next };
      }),
    );
  }, [armPasteFromIds, setNodes, setEdges]);

  /** Ctrl+click wire while in copy mode — toggle without clearing parts. */
  const toggleSelectEdge = useCallback(
    (edgeId: string, multi: boolean) => {
      if (!edgeId) {
        setEdges((eds) => eds.map((e) => (e.selected ? { ...e, selected: false } : e)));
        setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
        return;
      }
      if (multi) {
        setEdges((eds) =>
          eds.map((e) => (e.id === edgeId ? { ...e, selected: !e.selected } : e)),
        );
        return;
      }
      // Plain click is handled by copyEdgeImmediate; keep exclusive select as fallback.
      setEdges((eds) => eds.map((e) => ({ ...e, selected: e.id === edgeId })));
      setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    },
    [setEdges, setNodes],
  );

  const pasteAt = useCallback((origin: Point) => {
    const clip = clipboard.current;
    if (!clip?.nodes.length) return;
    pushHistory();
    const ns = nodesRef.current;
    const es = edgesRef.current;
    const alloc = makeAllocator(ns);
    const built = instantiateClipboard(
      clip,
      origin,
      partOccupancy(ns),
      WIRE_GRID,
      newId,
      alloc,
    );
    const deselectedNodes = ns.map((n) => (n.selected ? { ...n, selected: false } : n));
    const deselectedEdges = es.map((e) => (e.selected ? { ...e, selected: false } : e));
    let nextNodes = [...deselectedNodes, ...built.nodes];
    let nextEdges = [...deselectedEdges, ...built.edges];
    if (built.partIds.length) {
      const attached = attachPartsToWires(nextNodes, nextEdges, built.partIds);
      if (attached.attached) {
        const absorbed = absorbTipsOntoPins(attached.nodes, attached.edges);
        nextNodes = absorbed.nodes;
        nextEdges = absorbed.edges;
      }
    }
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
    noteCommonlyUsed(...built.nodes.map((n) => n.data.kind));
  }, [pushHistory, setNodes, setEdges, noteCommonlyUsed]);

  const pasteShortcut = useCallback((origin: Point | null) => {
    const clip = clipboard.current;
    if (!clip?.nodes.length) return;
    setPlaceKind(null);
    setPlaceParams(null);
    setCopyMarquee(false);
    setPasteClip(clip);
    if (origin) pasteAt(origin);
  }, [pasteAt]);

  const rotatePasteClip = useCallback(() => {
    const clip = clipboard.current;
    if (!clip?.nodes.length) return;
    const next = rotateClipboardCw(clip, WIRE_GRID);
    clipboard.current = next;
    setPasteClip(next);
  }, []);

  const cutSelection = useCallback(() => {
    const nodesNow = nodesRef.current;
    const edgesNow = edgesRef.current;
    const selectedNodeIds = nodesNow.filter((n) => n.selected).map((n) => n.id);
    const selectedEdgeIds = edgesNow.filter((e) => e.selected).map((e) => e.id);
    if (!selectedNodeIds.length && !selectedEdgeIds.length) return;
    copySelection();
    pushHistory();
    const dropNodes = new Set(selectedNodeIds);
    const dropEdges = new Set(selectedEdgeIds);
    const nextNodes = nodesNow.filter((n) => !dropNodes.has(n.id));
    const nextEdges = edgesNow.filter(
      (e) =>
        !dropEdges.has(e.id) &&
        !dropNodes.has(e.source) &&
        !dropNodes.has(e.target),
    );
    const pruned = pruneOrphanTips(nextNodes, nextEdges);
    const collapsed = collapsePassThroughTips(pruned.nodes, pruned.edges);
    setNodes(collapsed.nodes);
    setEdges(collapsed.edges);
  }, [copySelection, pushHistory, setNodes, setEdges]);

  /** Toolbar / Ctrl+C: copy selection immediately, else enter copy-marquee. */
  const triggerCopy = useCallback(() => {
    if (copyMarquee) {
      const hasSel =
        nodesRef.current.some((n) => n.selected && n.data.kind !== "TIP") ||
        edgesRef.current.some((ed) => ed.selected);
      if (hasSel) copySelection();
      return;
    }
    const hasSel =
      nodesRef.current.some((n) => n.selected && n.data.kind !== "TIP") ||
      edgesRef.current.some((ed) => ed.selected);
    if (hasSel) {
      copySelection();
      return;
    }
    beginCopyMarquee();
  }, [beginCopyMarquee, copyMarquee, copySelection]);

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
      else if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        triggerCopy();
      }
      else if (mod && e.key.toLowerCase() === "x") { e.preventDefault(); cutSelection(); }
      else if (e.key === "Escape" && copyMarquee) {
        e.preventDefault();
        cancelCopyMarquee();
      }
      else if (e.key === "Enter" && copyMarquee) {
        e.preventDefault();
        copySelection();
      }
      else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        downloadCircuit(snapshot());
      }
      else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        fileInputRef.current?.click();
      }
      else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        if (e.repeat) return;
        deleteSelectionOrToggleScissors();
      }
      else if (!mod && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const sel = nodes.filter((n) => n.selected && n.data.kind !== "TIP");
        if (!sel.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 1 : 16;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        pushHistory();
        const moved = new Set(sel.map((n) => n.id));
        const nodesNow = nodesRef.current;
        const edgesNow = edgesRef.current;
        const lifted = promoteInlinePinTees(nodesNow, edgesNow, [...moved], newId);
        const nextNodes = lifted.nodes.map((n) =>
          moved.has(n.id)
            ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
            : n,
        );
        // Keyboard nudge is intentional — do not near-align the part back onto
        // the peer row/col (that made Up/Down feel stuck within 2 grids).
        const finalized = finalizeConnectedPartMove(nextNodes, lifted.edges, moved, {
          nearAlign: false,
        });
        nodesRef.current = finalized.nodes;
        edgesRef.current = finalized.edges;
        setNodes(finalized.nodes);
        setEdges(finalized.edges);
      }
      else if (!mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setNetNameDialog(true);
      }
      else if (!mod && e.key.toLowerCase() === "r") {
        if (placeKind || pasteClip) return;
        const hasSel = nodes.some((n) => n.selected);
        if (hasSel) { e.preventDefault(); rotateSelected(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    }, [
      beginCopyMarquee,
      cancelCopyMarquee,
      copyMarquee,
      copySelection,
      cutSelection,
      triggerCopy,
      nodes,
      placeKind,
      pasteClip,
      undo,
      redo,
      snapshot,
      rotateSelected,
      setNodes,
      setEdges,
      pushHistory,
      deleteSelectionOrToggleScissors,
    ]);

  const startTextEdit = useCallback(() => {
    setDraftNetlist(netlist);
    setTextEditMode(true);
    setNetlistStatus(null);
    setNetlistStatusError(false);
  }, [netlist]);

  const cancelTextEdit = useCallback(() => {
    setTextEditMode(false);
    setDraftNetlist("");
    setNetlistStatus(null);
    setNetlistStatusError(false);
  }, []);

  const applyTextEdit = useCallback(() => {
    const result = applyNetlistToGraph(nodes, edges, draftNetlist);

    // Foreign / unsafe paste: never touch history or the live graph.
    if (result.rejected) {
      setNetlistStatusError(true);
      setNetlistStatus(`Error: ${result.rejected}`);
      return;
    }

    pushHistory();
    setNodes(result.nodes);
    setEdges(result.edges);
    syncIdCounter(result.nodes, idCounter);

    const dirs = extractDirectives(draftNetlist);
    if (dirs.length) setDirectives(dirs);

    const errors: string[] = [];
    if (result.skippedUnknown.length) {
      errors.push(
        `unknown or incomplete device(s): ${result.skippedUnknown.join(", ")} — no matching symbol`,
      );
    }

    const parts: string[] = [];
    if (result.updated.length) parts.push(`updated ${result.updated.join(", ")}`);
    if (result.added.length) parts.push(`added ${result.added.join(", ")} (unplaced — drag to position)`);
    if (result.deleted.length) parts.push(`deleted ${result.deleted.join(", ")}`);
    if (!parts.length && !errors.length) parts.push("no device changes");
    if (result.rewired) parts.push("wires rebuilt from nets");

    if (errors.length) {
      // Graph already updated for recognized devices; keep draft so user can fix unknowns.
      setNetlistStatusError(true);
      setNetlistStatus(`Error: ${errors.join(" · ")}${parts.length ? ` · ${parts.join(" · ")}` : ""}`);
      return;
    }

    setTextEditMode(false);
    setDraftNetlist("");
    setNetlistStatusError(false);
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
      const placed = changes.flatMap((c) =>
        c.type === "position" && c.dragging === false && c.position
          ? [{ id: c.id, position: c.position }]
          : [],
      );
      if (!placed.length) return;

      const idSet = new Set(placed.map((p) => p.id));
      const nodesForRoute = nodesRef.current.map((node) => {
        const p = placed.find((pl) => pl.id === node.id);
        const positioned = p ? { ...node, position: p.position } : node;
        return idSet.has(node.id) && positioned.data.unplaced
          ? { ...positioned, data: { ...positioned.data, unplaced: false } }
          : positioned;
      });

      if (connectedMoveRef.current) {
        connectedMoveRef.current = false;
        // Re-route + slide junction tips + attach/prune stubs for any circuit.
        const movedParts = new Set(
          placed
            .map((p) => nodesForRoute.find((n) => n.id === p.id))
            .filter((n): n is Node<ComponentData> => !!n && n.data.kind !== "TIP")
            .map((n) => n.id),
        );
        const finalized = finalizeConnectedPartMove(
          nodesForRoute,
          edgesRef.current,
          movedParts,
        );
        const absorbed = absorbTipsOntoPins(finalized.nodes, finalized.edges);
        // Connected Move already has wires attached — do not T-splice again
        // onto coplanar rails (that recreated the U-loop on C1).
        nodesRef.current = absorbed.nodes;
        edgesRef.current = absorbed.edges;
        setNodes(absorbed.nodes);
        setEdges(absorbed.edges);
      } else {
        connectedMoveRef.current = false;
        setNodes(nodesForRoute);
        // Reconnect any pin that was dropped back onto a dangling wire end.
        reconnectDroppedParts(placed);
      }
    },
    [onNodesChange, setNodes, setEdges, snapshot, reconnectDroppedParts],
  );

  const onSave = useCallback(() => {
    downloadCircuit(snapshot());
  }, [snapshot]);

  const onRestoreStarter = useCallback(() => {
    try {
      pushHistory();
      restore(parseCircuitFile(starterCircuit));
      setNetlistStatus("restored starter circuit (examples/demo-circuit.json)");
    } catch (e) {
      setNetlistStatus(`restore failed: ${e instanceof Error ? e.message : "error"}`);
    }
  }, [pushHistory, restore]);

  /** Optional example — does not replace starter; undo via history. */
  const onLoadHbridgeExample = useCallback(() => {
    try {
      pushHistory();
      restore(parseCircuitFile(hbridgeSimplifiedCircuit));
      setNetlistStatus(
        "loaded H-bridge example (examples/hbridge-simplified.json) — simplified PWM, toy SIC_MOS",
      );
    } catch (e) {
      setNetlistStatus(`H-bridge load failed: ${e instanceof Error ? e.message : "error"}`);
    }
  }, [pushHistory, restore]);

  const onLoadClick = useCallback(() => fileInputRef.current?.click(), []);

  const onLoadFile = useCallback(async (file: File | null) => {
    if (!file) return;
    try {
      const loaded = await readCircuitFile(file);
      pushHistory();
      restore(loaded);
      setNetlistStatus(`opened ${file.name}`);
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
    // Apply the whole batch on local copies so "add then connect" sees the new part.
    let ns = nodesRef.current.slice();
    let es = edgesRef.current.slice();
    let changed = false;

    for (const op of ops) {
      if (op.type === "addComponent") {
        const alloc = makeAllocator(ns);
        const k = placeCounter.current++;
        const refdes = alloc(op.kind);
        const node = mk(newId(), op.kind, refdes, 240 + (k % 6) * 34, 200 + (k % 6) * 34);
        if (op.params) {
          node.data = {
            ...node.data,
            params: { ...node.data.params, ...op.params },
          };
        }
        ns = [...ns, node];
        changed = true;
      } else if (op.type === "setParam") {
        const want = op.refdes.toUpperCase();
        ns = ns.map((n) =>
          n.data.refdes.toUpperCase() === want
            ? { ...n, data: { ...n.data, params: { ...n.data.params, [op.key]: op.value } } }
            : n,
        );
        changed = true;
      } else if (op.type === "deleteComponent") {
        const want = op.refdes.toUpperCase();
        const target = ns.find((n) => n.data.refdes.toUpperCase() === want);
        if (target) {
          const idSet = new Set([target.id]);
          ns = ns.filter((n) => !idSet.has(n.id));
          es = es.filter((e) => !idSet.has(e.source) && !idSet.has(e.target));
          changed = true;
        }
      } else if (op.type === "connectPins") {
        const a = findNodeByRefdes(ns, op.aRefdes);
        const b = findNodeByRefdes(ns, op.bRefdes);
        if (a && b) {
          const aPin = op.aPin || defaultPin(a, "from");
          const bPin = op.bPin || defaultPin(b, "to");
          es = connectEndpoints(es, a, aPin, b, bPin);
          changed = true;
        }
      } else if (op.type === "disconnectPins") {
        const a = findNodeByRefdes(ns, op.aRefdes);
        if (a) {
          const b = op.bRefdes ? findNodeByRefdes(ns, op.bRefdes) : undefined;
          es = disconnectEndpoints(es, a, op.aPin, b, op.bPin);
          changed = true;
        }
      }
    }

    if (!changed) return;
    setNodes(ns);
    setEdges(es);
  }, [pushHistory, setNodes, setEdges]);

  const getAssistantContext = useCallback((): AssistantContext => {
    const components = nodes.map((n) => {
      const refdes =
        n.data.refdes ||
        (isGroundKind(n.data.kind)
          ? "GND"
          : n.data.kind === "NODE" || n.data.kind === "WIRELABEL"
            ? (n.data.params.name || n.data.kind)
            : "");
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
    <ProbeProvider>
    <SimResultContext.Provider value={simResult}>
    <ClearProbesOnSimChange result={simResult} />
    <div className="app">
      <header className="app-header">
        <span className="app-title">SimulAI · Schematic Editor</span>
        <div className="app-actions">
          <button type="button" className="ghost-btn" onClick={onSave} title="Save circuit JSON (Ctrl+S)">Save</button>
          <button type="button" className="ghost-btn" onClick={onLoadClick} title="Open circuit JSON (Ctrl+O)">Open</button>
          <button type="button" className="ghost-btn" onClick={onRestoreStarter} title="Reload the starter schematic">
            Restore starter
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={onLoadHbridgeExample}
            title="Load simplified H-bridge example (does not change the default starter)"
          >
            Load H-bridge
          </button>
          <button type="button" className="ghost-btn" onClick={() => setShowLibrary((v) => !v)}>
            {showLibrary ? "Hide models" : "Models"}
          </button>
          <div className="theme-toggle" role="group" aria-label="Color theme">
            <button
              type="button"
              className={`theme-toggle-btn${uiTheme === "light" ? " is-active" : ""}`}
              aria-pressed={uiTheme === "light"}
              title="Light theme"
              onClick={() => setUiTheme("light")}
            >
              Light
            </button>
            <button
              type="button"
              className={`theme-toggle-btn${uiTheme === "dark" ? " is-active" : ""}`}
              aria-pressed={uiTheme === "dark"}
              title="Dark theme"
              onClick={() => setUiTheme("dark")}
            >
              Dark
            </button>
          </div>
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
      </header>

      <div className={`mode-guide mode-guide-${canvasMode}`} role="status">
        <span className="mode-guide-badge">
          {canvasMode === "explore"
            ? "Explore"
            : canvasMode === "wire"
              ? "Wire"
              : canvasMode === "delete"
                ? "Delete"
                : canvasMode === "move"
                  ? "Move"
                  : "Drag"}
        </span>
        <div className="mode-guide-content">
          {canvasMode === "explore" ? (
            <>
              <p className="mode-guide-lead">Pan and zoom, or click to select parts and wires.</p>
              <ul className="mode-guide-list">
                <li><kbd>Drag</kbd> empty canvas to pan · <kbd>Scroll</kbd> to zoom · <kbd>Space</kbd> fit view</li>
                <li>Palette: click a part, then left-click to stamp · <kbd>R</kbd> rotates the ghost · right-click / Esc cancels</li>
                <li><kbd>N</kbd> or toolbar <strong>Net name</strong>: type a name, stamp text on the schematic · <kbd>R</kbd> rotates (3 ways) · same name joins nets</li>
                <li><kbd>Ctrl</kbd>+C copy mode · click a part/wire or drag a box (≥70%) to copy · paste ghost follows · <kbd>Esc</kbd> exits</li>
                <li>Palette <strong>Net label</strong> is the older flag symbol (still names nets when connected)</li>
                <li><kbd>Click</kbd> a part or wire to select · <kbd>Ctrl</kbd>+click toggles multi-select</li>
                <li>After a successful <strong>Run</strong>, <strong>Probe ON</strong>: click a wire for the <em>red</em> pin, then another wire for the <em>black</em> pin → <code>V(a,b)</code> · right-click removes black then red · <kbd>Shift</kbd>+click a part for current · <kbd>Ctrl</kbd>+click selects</li>
                <li><kbd>Right-click</kbd> a part to edit properties (OK / Cancel)</li>
                <li><kbd>Click</kbd> empty canvas to deselect · hollow square = free wire end</li>
                <li><kbd>E</kbd> Explore · <kbd>W</kbd> Wire · <kbd>M</kbd> Move · <kbd>D</kbd> Drag</li>
                <li><kbd>Delete</kbd> / <kbd>Backspace</kbd> removes a selection · with nothing selected, enters Delete · <kbd>Esc</kbd> returns to Explore</li>
              </ul>
            </>
          ) : canvasMode === "wire" ? (
            <>
              <p className="mode-guide-lead">Draw and edit wires (crosshair cursor).</p>
              <ul className="mode-guide-list">
                <li><kbd>Click</kbd> a pin or empty space to start · <kbd>Click</kbd> a pin to finish</li>
                <li>While drawing: <kbd>Click</kbd> empty = bend · click a pin/wire = finish</li>
                <li>Right-click = keep white segments, discard blue preview, then stop</li>
                <li><kbd>Click</kbd> a wire to branch at that column (first stroke prefers vertical off an H bus)</li>
                <li><kbd>Alt</kbd>+click a wire to select it (turns amber)</li>
                <li><kbd>Double-click</kbd> a wire to straighten it (pulls the run into the nearer pin)</li>
                <li>Hollow square = free <strong>wire end</strong> — select it, then <kbd>Delete</kbd> to remove the stub</li>
                <li><kbd>Esc</kbd> = stop drawing (keeps locked bends) and return to Explore</li>
                <li><kbd>Delete</kbd> / <kbd>Backspace</kbd>: remove selected part/wire · with nothing selected, enter Delete</li>
              </ul>
              <div className="mode-guide-legend" aria-label="Wire legend">
                <span className="wl-item">
                  <svg width="10" height="10" aria-hidden><rect x="1" y="1" width="8" height="8" fill="currentColor" /></svg>
                  Connected junction
                </span>
                <span className="wl-item">
                  <svg width="16" height="12" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M1 9 H5.5 A4 4 0 0 1 13.5 9 H15" />
                    <path d="M8.5 1 V5.2" />
                    <path d="M8.5 9 V11" />
                  </svg>
                  Crossing hop (not joined)
                </span>
              </div>
            </>
          ) : canvasMode === "delete" ? (
            <>
              <p className="mode-guide-lead">Click anything to remove it (scissors cursor).</p>
              <ul className="mode-guide-list">
                <li><kbd>Click</kbd> a part, wire, or hollow <strong>wire end</strong> square to delete it</li>
                <li><kbd>Click</kbd> a filled junction square to break the join (wires stay, ends open)</li>
                <li><kbd>Click</kbd> a crossing hop to hide it — wires stay as they are</li>
                <li>Short stubs are easiest to remove by clicking the square at the end</li>
                <li><kbd>Esc</kbd> Explore · toolbar Delete toggles scissors off · <kbd>E</kbd> <kbd>W</kbd> <kbd>M</kbd> <kbd>D</kbd> switch tools · <kbd>Delete</kbd> / <kbd>Backspace</kbd> removes a selection</li>
              </ul>
            </>
          ) : canvasMode === "move" ? (
            <>
              <p className="mode-guide-lead">Disconnect a part and move it alone (wires stay behind).</p>
              <ul className="mode-guide-list">
                <li><kbd>Drag</kbd> a part — wires detach at the pins and stay put</li>
                <li><kbd>Drag</kbd> empty canvas to box-select · <kbd>Ctrl</kbd>+drag adds to selection</li>
                <li><kbd>Click</kbd> empty = deselect · drag a selected part to move the whole group (each detaches)</li>
                <li><kbd>Drag</kbd> a straight wire run — that section disconnects; move it alone and drop to reconnect</li>
                <li>Drop onto a hollow wire end or pin to reconnect · GND on a rail forms a T</li>
                <li><kbd>R</kbd> rotates selected parts · <kbd>Esc</kbd> Explore · <kbd>Delete</kbd> / <kbd>Backspace</kbd> removes selection</li>
              </ul>
            </>
          ) : (
            <>
              <p className="mode-guide-lead">Drag parts with wires still connected.</p>
              <ul className="mode-guide-list">
                <li><kbd>Drag</kbd> a part — wires stay attached and follow</li>
                <li><kbd>Drag</kbd> empty canvas to box-select · <kbd>Ctrl</kbd>+drag adds to selection</li>
                <li><kbd>Shift</kbd>+drag empty = cut wires in the box · <kbd>Click</kbd> empty = deselect</li>
                <li><kbd>Click</kbd> a wire to select it · <kbd>Drag</kbd> a segment to slide it (pins stay attached)</li>
                <li>Hollow square = free <strong>wire end</strong> — click it, then <kbd>Delete</kbd></li>
                <li><kbd>Click</kbd> / <kbd>Ctrl</kbd>+click parts · drag a selected part to move the whole group</li>
                <li><kbd>Double-click</kbd> a wire to straighten it after a move</li>
                <li><kbd>R</kbd> rotates selected parts · <kbd>Esc</kbd> Explore · <kbd>Delete</kbd> / <kbd>Backspace</kbd> removes selection · <kbd>Ctrl</kbd>+C copy mode</li>
              </ul>
            </>
          )}
        </div>
      </div>

      <div className="workspace" style={{ gridTemplateColumns: `280px 1fr ${rightWidth}px` }}>
        <Palette
          activeKind={placeKind}
          pasting={Boolean(pasteClip)}
          copying={copyMarquee}
          commonlyUsed={commonlyUsed}
          onPick={pickPlaceKind}
        />

        <div className="canvas-col">
          <ModeToolbar
            mode={canvasMode}
            onModeChange={setCanvasModeAndClearPlace}
            viewApiRef={canvasViewApiRef}
            onPlaceLabel={() => pickPlaceKind("WIRELABEL")}
            labelActive={placeKind === "WIRELABEL"}
            simControlRef={simControlRef}
            simRunState={simRunState}
            onCut={cutSelection}
            onCopy={triggerCopy}
            copyActive={copyMarquee}
            onUndo={undo}
            onRedo={redo}
            canUndo={histTick >= 0 && history.current.canUndo()}
            canRedo={histTick >= 0 && history.current.canRedo()}
          />
          <Canvas
            viewApiRef={canvasViewApiRef}
            nodes={nodes}
            edges={edges}
            mode={canvasMode}
            uiTheme={uiTheme}
            onModeChange={setCanvasModeAndClearPlace}
            placeKind={placeKind}
            placeGhostName={
              placeKind === "WIRELABEL" ? (placeParams?.name ?? "") : undefined
            }
            pasteClip={pasteClip}
            copyMarquee={copyMarquee}
            onCopyRegion={selectCopyRegion}
            onCancelCopyMarquee={cancelCopyMarquee}
            onToggleSelectEdge={toggleSelectEdge}
            onCopyPartImmediate={copyPartImmediate}
            onCopyEdgeImmediate={copyEdgeImmediate}
            onPlaceAt={addComponentAt}
            onPasteAt={pasteAt}
            onPasteShortcut={pasteShortcut}
            onRotatePasteClip={rotatePasteClip}
            onCancelPlace={cancelPlace}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onWire={onWire}
            onWirePartial={onWirePartial}
            onTrimWire={trimSelectedWires}
            onWirePathUpdate={onWirePathUpdate}
            onMoveWireDisconnect={onMoveWireDisconnect}
            onPushHistory={pushHistory}
            onReplace={replaceComponent}
            onAddAt={addComponentAt}
            onCutMoveRegion={onCutMoveRegion}
            onSelectRegion={onSelectRegion}
            onMoveDisconnect={onMoveDisconnect}
            onWireBranch={onWireBranch}
            onCancelWireBranch={onCancelWireBranch}
            onDeleteNode={deleteNodeWithTool}
            onDeleteEdge={deleteEdgeWithTool}
            onDeleteWireMark={deleteWireMarkWithTool}
            hiddenCrossingKeys={hiddenCrossingKeys}
            onStraightenEdge={straightenEdge}
            onSelectEdge={onSelectEdge}
            onOpenComponentProps={openComponentProps}
          />
        </div>

        <div className="right-col" ref={rightColRef}>
          <div
            className="col-resize"
            title="Drag to resize sidebar"
            onPointerDown={beginColResize}
          />
          {!netlistFloating && (
            <div className="right-slot" style={{ flex: `${slotFr.netlist} 1 80px` }}>
              <NetlistPanel
                netlist={netlist}
                editing={textEditMode}
                draft={draftNetlist}
                status={netlistStatus}
                statusError={netlistStatusError}
                onStartEdit={startTextEdit}
                onDraftChange={setDraftNetlist}
                onApply={applyTextEdit}
                onCancel={cancelTextEdit}
                onPopOut={() => setNetlistFloating(true)}
                editorTheme={uiTheme === "light" ? "light" : "vs-dark"}
              />
            </div>
          )}
          {showLibrary && (
            <>
              {!netlistFloating && (
                <div
                  className="panel-split"
                  title="Drag to resize"
                  onPointerDown={(e) => beginRowSplit("netlist", "library", e)}
                />
              )}
              <div className="right-slot" style={{ flex: `${slotFr.library} 1 80px` }}>
                <LibraryPanel library={library} onChange={onLibraryChange} />
              </div>
            </>
          )}
          {!simFloating && (
            <>
              {(showLibrary || !netlistFloating) && (
                <div
                  className="panel-split"
                  title="Drag to resize"
                  onPointerDown={(e) =>
                    beginRowSplit(showLibrary ? "library" : "netlist", "sim", e)
                  }
                />
              )}
              <div className="right-slot" style={{ flex: `${slotFr.sim} 1 80px` }}>
                <SimPanel
                  netlist={netlist}
                  uiTheme={uiTheme}
                  controlRef={simControlRef}
                  onRunStateChange={setSimRunState}
                  onSimResult={setSimResult}
                  onPopOut={() => setSimFloating(true)}
                />
              </div>
            </>
          )}
          <div
            className="panel-split"
            title="Drag to resize"
            onPointerDown={(e) =>
              beginRowSplit(
                simFloating ? (showLibrary ? "library" : "netlist") : "sim",
                "chat",
                e,
              )
            }
          />
          <div className="right-slot" style={{ flex: `${slotFr.chat} 1 80px` }}>
            <ChatPanel onApplyOps={applyOpsSafe} getContext={getAssistantContext} />
          </div>
        </div>
      </div>

      {netNameDialog && (
        <NetNameDialog
          initialName={lastWireLabelName.current}
          onOk={beginWireLabelStamp}
          onCancel={() => setNetNameDialog(false)}
        />
      )}

      {propsDialog && propsDialogNode && (
        <ComponentPropertiesDialog
          node={propsDialogNode}
          anchor={{ x: propsDialog.x, y: propsDialog.y }}
          onApply={applyComponentProps}
          onCancel={() => setPropsDialog(null)}
          onRotateLive={rotateNodeLive}
          onConvertVoltageMode={convertVoltageSourceMode}
          onDelete={(id) => {
            setPropsDialog(null);
            deleteNodes([id]);
          }}
        />
      )}

      {netlistFloating && (
        <FloatingWindow
          title="netlist.cir"
          defaultRect={{ x: 140, y: 90, w: 620, h: 460 }}
          onClose={() => setNetlistFloating(false)}
        >
          <NetlistPanel
            netlist={netlist}
            editing={textEditMode}
            draft={draftNetlist}
            status={netlistStatus}
            statusError={netlistStatusError}
            onStartEdit={startTextEdit}
            onDraftChange={setDraftNetlist}
            onApply={applyTextEdit}
            onCancel={cancelTextEdit}
            editorTheme={uiTheme === "light" ? "light" : "vs-dark"}
          />
        </FloatingWindow>
      )}
      {simFloating && (
        <FloatingWindow
          title="simulation"
          defaultRect={{ x: 200, y: 140, w: 720, h: 460 }}
          onClose={() => setSimFloating(false)}
        >
          <SimPanel
            netlist={netlist}
            uiTheme={uiTheme}
            controlRef={simControlRef}
            onRunStateChange={setSimRunState}
            onSimResult={setSimResult}
          />
        </FloatingWindow>
      )}
    </div>
    </SimResultContext.Provider>
    </ProbeProvider>
  );
}
