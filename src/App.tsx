import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
} from "@xyflow/react";
import { Canvas, type CanvasMode, type WireCompletePayload, type WirePartialPayload } from "./components/Canvas";
import { Palette } from "./components/Palette";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { NetlistPanel } from "./components/NetlistPanel";
import { ChatPanel } from "./components/ChatPanel";
import { SimPanel } from "./components/SimPanel";
import { LibraryPanel } from "./components/LibraryPanel";
import { FloatingWindow } from "./components/FloatingWindow";
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
import { applyCutMove, detachPartForMove, reconnectPartsOnTips, reconnectTipsOnPins, type FlowRect } from "./wiring/cutMove";
import { clearTipStubsOnPins, pruneOrphanTips, collapsePassThroughTips } from "./wiring/tipCleanup";
import { collapseMicroBends, detachWireForMove } from "./wiring/wireMove";
import { pinWorldPoint } from "./wiring/pinGeometry";
import { computeEdgePolyline } from "./wiring/wireGeometry";
import {
  cleanEdgeTrailingNubs,
  isDanglingOrTrailingEdge,
  isShortDanglingStub,
  normalizeWires,
  removeDanglingOrTrailingEdges,
  trimEdgeEndsToJoins,
} from "./wiring/normalizeWires";
import type { Point } from "./wiring/orthogonal";

type Pt = { x: number; y: number };

/**
 * Clean the waypoints of a wire formed by joining an existing (possibly frozen)
 * half with a freshly drawn half. Runs the full pin→pin path through the ortho
 * collapse so redundant routing stubs at the join don't leave extra segments.
 */
function cleanReconnectPath(
  startPin: Pt | null,
  interior: Pt[],
  endPin: Pt | null,
): Pt[] {
  if (!startPin || !endPin) return interior;
  const cleaned = collapseMicroBends([startPin, ...interior, endPin]);
  return cleaned.slice(1, -1);
}

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
  type: "schematic",
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
  data: { waypoints: [] },
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
  const [netlistFloating, setNetlistFloating] = useState(false);
  const [simFloating, setSimFloating] = useState(false);
  const [rightWidth, setRightWidth] = useState(380);
  const [slotFr, setSlotFr] = useState({
    props: 0.9,
    netlist: 1.15,
    sim: 0.95,
    chat: 1.0,
    library: 0.55,
  });
  const rightColRef = useRef<HTMLDivElement>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("explore");
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

    // Continuing from a dangling TIP: extend the old wire and remove the tip.
    if (srcNode?.data.kind === "TIP") {
      const srcTipEdges = eds.filter(
        (e) =>
          (e.target === c.source && e.targetHandle === "t") ||
          (e.source === c.source && e.sourceHandle === "t"),
      );
      // Junction TIP (2+ edges) — just add the new edge, keep the junction node.
      if (srcTipEdges.length >= 2) {
        setEdges((prev) => addEdge({ ...c, type: "schematic", data: { waypoints } }, prev));
        return;
      }
      const intoTip = srcTipEdges[0] ?? null;
      if (!intoTip) {
        // Brand-new free-start tip (no edge yet) → pin or another tip.
        if (freeStart) setNodes(ns);
        setEdges((prev) =>
          addEdge(
            { ...c, type: "schematic", data: { waypoints } },
            freeStart ? eds : prev,
          ),
        );
        return;
      }
      const fromSource = intoTip.target === c.source;
      const otherId = fromSource ? intoTip.source! : intoTip.target!;
      const otherHandle = fromSource ? intoTip.sourceHandle! : intoTip.targetHandle!;
      const baseWaypoints =
        ((intoTip.data as { waypoints?: { x: number; y: number }[] } | undefined)?.waypoints) ?? [];
      // World point where the two wire halves join (the grabbed tip itself).
      const tipPos = {
        x: srcNode.position.x,
        y: srcNode.position.y + TIP_SIZE / 2,
      };
      // New edge runs otherId → c.target. Orient the old interior points to start
      // at otherId, then bridge through the tip corner into the freshly drawn bends.
      // Dropping the tip corner is what detaches the wire, so keep it in the list.
      const orientedBase = fromSource ? baseWaypoints : [...baseWaypoints].reverse();
      const merged = [...orientedBase, tipPos, ...waypoints];
      // Collapse the now-redundant routing stub left where the tip joined, so
      // reconnecting doesn't leave little extra segments sticking out.
      const otherNode = ns.find((n) => n.id === otherId);
      const cleanedMerged = cleanReconnectPath(
        otherNode ? pinWorldPoint(otherNode, otherHandle) : null,
        merged,
        tgtNode ? pinWorldPoint(tgtNode, c.targetHandle) : null,
      );

      // Drop the grabbed tip and the edge that held it.
      let nextNodes = ns.filter((n) => n.id !== c.source);
      let nextEdges = eds.filter(
        (e) => e.source !== c.source && e.target !== c.source,
      );
      // Replace any pre-existing stub already parked on the landing pin.
      if (tgtNode && tgtNode.data.kind !== "TIP") {
        const cleared = clearTipStubsOnPins(nextNodes, nextEdges, [
          { nodeId: c.target, handle: c.targetHandle },
        ]);
        nextNodes = cleared.nodes;
        nextEdges = cleared.edges;
      }
      // Reconnect the wire's other end to the landing pin. Add BEFORE pruning so
      // a dangling other-end tip isn't orphaned and deleted with its wire.
      if (!(otherId === c.target && otherHandle === c.targetHandle)) {
        nextEdges = addEdge(
          {
            id: `${otherId}${otherHandle}-${c.target}${c.targetHandle}`,
            type: "schematic",
            source: otherId,
            sourceHandle: otherHandle,
            target: c.target,
            targetHandle: c.targetHandle,
            data: { waypoints: cleanedMerged },
          },
          nextEdges,
        );
      }
      const pruned = pruneOrphanTips(nextNodes, nextEdges);
      const normalized = normalizeWires(pruned.nodes, pruned.edges);
      setNodes(normalized.nodes);
      setEdges(normalized.edges);
      return;
    }

    // Landing on a TIP: merge into existing dangling wire; remove tip.
    if (tgtNode?.data.kind === "TIP") {
      // If the TIP already has 2+ edges (it's a junction TIP from onWireBranch),
      // just add the new edge — don't merge/remove the junction TIP.
      const tipEdges = eds.filter(
        (e) =>
          (e.target === c.target && e.targetHandle === "t") ||
          (e.source === c.target && e.sourceHandle === "t"),
      );
      if (tipEdges.length >= 2) {
        setEdges((prev) => addEdge({ ...c, type: "schematic", data: { waypoints } }, prev));
        return;
      }
      const intoTip = tipEdges[0] ?? null;
      if (!intoTip) {
        setEdges((prev) => addEdge({ ...c, type: "schematic", data: { waypoints } }, prev));
        return;
      }
      const tipIsTarget = intoTip.target === c.target;
      const otherId = tipIsTarget ? intoTip.source! : intoTip.target!;
      const otherHandle = tipIsTarget ? intoTip.sourceHandle! : intoTip.targetHandle!;
      const baseWaypoints =
        ((intoTip.data as { waypoints?: { x: number; y: number }[] } | undefined)?.waypoints) ?? [];
      // World point where the two wire halves join (the landed tip itself).
      const tipPos = {
        x: tgtNode.position.x,
        y: tgtNode.position.y + TIP_SIZE / 2,
      };
      // New edge runs c.source → otherId: freshly drawn bends, then the tip corner,
      // then the old interior points oriented to end at otherId.
      const orientedBase = tipIsTarget ? [...baseWaypoints].reverse() : baseWaypoints;
      const merged = [...waypoints, tipPos, ...orientedBase];
      // Collapse the redundant routing stub at the join so no extra segment sticks out.
      const otherNode = ns.find((n) => n.id === otherId);
      const cleanedMerged = cleanReconnectPath(
        srcNode ? pinWorldPoint(srcNode, c.sourceHandle) : null,
        merged,
        otherNode ? pinWorldPoint(otherNode, otherHandle) : null,
      );

      // Drop the landed tip and the edge that held it.
      let nextNodes = ns.filter((n) => n.id !== c.target);
      let nextEdges = eds.filter(
        (e) => e.source !== c.target && e.target !== c.target,
      );
      // src already proven non-TIP above; clear any leftover Move stubs on that pin.
      if (srcNode) {
        const cleared = clearTipStubsOnPins(nextNodes, nextEdges, [
          { nodeId: c.source, handle: c.sourceHandle },
        ]);
        nextNodes = cleared.nodes;
        nextEdges = cleared.edges;
      }
      // Add the reconnected edge BEFORE pruning so the other-end tip survives.
      if (!(otherId === c.source && otherHandle === c.sourceHandle)) {
        nextEdges = addEdge(
          {
            id: `${c.source}${c.sourceHandle}-${otherId}${otherHandle}`,
            type: "schematic",
            source: c.source,
            sourceHandle: c.sourceHandle,
            target: otherId,
            targetHandle: otherHandle,
            data: { waypoints: cleanedMerged },
          },
          nextEdges,
        );
      }
      const pruned = pruneOrphanTips(nextNodes, nextEdges);
      const normalized = normalizeWires(pruned.nodes, pruned.edges);
      setNodes(normalized.nodes);
      setEdges(normalized.edges);
      return;
    }

    // Real pin → real pin: replace any Move/Esc tip stubs on those pins first.
    const cleared = clearTipStubsOnPins(ns, eds, [
      { nodeId: c.source, handle: c.sourceHandle },
      { nodeId: c.target, handle: c.targetHandle },
    ]);
    const pruned = pruneOrphanTips(cleared.nodes, cleared.edges);
    const normalized = normalizeWires(pruned.nodes, pruned.edges);
    setNodes(normalized.nodes);
    setEdges((prev) => {
      // prev may be stale vs pruned — use pruned.edges as base.
      void prev;
      return addEdge({ ...c, type: "schematic", data: { waypoints } }, normalized.edges);
    });
  }, [setNodes, setEdges, pushHistory]);

  const onWirePartial = useCallback((payload: WirePartialPayload) => {
    const { source, sourceHandle, freeStart, waypoints, end } = payload;
    pushHistory();
    if (!source || !sourceHandle) {
      if (!freeStart) return;
      const a = newId();
      const b = newId();
      setNodes((ns) => [...ns, makeTipNode(a, freeStart), makeTipNode(b, end)]);
      setEdges((eds) =>
        addEdge(
          {
            id: `${a}t-${b}t`,
            type: "schematic",
            source: a,
            sourceHandle: "t",
            target: b,
            targetHandle: "t",
            data: { waypoints },
          },
          eds,
        ),
      );
      return;
    }
    const tipId = newId();
    setNodes((ns) => [...ns, makeTipNode(tipId, end)]);
    setEdges((eds) =>
      addEdge(
        {
          id: `${source}${sourceHandle}-${tipId}t`,
          type: "schematic",
          source,
          sourceHandle,
          target: tipId,
          targetHandle: "t",
          data: { waypoints },
        },
        eds,
      ),
    );
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
        }
      }

      const beforeBranch = poly.slice(1, splitIdx + 1);
      const afterBranch = poly.slice(splitIdx + 1, poly.length - 1);
      const tipId = newId();
      const TIP_SIZE = 8;

      flushSync(() => {
        setNodes([
          ...ns,
          {
            id: tipId,
            type: "component" as const,
            position: { x: branchPoint.x, y: branchPoint.y - TIP_SIZE / 2 },
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
            data: { waypoints: beforeBranch },
            selected: false,
          },
          {
            ...edge,
            id: `${tipId}t-${edge.target}${edge.targetHandle}`,
            source: tipId,
            sourceHandle: "t",
            data: { waypoints: afterBranch },
            selected: false,
          },
        ]);
      });

      return tipId;
    },
    [setNodes, setEdges],
  );

  const onWireBranch = useCallback(
    (edgeId: string, branchPoint: Point): string | null => {
      pushHistory();
      return splitEdgeAtPoint(edgeId, branchPoint);
    },
    [pushHistory, splitEdgeAtPoint],
  );

  const onSelectEdge = useCallback(
    (edgeId: string) => {
      if (!edgeId) {
        setEdges((eds) => eds.map((e) => (e.selected ? { ...e, selected: false } : e)));
        setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
        return;
      }
      setEdges((eds) => eds.map((e) => ({ ...e, selected: e.id === edgeId })));
      setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    },
    [setEdges, setNodes],
  );

  /** RF can select several overlapping edges at a junction — coerce to one. */
  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      const selecting = changes.filter(
        (c): c is { type: "select"; id: string; selected: boolean } =>
          c.type === "select" && c.selected === true,
      );
      const rest = changes.filter((c) => c.type !== "select");
      if (selecting.length) {
        const id = selecting[selecting.length - 1]!.id;
        setEdges((eds) => eds.map((e) => ({ ...e, selected: e.id === id })));
        setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
        if (rest.length) onEdgesChange(rest);
        return;
      }
      onEdgesChange(changes);
    },
    [onEdgesChange, setEdges, setNodes],
  );

  const onCutMoveRegion = useCallback((rect: FlowRect) => {
    const result = applyCutMove(nodesRef.current, edgesRef.current, rect, newId);
    if (!result.didCut && !result.moveIds.length) return;
    pushHistory();
    setNodes(result.nodes);
    setEdges(result.edges);
  }, [setNodes, setEdges, pushHistory]);

  const moveSeverGuard = useRef<{ nodeId: string; at: number } | null>(null);

  /**
   * LTspice Move pickup: detach part from the net, return nodes to drag.
   * After this, the part only connects to TIP nodes — never to R1/GND/etc.
   */
  const onMoveDisconnect = useCallback(
    (nodeId: string, grabPoint?: { x: number; y: number }) => {
      const now = Date.now();
      const prev = moveSeverGuard.current;
      if (prev && prev.nodeId === nodeId && now - prev.at < 300) {
        // Same gesture — return current selection origins without re-cutting.
        const ns = nodesRef.current;
        const moveIds = ns.filter((n) => n.selected).map((n) => n.id);
        if (!moveIds.includes(nodeId)) moveIds.push(nodeId);
        return {
          moveIds,
          origins: ns
            .filter((n) => moveIds.includes(n.id))
            .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })),
          cutCount: 0,
        };
      }

      // Snapshot the connected state BEFORE cutting so undo restores the wires.
      const before = snapshot();
      const result = detachPartForMove(
        nodesRef.current,
        edgesRef.current,
        nodeId,
        newId,
        grabPoint,
      );
      const pruned = pruneOrphanTips(result.nodes, result.edges);

      moveSeverGuard.current = { nodeId, at: now };
      if (result.didCut && !dragOrigin.current) {
        dragOrigin.current = before;
      }

      flushSync(() => {
        // Do NOT normalizeWires here — that prunes short junction stubs and
        // merges deg-2 tips, which destroys the frozen reconnect anchors and
        // reshapes shared rails while the part is still moving.
        setNodes(pruned.nodes);
        setEdges(pruned.edges);
      });

      // Verify: part must not link to any real component.
      const stillLinked = pruned.edges.some((e) => {
        if (e.source !== nodeId && e.target !== nodeId) return false;
        const other = e.source === nodeId ? e.target : e.source;
        const on = pruned.nodes.find((n) => n.id === other);
        return on != null && on.data.kind !== "TIP";
      });
      if (stillLinked) {
        console.error("[move] detach failed — part still linked to a real component");
      }

      const idSet = new Set(result.moveIds);
      return {
        moveIds: result.moveIds,
        origins: pruned.nodes
          .filter((n) => idSet.has(n.id))
          .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })),
        cutCount: result.cutCount,
      };
    },
    [setNodes, setEdges, snapshot],
  );

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

  /**
   * After a part is dropped, snap any of its pins that landed on a dangling wire
   * end (TIP) back onto that wire — restoring the connection and netlist. This is
   * what makes "move a part away and back" reconnect exactly as it was.
   */
  const reconnectDroppedParts = useCallback(
    (placed: { id: string; position: { x: number; y: number } }[]) => {
      if (!placed.length) return;
      const posById = new Map(placed.map((p) => [p.id, p.position]));
      const withPositions = nodesRef.current.map((n) => {
        if (!posById.has(n.id)) return n;
        // Drop React Flow's cached `internals.positionAbsolute` so pin geometry
        // is computed from the fresh dropped position, not the stale one.
        const { internals, ...rest } = n as Node<ComponentData> & {
          internals?: unknown;
        };
        void internals;
        return { ...rest, position: posById.get(n.id)! };
      });
      const partRec = reconnectPartsOnTips(
        withPositions,
        edgesRef.current,
        [...posById.keys()],
      );
      const tipRec = reconnectTipsOnPins(
        partRec.reconnected ? partRec.nodes : withPositions,
        partRec.reconnected ? partRec.edges : edgesRef.current,
        [...posById.keys()],
      );
      if (!partRec.reconnected && !tipRec.reconnected) return;
      const chosenNodes = tipRec.reconnected ? tipRec.nodes : partRec.nodes;
      const chosenEdges = tipRec.reconnected ? tipRec.edges : partRec.edges;
      const normalized = normalizeWires(chosenNodes, chosenEdges);
      setNodes(normalized.nodes);
      setEdges(normalized.edges);
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
      pushHistory();
      setEdges((prev) =>
        prev.map((e) =>
          e.id === edgeId
            ? {
                ...e,
                data: { ...(e.data as object), waypoints },
                selected: true,
              }
            : e,
        ),
      );
    },
    [setEdges, pushHistory],
  );


  const onMoveWireDisconnect = useCallback(
    (edgeId: string) => {
      const result = detachWireForMove(
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

  const deleteSelectedEdges = useCallback(() => {
    const nodesNow = nodesRef.current;
    const edgesNow = edgesRef.current;
    let selectedEdges = edgesNow.filter((e) => e.selected);
    const selectedTipIds = new Set(
      nodesNow.filter((n) => n.selected && n.data.kind === "TIP").map((n) => n.id),
    );

    // Tip selected but no edge selected → treat its dangling stub as selected.
    if (!selectedEdges.length && selectedTipIds.size) {
      selectedEdges = edgesNow.filter(
        (e) =>
          (selectedTipIds.has(e.source) || selectedTipIds.has(e.target)) &&
          isDanglingOrTrailingEdge(nodesNow, edgesNow, e),
      );
    }

    // Part selected, no wire: remove short dangling stubs hanging off its pins
    // (common leftover after Move — stubs sit under the part and are hard to hit).
    if (!selectedEdges.length && !selectedTipIds.size) {
      const selectedParts = nodesNow.filter(
        (n) => n.selected && n.data.kind !== "TIP",
      );
      if (selectedParts.length) {
        const partIds = new Set(selectedParts.map((p) => p.id));
        const stubsOnPart = edgesNow.filter((e) => {
          if (!isShortDanglingStub(nodesNow, edgesNow, e)) return false;
          return partIds.has(e.source) || partIds.has(e.target);
        });
        if (stubsOnPart.length) {
          pushHistory();
          const pruned = removeDanglingOrTrailingEdges(nodesNow, edgesNow, {
            onlyEdgeIds: stubsOnPart.map((e) => e.id),
          });
          setNodes(pruned.nodes);
          setEdges(pruned.edges);
          return true;
        }
      }
      return false;
    }

    if (!selectedEdges.length) return false;

    const tipIds = new Set<string>(selectedTipIds);
    for (const e of selectedEdges) {
      const src = nodesNow.find((n) => n.id === e.source);
      const tgt = nodesNow.find((n) => n.id === e.target);
      if (src?.data.kind === "TIP") tipIds.add(e.source);
      if (tgt?.data.kind === "TIP") tipIds.add(e.target);
    }

    const selectedStubs = selectedEdges.filter((e) =>
      isShortDanglingStub(nodesNow, edgesNow, e),
    );
    const selectedMain = selectedEdges.filter(
      (e) => !isShortDanglingStub(nodesNow, edgesNow, e),
    );

    // Only short stubs selected → delete those stubs.
    if (selectedStubs.length && !selectedMain.length) {
      pushHistory();
      const pruned = removeDanglingOrTrailingEdges(nodesNow, edgesNow, {
        onlyEdgeIds: selectedStubs.map((e) => e.id),
      });
      setNodes(pruned.nodes);
      setEdges(pruned.edges);
      return true;
    }

    // Any dangling (incl. longer) selected via tip → delete those edges.
    const danglingSelected = selectedEdges.filter((e) =>
      isDanglingOrTrailingEdge(nodesNow, edgesNow, e),
    );
    if (
      danglingSelected.length &&
      danglingSelected.length === selectedEdges.length
    ) {
      pushHistory();
      const pruned = removeDanglingOrTrailingEdges(nodesNow, edgesNow, {
        onlyEdgeIds: danglingSelected.map((e) => e.id),
      });
      setNodes(pruned.nodes);
      setEdges(pruned.edges);
      return true;
    }

    // Main / long wire selected: remove attached short dangling stubs first.
    if (selectedMain.length && tipIds.size) {
      const attachedShort = edgesNow.filter(
        (e) =>
          (tipIds.has(e.source) || tipIds.has(e.target)) &&
          isShortDanglingStub(nodesNow, edgesNow, e) &&
          !selectedMain.some((s) => s.id === e.id),
      );
      if (attachedShort.length) {
        pushHistory();
        const pruned = removeDanglingOrTrailingEdges(nodesNow, edgesNow, {
          onlyEdgeIds: attachedShort.map((e) => e.id),
        });
        const keep = new Set(selectedMain.map((e) => e.id));
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

    // Trim trailing nubs before deleting a main wire.
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

    pushHistory();
    const edgeIds = new Set(selectedEdges.map((e) => e.id));
    const nextEdges = edgesNow.filter((e) => !edgeIds.has(e.id));
    // Drop orphan tips, then heal degree-2 splice tips left on the rail
    // (otherwise the junction square remains after deleting a branch).
    const pruned = pruneOrphanTips(nodesNow, nextEdges);
    const collapsed = collapsePassThroughTips(pruned.nodes, pruned.edges);
    const normalized = normalizeWires(collapsed.nodes, collapsed.edges);
    setNodes(normalized.nodes);
    setEdges(normalized.edges);
    return true;
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
      else if (e.key === "Backspace" || e.key === "Delete") {
        // Full remove: selected wires first, else selected components.
        if (deleteSelectedEdges()) {
          e.preventDefault();
          return;
        }
        const ids = nodes.filter((n) => n.selected).map((n) => n.id);
        if (ids.length) { e.preventDefault(); deleteNodes(ids); }
      }
      else if (!mod && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const sel = nodes.filter((n) => n.selected && n.data.kind !== "TIP");
        if (!sel.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 1 : 16;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        pushHistory();
        setNodes((ns) =>
          ns.map((n) =>
            n.selected && n.data.kind !== "TIP"
              ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
              : n,
          ),
        );
      }
      else if (!mod && e.key.toLowerCase() === "r") {
        const hasSel = nodes.some((n) => n.selected);
        if (hasSel) { e.preventDefault(); rotateSelected(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copySelection, cutSelection, paste, deleteNodes, deleteSelectedEdges, nodes, undo, redo, snapshot, rotateSelected, setNodes, pushHistory]);

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
      const placed = changes.flatMap((c) =>
        c.type === "position" && c.dragging === false && c.position
          ? [{ id: c.id, position: c.position }]
          : [],
      );
      if (!placed.length) return;
      const idSet = new Set(placed.map((p) => p.id));
      setNodes((ns) =>
        ns.map((n) =>
          idSet.has(n.id) && n.data.unplaced
            ? { ...n, data: { ...n.data, unplaced: false } }
            : n,
        ),
      );
      // Reconnect any pin that was dropped back onto a dangling wire end.
      reconnectDroppedParts(placed);
    },
    [onNodesChange, setNodes, snapshot, reconnectDroppedParts],
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
          <button
            type="button"
            className={`ghost-btn${canvasMode === "explore" ? " ghost-btn-active" : ""}`}
            onClick={() => setCanvasMode("explore")}
            title="Explore mode — pan, zoom, and inspect without editing"
          >
            Explore
          </button>
          <button
            type="button"
            className={`ghost-btn${canvasMode === "wire" ? " ghost-btn-active" : ""}`}
            onClick={() => setCanvasMode("wire")}
            title="Wire mode (click pins to route)"
          >
            Wire
          </button>
          <button
            type="button"
            className={`ghost-btn${canvasMode === "move" ? " ghost-btn-active" : ""}`}
            onClick={() => setCanvasMode("move")}
            title="Move mode (M) — click and drag parts"
          >
            Move
          </button>
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
      </header>

      <div className={`mode-guide mode-guide-${canvasMode}`} role="status">
        <span className="mode-guide-badge">{canvasMode === "explore" ? "Explore" : canvasMode === "wire" ? "Wire" : "Move"}</span>
        <div className="mode-guide-content">
          {canvasMode === "explore" ? (
            <>
              <p className="mode-guide-lead">Look around without changing the circuit.</p>
              <ul className="mode-guide-list">
                <li><kbd>Drag</kbd> empty canvas to pan · <kbd>Scroll</kbd> to zoom</li>
                <li><kbd>Click</kbd> a part to inspect it in Properties</li>
                <li>Switch to <strong>Wire</strong> or <strong>Move</strong> when you need to edit</li>
              </ul>
            </>
          ) : canvasMode === "wire" ? (
            <>
              <p className="mode-guide-lead">Draw and edit wires (crosshair cursor).</p>
              <ul className="mode-guide-list">
                <li><kbd>Click</kbd> a pin or empty space to start · <kbd>Click</kbd> a pin to finish</li>
                <li>While drawing: <kbd>Click</kbd> empty = bend · <kbd>Esc</kbd> / right-click = stop drawing</li>
                <li><kbd>Click</kbd> a wire to branch · <kbd>Alt</kbd>+click a wire to select it (turns amber)</li>
                <li><kbd>Esc</kbd> on a selected wire: peels one bend at a time · also removes short dangling stubs</li>
                <li><kbd>Delete</kbd> / <kbd>Backspace</kbd>: remove the selected wire completely</li>
              </ul>
              <div className="mode-guide-legend" aria-label="Wire legend">
                <span className="wl-item">
                  <svg width="10" height="10" aria-hidden><rect x="1" y="1" width="8" height="8" fill="#e8eef5" stroke="#0f1419" strokeWidth="1"/></svg>
                  Connected junction
                </span>
                <span className="wl-item">
                  <svg width="12" height="12" aria-hidden><circle cx="6" cy="6" r="5" fill="#0f1419" stroke="#e8eef5" strokeWidth="2"/></svg>
                  Crossing (not joined)
                </span>
              </div>
            </>
          ) : (
            <>
              <p className="mode-guide-lead">Move parts. Press <kbd>M</kbd> to toggle Move / Wire.</p>
              <ul className="mode-guide-list">
                <li><kbd>Click</kbd> a part to select · <kbd>Drag</kbd> to disconnect and move it</li>
                <li>Drop near a wire end to reconnect · <kbd>Arrow</kbd> keys nudge (Shift = 1px)</li>
                <li><kbd>R</kbd> rotates the selected part · box-drag cuts a region to move together</li>
                <li><kbd>Ctrl</kbd>+Z / Y undo·redo · <kbd>Ctrl</kbd>+C / V copy·paste</li>
              </ul>
            </>
          )}
        </div>
      </div>

      <div className="workspace" style={{ gridTemplateColumns: `200px 1fr ${rightWidth}px` }}>
        <Palette onAdd={addComponent} mode={canvasMode} onModeChange={setCanvasMode} />

        <Canvas
          nodes={nodes}
          edges={edges}
          mode={canvasMode}
          onModeChange={setCanvasMode}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onWire={onWire}
          onWirePartial={onWirePartial}
          onTrimWire={trimSelectedWires}
          onWirePathUpdate={onWirePathUpdate}
          onMoveWireDisconnect={onMoveWireDisconnect}
          onReplace={replaceComponent}
          onAddAt={addComponentAt}
          onCutMoveRegion={onCutMoveRegion}
          onMoveDisconnect={onMoveDisconnect}
          onWireBranch={onWireBranch}
          onSelectEdge={onSelectEdge}
        />

        <div className="right-col" ref={rightColRef}>
          <div
            className="col-resize"
            title="Drag to resize sidebar"
            onPointerDown={beginColResize}
          />
          <div className="right-slot" style={{ flex: `${slotFr.props} 1 80px` }}>
            <PropertiesPanel
              node={selectedNode}
              onChangeParam={changeParam}
              onChangeRefdes={changeRefdes}
              onRotate={rotateSelected}
              onDelete={(id) => deleteNodes([id])}
            />
          </div>
          {!netlistFloating && (
            <>
              <div
                className="panel-split"
                title="Drag to resize"
                onPointerDown={(e) => beginRowSplit("props", "netlist", e)}
              />
              <div className="right-slot" style={{ flex: `${slotFr.netlist} 1 80px` }}>
                <NetlistPanel
                  netlist={netlist}
                  editing={textEditMode}
                  draft={draftNetlist}
                  status={netlistStatus}
                  onStartEdit={startTextEdit}
                  onDraftChange={setDraftNetlist}
                  onApply={applyTextEdit}
                  onCancel={cancelTextEdit}
                  onPopOut={() => setNetlistFloating(true)}
                />
              </div>
            </>
          )}
          {showLibrary && (
            <>
              <div
                className="panel-split"
                title="Drag to resize"
                onPointerDown={(e) =>
                  beginRowSplit(netlistFloating ? "props" : "netlist", "library", e)
                }
              />
              <div className="right-slot" style={{ flex: `${slotFr.library} 1 80px` }}>
                <LibraryPanel library={library} onChange={onLibraryChange} />
              </div>
            </>
          )}
          {!simFloating && (
            <>
              <div
                className="panel-split"
                title="Drag to resize"
                onPointerDown={(e) =>
                  beginRowSplit(
                    showLibrary ? "library" : netlistFloating ? "props" : "netlist",
                    "sim",
                    e,
                  )
                }
              />
              <div className="right-slot" style={{ flex: `${slotFr.sim} 1 80px` }}>
                <SimPanel netlist={netlist} onPopOut={() => setSimFloating(true)} />
              </div>
            </>
          )}
          <div
            className="panel-split"
            title="Drag to resize"
            onPointerDown={(e) =>
              beginRowSplit(
                simFloating
                  ? showLibrary
                    ? "library"
                    : netlistFloating
                      ? "props"
                      : "netlist"
                  : "sim",
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
            onStartEdit={startTextEdit}
            onDraftChange={setDraftNetlist}
            onApply={applyTextEdit}
            onCancel={cancelTextEdit}
          />
        </FloatingWindow>
      )}
      {simFloating && (
        <FloatingWindow
          title="simulation"
          defaultRect={{ x: 200, y: 140, w: 720, h: 460 }}
          onClose={() => setSimFloating(false)}
        >
          <SimPanel netlist={netlist} />
        </FloatingWindow>
      )}
    </div>
  );
}
