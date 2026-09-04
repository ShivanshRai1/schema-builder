import type { Edge, Node } from "@xyflow/react";
import type { ComponentData, ComponentKind } from "./types";
import { COMPONENT_SPECS } from "./componentSpecs";
import { getSymbolLayout } from "../nodes/symbols/layout";
import { snapPoint, type Point } from "../wiring/orthogonal";
import { nextLabelRotation, nextRotation } from "./rotation";

export type CircuitClipboard = {
  nodes: Node<ComponentData>[];
  edges: Edge[];
};

export function clipGroupOrigin(nodes: Node<ComponentData>[]): Point {
  let minX = Infinity;
  let minY = Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0 };
  return { x: minX, y: minY };
}

function nodeBox(n: Node<ComponentData>): { w: number; h: number } {
  if (n.data.kind === "TIP") return { w: 0, h: 0 };
  return getSymbolLayout(n.data.kind, n.data.rotation) ?? { w: 48, h: 48 };
}

/** 90° clockwise in screen space (y down). */
function rotatePointCw(p: Point, cx: number, cy: number): Point {
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx - dy, y: cy + dx };
}

/** Rotate a copied group 90° CW about its box center (ghost + paste share this). */
export function rotateClipboardCw(clip: CircuitClipboard, grid: number): CircuitClipboard {
  if (!clip.nodes.length) return clip;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of clip.nodes) {
    const box = nodeBox(n);
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + box.w);
    maxY = Math.max(maxY, n.position.y + box.h);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const nodes = clip.nodes.map((n) => {
    const oldBox = nodeBox(n);
    const center = rotatePointCw(
      { x: n.position.x + oldBox.w / 2, y: n.position.y + oldBox.h / 2 },
      cx,
      cy,
    );
    const rotation =
      n.data.kind === "TIP"
        ? n.data.rotation
        : n.data.kind === "WIRELABEL"
          ? nextLabelRotation(n.data.rotation)
          : nextRotation(n.data.rotation);
    const newBox =
      n.data.kind === "TIP"
        ? oldBox
        : (getSymbolLayout(n.data.kind, rotation) ?? oldBox);
    return {
      ...n,
      position: snapPoint(
        { x: center.x - newBox.w / 2, y: center.y - newBox.h / 2 },
        grid,
      ),
      data: { ...n.data, params: { ...n.data.params }, rotation },
    };
  });
  const edges = clip.edges.map((e) => {
    const data = (e.data ?? {}) as { waypoints?: Point[] };
    const waypoints = (data.waypoints ?? []).map((p) =>
      snapPoint(rotatePointCw(p, cx, cy), grid),
    );
    return { ...e, data: { ...data, waypoints } };
  });
  return { nodes, edges };
}

function occupancyKey(x: number, y: number): string {
  return `${Math.round(x)},${Math.round(y)}`;
}

/** Occupied top-left cells of real parts (not wire tips). */
export function partOccupancy(nodes: Node<ComponentData>[]): Set<string> {
  const keys = new Set<string>();
  for (const n of nodes) {
    if (n.data.kind === "TIP") continue;
    keys.add(occupancyKey(n.position.x, n.position.y));
  }
  return keys;
}

/** Grid step large enough that another copy of this group does not sit under the ink. */
function clipNudgeStep(clip: CircuitClipboard, grid: number): Point {
  const base = clipGroupOrigin(clip.nodes);
  let w = grid;
  let h = grid;
  for (const n of clip.nodes) {
    if (n.data.kind === "TIP") continue;
    const lay = getSymbolLayout(n.data.kind, n.data.rotation) ?? { w: 48, h: 48 };
    w = Math.max(w, n.position.x - base.x + lay.w);
    h = Math.max(h, n.position.y - base.y + lay.h);
  }
  return {
    x: Math.max(grid, Math.ceil(w / grid) * grid),
    y: Math.max(grid, Math.ceil(h / grid) * grid),
  };
}

/**
 * Keep a rigid clipboard group off existing parts. Same click lands on an
 * occupied cell → step by the group footprint until the copies sit apart.
 */
export function nudgeOriginOffOccupants(
  clip: CircuitClipboard,
  origin: Point,
  occupied: Set<string>,
  grid: number,
): Point {
  const base = clipGroupOrigin(clip.nodes);
  const parts = clip.nodes.filter((n) => n.data.kind !== "TIP");
  const src = parts.length ? parts : clip.nodes;
  const rel = src.map((n) => ({
    x: n.position.x - base.x,
    y: n.position.y - base.y,
  }));
  const step = clipNudgeStep(clip, grid);
  const fits = (ox: number, oy: number) =>
    rel.every((p) => !occupied.has(occupancyKey(ox + p.x, oy + p.y)));
  if (fits(origin.x, origin.y)) return origin;
  for (let k = 1; k <= 64; k++) {
    const ox = origin.x + k * step.x;
    const oy = origin.y + k * step.y;
    if (fits(ox, oy)) return { x: ox, y: oy };
  }
  return { x: origin.x + 65 * step.x, y: origin.y + 65 * step.y };
}

export function instantiateClipboard(
  clip: CircuitClipboard,
  origin: Point,
  occupied: Set<string>,
  grid: number,
  newId: () => string,
  alloc: (kind: ComponentKind) => string,
): { nodes: Node<ComponentData>[]; edges: Edge[]; partIds: string[] } {
  const nudged = nudgeOriginOffOccupants(clip, origin, occupied, grid);
  const base = clipGroupOrigin(clip.nodes);
  const dx = nudged.x - base.x;
  const dy = nudged.y - base.y;
  const idMap = new Map<string, string>();
  const nodes = clip.nodes.map((n) => {
    const nid = newId();
    idMap.set(n.id, nid);
    const prefix = COMPONENT_SPECS[n.data.kind]?.refdesPrefix;
    return {
      ...n,
      id: nid,
      selected: true,
      position: { x: n.position.x + dx, y: n.position.y + dy },
      data: {
        ...n.data,
        params: { ...n.data.params },
        refdes: prefix ? alloc(n.data.kind) : n.data.refdes,
      },
    };
  });
  const edges = clip.edges.map((e) => {
    const data = (e.data ?? {}) as { waypoints?: Point[] };
    const waypoints = (data.waypoints ?? []).map((p) => ({
      x: p.x + dx,
      y: p.y + dy,
    }));
    return {
      ...e,
      id: `${idMap.get(e.source)}${e.sourceHandle}-${idMap.get(e.target)}${e.targetHandle}-${newId()}`,
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
      selected: false,
      data: { ...data, waypoints },
    };
  });
  return {
    nodes,
    edges,
    partIds: nodes.filter((n) => n.data.kind !== "TIP").map((n) => n.id),
  };
}
