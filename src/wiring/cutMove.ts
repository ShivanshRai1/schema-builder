import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import { pinWorldPoint } from "./pinGeometry";
import { getSymbolLayout } from "../nodes/symbols/layout";
import { snapPoint, type PinSide, type Point } from "./orthogonal";
import { computeEdgePolyline } from "./wireGeometry";
import { COMPONENT_SPECS, getComponentPins } from "../model/componentSpecs";
import { pruneOrphanTips } from "./tipCleanup";

export type FlowRect = { x: number; y: number; w: number; h: number };

const DEFAULT_W = 92;
const DEFAULT_H = 54;
const TIP_SIZE = 8;

function nodeSize(node: Node<ComponentData>): { w: number; h: number } {
  const sym = getSymbolLayout(node.data.kind, node.data.rotation);
  if (sym) return sym;
  const styleW = node.style?.width;
  const styleH = node.style?.height;
  const w =
    node.measured?.width ??
    (typeof node.width === "number" ? node.width : undefined) ??
    (typeof styleW === "number" ? styleW : undefined) ??
    DEFAULT_W;
  const h =
    node.measured?.height ??
    (typeof node.height === "number" ? node.height : undefined) ??
    (typeof styleH === "number" ? styleH : undefined) ??
    DEFAULT_H;
  return { w, h };
}

export function normalizeRect(a: Point, b: Point): FlowRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function rectMeaningful(r: FlowRect, min = 12): boolean {
  return r.w >= min && r.h >= min;
}

export function nodeIntersectsRect(node: Node<ComponentData>, r: FlowRect): boolean {
  const { w, h } = nodeSize(node);
  const nx = node.position.x;
  const ny = node.position.y;
  return nx + w >= r.x && nx <= r.x + r.w && ny + h >= r.y && ny <= r.y + r.h;
}

export function nodesInRect(nodes: Node<ComponentData>[], r: FlowRect): string[] {
  return nodes.filter((n) => nodeIntersectsRect(n, r)).map((n) => n.id);
}

/**
 * Fraction of the node's axis-aligned box that lies inside `r` (0..1).
 * Used for copy-marquee: only include parts covered ≥ ~70%.
 */
export function nodeCoverageInRect(node: Node<ComponentData>, r: FlowRect): number {
  const { w, h } = nodeSize(node);
  if (w <= 0 || h <= 0) return 0;
  const nx = node.position.x;
  const ny = node.position.y;
  const ix0 = Math.max(nx, r.x);
  const iy0 = Math.max(ny, r.y);
  const ix1 = Math.min(nx + w, r.x + r.w);
  const iy1 = Math.min(ny + h, r.y + r.h);
  const iw = ix1 - ix0;
  const ih = iy1 - iy0;
  if (iw <= 0 || ih <= 0) return 0;
  return (iw * ih) / (w * h);
}

/** Node ids whose box is covered by at least `minCoverage` of `r`. */
export function nodesCoveredByRect(
  nodes: Node<ComponentData>[],
  r: FlowRect,
  minCoverage = 0.7,
): string[] {
  return nodes
    .filter((n) => nodeCoverageInRect(n, r) + 1e-9 >= minCoverage)
    .map((n) => n.id);
}

/** Length-weighted fraction of an edge polyline that lies inside `r` (0..1). */
export function edgeCoverageInRect(
  nodes: Node<ComponentData>[],
  edge: Edge,
  r: FlowRect,
): number {
  const poly = computeEdgePolyline(nodes, edge);
  if (poly.length < 2) return 0;
  let total = 0;
  let inside = 0;
  const pointIn = (p: Point) =>
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    total += len;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const hits = [a, mid, b].filter(pointIn).length;
    inside += len * (hits / 3);
  }
  return total <= 0 ? 0 : inside / total;
}

/** Edge ids whose polyline is covered by at least `minCoverage` of `r`. */
export function edgesCoveredByRect(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  r: FlowRect,
  minCoverage = 0.7,
): string[] {
  return edges
    .filter((e) => edgeCoverageInRect(nodes, e, r) + 1e-9 >= minCoverage)
    .map((e) => e.id);
}

export function grabSideFromPoint(node: Node<ComponentData>, p: Point): PinSide {
  const { w, h } = nodeSize(node);
  const left = node.position.x;
  const top = node.position.y;
  const right = left + w;
  const bottom = top + h;
  const scores: { side: PinSide; d: number }[] = [
    { side: "left", d: Math.abs(p.x - left) },
    { side: "right", d: Math.abs(p.x - right) },
    { side: "top", d: Math.abs(p.y - top) },
    { side: "bottom", d: Math.abs(p.y - bottom) },
  ];
  scores.sort((a, b) => a.d - b.d);
  return scores[0]!.side;
}

function makeTip(
  tipId: string,
  at: Point,
  opts: { selected: boolean; moveAnchor?: boolean },
): Node<ComponentData> {
  return {
    id: tipId,
    type: "component",
    position: { x: at.x, y: at.y - TIP_SIZE / 2 },
    data: {
      kind: "TIP" as const,
      refdes: "",
      params: opts.moveAnchor ? { moveAnchor: "1" } : {},
    },
    style: { width: TIP_SIZE, height: TIP_SIZE },
    selected: opts.selected,
    draggable: false,
  };
}

export type CutMoveResult = {
  nodes: Node<ComponentData>[];
  edges: Edge[];
  /** Part + riding tip ids to translate while dragging. */
  moveIds: string[];
  didCut: boolean;
  cutCount: number;
};

/**
 * LTspice Move detach for one part — "move the part only".
 *
 * Every wire touching the part is disconnected from it and frozen exactly where
 * it is: the part-side endpoint becomes a TIP placed at that pin's current world
 * position, and the wire keeps all its bends. Only the part itself is moved
 * (moveIds = [part]); no wire rides along or reshapes.
 *
 * After this, the part is NOT connected to R1/GND/etc. — the old wires remain in
 * place as dangling stubs (reconnect by dropping the part back onto them).
 */
export function detachPartForMove(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  partId: string,
  newId: () => string,
  _grabPoint?: Point,
): CutMoveResult {
  const part = nodes.find((n) => n.id === partId);
  if (!part || part.data.kind === "TIP") {
    return { nodes, edges, moveIds: [partId], didCut: false, cutCount: 0 };
  }

  const connected = edges.filter(
    (e) => e.source === partId || e.target === partId,
  );

  const nextNodes: Node<ComponentData>[] = nodes.map((n) => ({
    ...n,
    selected: n.id === partId,
  }));

  if (!connected.length) {
    return { nodes: nextNodes, edges, moveIds: [partId], didCut: false, cutCount: 0 };
  }

  // Pin's current world point; the freezing tip sits exactly here so the wire
  // does not shift by a single pixel when the part leaves.
  const pinAt = (handle: string | null | undefined): Point =>
    (handle ? pinWorldPoint(part, handle) : null) ?? snapPoint(part.position);

  const removeIds = new Set(connected.map((e) => e.id));
  const nextEdges: Edge[] = edges.filter((e) => !removeIds.has(e.id));
  let serial = 0;

  for (const edge of connected) {
    // Snapshot the wire's CURRENT rendered path (interior bends) before cutting.
    // A plain pin↔pin wire routes with side-aware stubs, but a tip wire routes
    // plainly — so bake the existing geometry into explicit waypoints, else the
    // wire would shift slightly when it becomes a stub.
    const poly = computeEdgePolyline(nodes, edge);
    const frozenWaypoints = poly.length > 2 ? poly.slice(1, -1) : [];

    let source = edge.source;
    let sourceHandle = edge.sourceHandle;
    let target = edge.target;
    let targetHandle = edge.targetHandle;

    if (edge.source === partId) {
      const tipId = newId();
      nextNodes.push(
        makeTip(tipId, pinAt(edge.sourceHandle), { selected: false, moveAnchor: true }),
      );
      source = tipId;
      sourceHandle = "t";
    }
    if (edge.target === partId) {
      const tipId = newId();
      nextNodes.push(
        makeTip(tipId, pinAt(edge.targetHandle), { selected: false, moveAnchor: true }),
      );
      target = tipId;
      targetHandle = "t";
    }

    nextEdges.push({
      ...edge,
      id: `${edge.id}-detach-${serial}`,
      type: "schematic",
      source,
      sourceHandle,
      target,
      targetHandle,
      // Freeze the exact pre-cut path. directPath stops tip-routing from
      // stacking another stub on top (that was the parallel/distorted wires).
      data: { waypoints: frozenWaypoints, directPath: true },
      selected: false,
    });
    serial++;
  }

  return {
    nodes: nextNodes,
    edges: nextEdges,
    moveIds: [partId],
    didCut: true,
    cutCount: connected.length,
  };
}

/** @deprecated use detachPartForMove — kept for marquee box select */
export function severWiresLeaving(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  insideIds: Set<string>,
  newId: () => string,
  opts: { grabNodeId?: string; grabPoint?: Point } = {},
): CutMoveResult & { selectIds: string[] } {
  const id = opts.grabNodeId ?? [...insideIds][0];
  if (!id) {
    return { nodes, edges, moveIds: [], selectIds: [], didCut: false, cutCount: 0 };
  }
  const r = detachPartForMove(nodes, edges, id, newId, opts.grabPoint);
  return { ...r, selectIds: r.moveIds };
}

export function applyCutMove(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  rect: FlowRect,
  newId: () => string,
): CutMoveResult & { selectIds: string[] } {
  const ids = nodesInRect(nodes, rect).filter((id) => {
    const n = nodes.find((x) => x.id === id);
    return n && n.data.kind !== "TIP";
  });
  if (!ids.length) {
    return { nodes, edges, moveIds: [], selectIds: [], didCut: false, cutCount: 0 };
  }
  // Detach each part in the box (last wins selection); wires between two
  // boxed parts are handled as each is detached.
  let ns = nodes;
  let es = edges;
  let moveIds: string[] = [];
  let cutCount = 0;
  for (const id of ids) {
    const r = detachPartForMove(ns, es, id, newId);
    ns = r.nodes;
    es = r.edges;
    moveIds = [...new Set([...moveIds, ...r.moveIds])];
    cutCount += r.cutCount;
  }
  const selectSet = new Set(ids);
  return {
    nodes: ns.map((n) => ({ ...n, selected: selectSet.has(n.id) || (n.data.kind === "TIP" && n.selected) })),
    edges: es,
    moveIds,
    selectIds: moveIds,
    didCut: cutCount > 0,
    cutCount,
  };
}

/**
 * After parts are dropped, attach nearby dangling wire ends (TIP) back onto
 * pins — restoring the netlist. The part stays where the user dropped it;
 * wires stretch to the pin instead of yanking the symbol onto the stub.
 *
 * Only degree-1 free tips are eligible. Junction tips (2+ edges) must never be
 * consumed here: picking the wrong edge on a T-junction rewires the rail.
 *
 * `nodes` must already carry the parts' final (dropped) positions.
 */
export function reconnectPartsOnTips(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  movedIds: string[],
  /** Attach if a stub is this close; part position is not changed. */
  radius = 16,
): { nodes: Node<ComponentData>[]; edges: Edge[]; reconnected: number } {
  let nextNodes = nodes;
  let nextEdges = edges;
  let reconnected = 0;

  const tipConnect = (n: Node<ComponentData>): Point => ({
    x: n.position.x,
    y: n.position.y + TIP_SIZE / 2,
  });

  const tipDegree = (tipId: string, list: Edge[]) =>
    list.reduce(
      (n, e) => n + (e.source === tipId || e.target === tipId ? 1 : 0),
      0,
    );

  const tipAlreadyOnPart = (tipId: string, partId: string, list: Edge[]) =>
    list.some(
      (e) =>
        (e.source === tipId && e.target === partId) ||
        (e.target === tipId && e.source === partId),
    );

  const attachTip = (partId: string, pinId: string, tipId: string): boolean => {
    const edge = nextEdges.find((e) => e.source === tipId || e.target === tipId);
    if (!edge) return false;
    const tipIsSource = edge.source === tipId;
    const otherId = tipIsSource ? edge.target : edge.source;
    if (otherId === partId) return false;
    nextEdges = nextEdges.map((e) =>
      e.id === edge.id
        ? tipIsSource
          ? {
              ...e,
              source: partId,
              sourceHandle: pinId,
              // Clean ortho L — stub routing (directPath:false) jogged Move reconnects.
              data: { ...(e.data as object), waypoints: [], directPath: true },
            }
          : {
              ...e,
              target: partId,
              targetHandle: pinId,
              data: { ...(e.data as object), waypoints: [], directPath: true },
            }
        : e,
    );
    nextNodes = nextNodes.filter((n) => n.id !== tipId);
    return true;
  };

  for (const id of movedIds) {
    const part0 = nextNodes.find((n) => n.id === id);
    if (!part0 || part0.data.kind === "TIP") continue;
    const spec = COMPONENT_SPECS[part0.data.kind];
    const consumed = new Set<string>();
    const singlePin = spec.pins.length === 1;

    for (const pin of spec.pins) {
      // Never stack a second wire on a pin that is already connected.
      const pinBusy = nextEdges.some(
        (e) =>
          (e.source === id && e.sourceHandle === pin.id) ||
          (e.target === id && e.targetHandle === pin.id),
      );
      if (pinBusy) continue;

      const pinPt = pinWorldPoint(part0, pin.id);
      if (!pinPt) continue;

      const nearby: { tipId: string; d: number; t: Point }[] = [];
      for (const n of nextNodes) {
        if (n.data.kind !== "TIP" || consumed.has(n.id)) continue;
        if (tipDegree(n.id, nextEdges) !== 1) continue;
        if (tipAlreadyOnPart(n.id, id, nextEdges)) continue;
        const t = tipConnect(n);
        const d = Math.hypot(t.x - pinPt.x, t.y - pinPt.y);
        if (d <= radius) nearby.push({ tipId: n.id, d, t });
      }
      if (!nearby.length) continue;
      nearby.sort((a, b) => a.d - b.d);

      const pick = singlePin
        ? nearby
        : nearby.filter((c) => {
            const closest = nearby[0]!;
            return (
              c.tipId === closest.tipId ||
              Math.hypot(c.t.x - closest.t.x, c.t.y - closest.t.y) <= 3
            );
          });

      for (const c of pick) {
        if (consumed.has(c.tipId)) continue;
        if (attachTip(id, pin.id, c.tipId)) {
          consumed.add(c.tipId);
          reconnected++;
        } else {
          consumed.add(c.tipId);
        }
      }
    }
  }

  if (!reconnected) return { nodes, edges, reconnected: 0 };
  const pruned = pruneOrphanTips(nextNodes, nextEdges);
  return { nodes: pruned.nodes, edges: pruned.edges, reconnected };
}

const tipConnect = (n: Node<ComponentData>): Point => ({
  x: n.position.x,
  y: n.position.y + TIP_SIZE / 2,
});

/**
 * Inverse of detachWireForMove: when a free wire (TIP ends) is dropped near
 * real pins, snap those ends back onto the pins and restore the netlist.
 */
export function reconnectTipsOnPins(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  movedIds: string[],
  radius = 20,
): { nodes: Node<ComponentData>[]; edges: Edge[]; reconnected: number } {
  let nextNodes = nodes;
  let nextEdges = edges;
  let reconnected = 0;

  for (const id of movedIds) {
    const tip = nextNodes.find((n) => n.id === id);
    if (!tip || tip.data.kind !== "TIP") continue;
    const t = tipConnect(tip);
    let best: { partId: string; pinId: string; d: number } | null = null;
    for (const part of nextNodes) {
      if (part.data.kind === "TIP") continue;
      for (const pin of getComponentPins(part.data.kind, part.data.params)) {
        const pt = pinWorldPoint(part, pin.id);
        if (!pt) continue;
        const d = Math.hypot(pt.x - t.x, pt.y - t.y);
        if (d <= radius && (!best || d < best.d)) {
          best = { partId: part.id, pinId: pin.id, d };
        }
      }
    }
    if (!best) continue;
    const edge = nextEdges.find((e) => e.source === tip.id || e.target === tip.id);
    if (!edge) continue;
    const tipIsSource = edge.source === tip.id;
    const otherId = tipIsSource ? edge.target : edge.source;
    const otherHandle = tipIsSource ? edge.targetHandle : edge.sourceHandle;
    if (otherId === best.partId && otherHandle === best.pinId) continue;
    nextEdges = nextEdges.map((e) =>
      e.id === edge.id
        ? tipIsSource
          ? {
              ...e,
              source: best!.partId,
              sourceHandle: best!.pinId,
              data: { ...(e.data as object), waypoints: [], directPath: true },
            }
          : {
              ...e,
              target: best!.partId,
              targetHandle: best!.pinId,
              data: { ...(e.data as object), waypoints: [], directPath: true },
            }
        : e,
    );
    nextNodes = nextNodes.filter((n) => n.id !== tip.id);
    reconnected++;
  }

  if (!reconnected) return { nodes, edges, reconnected: 0 };
  const pruned = pruneOrphanTips(nextNodes, nextEdges);
  return { nodes: pruned.nodes, edges: pruned.edges, reconnected };
}
