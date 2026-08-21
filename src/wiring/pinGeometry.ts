import type { Node } from "@xyflow/react";
import type { ComponentData, PinSpec } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import { getSymbolLayout } from "../nodes/symbols/layout";
import { normalizeRotation, rotatePinSpec } from "../model/rotation";
import { dist, type PinSide, type Point } from "./orthogonal";

/** Flow-space radius for magnetic connect (≈1.75 grid). */
export const PIN_SNAP_RADIUS = 28;

export type PinHit = {
  nodeId: string;
  pinId: string;
  point: Point;
};

/**
 * Nearest pin center to `cursor`, or null if none within maxDist.
 * Used so a near-miss click still completes a wire (false-connect fix).
 */
export function findNearestPin(
  nodes: Node<ComponentData>[],
  cursor: Point,
  opts?: {
    maxDist?: number;
    exclude?: { nodeId: string; pinId: string };
  },
): PinHit | null {
  const maxDist = opts?.maxDist ?? PIN_SNAP_RADIUS;
  let best: PinHit | null = null;
  let bestD = maxDist;
  for (const node of nodes) {
    const spec = COMPONENT_SPECS[node.data.kind];
    for (const pin of spec.pins) {
      if (
        opts?.exclude &&
        opts.exclude.nodeId === node.id &&
        opts.exclude.pinId === pin.id
      ) {
        continue;
      }
      const point = pinWorldPoint(node, pin.id);
      if (!point) continue;
      const d = dist(cursor, point);
      if (d <= bestD) {
        bestD = d;
        best = { nodeId: node.id, pinId: pin.id, point };
      }
    }
  }
  return best;
}

/**
 * Nearest pin of one part. Clicking the body (top of C1, etc.) must still
 * attach to a real pin — not drop a dangling tip on the outline.
 */
export function findNearestPinOnNode(
  node: Node<ComponentData>,
  cursor: Point,
  opts?: { exclude?: { nodeId: string; pinId: string } },
): PinHit | null {
  return findNearestPin([node], cursor, {
    maxDist: Number.POSITIVE_INFINITY,
    exclude: opts?.exclude,
  });
}

const DEFAULT_W = 92;
const DEFAULT_H = 54;

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

export function pinSpecForNode(node: Node<ComponentData>, pinId: string): PinSpec | null {
  const spec = COMPONENT_SPECS[node.data.kind];
  const base = spec.pins.find((p) => p.id === pinId);
  if (!base) return null;
  return rotatePinSpec(base, normalizeRotation(node.data.rotation));
}

/**
 * World-space pin center from node layout + rotation (not React Flow handleBounds).
 * Keeps wires glued to a/b after R even when RF internals lag.
 */
export function pinWorldPoint(node: Node<ComponentData>, pinId: string): Point | null {
  const pin = pinSpecForNode(node, pinId);
  if (!pin) return null;
  const { w, h } = nodeSize(node);
  // Prefer absolute pose when RF provides it (parented / internal nodes).
  const abs = (node as Node<ComponentData> & {
    internals?: { positionAbsolute?: { x: number; y: number } };
  }).internals?.positionAbsolute;
  const x = abs?.x ?? node.position.x;
  const y = abs?.y ?? node.position.y;
  switch (pin.side) {
    case "left":
      return { x, y: y + h * pin.offset };
    case "right":
      return { x: x + w, y: y + h * pin.offset };
    case "top":
      return { x: x + w * pin.offset, y };
    case "bottom":
      return { x: x + w * pin.offset, y: y + h };
  }
}

export function pinWorldSide(node: Node<ComponentData>, pinId: string): PinSide | null {
  return pinSpecForNode(node, pinId)?.side ?? null;
}

/**
 * Nudge a proposed part position so its pins line up with a nearby peer's pins
 * (e.g. stack V2 on V1's column/row). Threshold is flow units.
 */
export function snapPositionToPeerPins(
  nodes: Node<ComponentData>[],
  movingId: string,
  position: Point,
  threshold = 10,
): Point {
  const moving = nodes.find((n) => n.id === movingId);
  if (!moving || moving.data.kind === "TIP") return position;
  const ghost: Node<ComponentData> = { ...moving, position };
  const pins = COMPONENT_SPECS[moving.data.kind].pins;
  let bestX: number | null = null;
  let bestY: number | null = null;
  let bestXd = threshold;
  let bestYd = threshold;

  for (const pin of pins) {
    const pt = pinWorldPoint(ghost, pin.id);
    if (!pt) continue;
    for (const other of nodes) {
      if (other.id === movingId || other.data.kind === "TIP") continue;
      for (const op of COMPONENT_SPECS[other.data.kind].pins) {
        const ot = pinWorldPoint(other, op.id);
        if (!ot) continue;
        const dx = Math.abs(ot.x - pt.x);
        const dy = Math.abs(ot.y - pt.y);
        if (dx < bestXd) {
          bestXd = dx;
          bestX = position.x + (ot.x - pt.x);
        }
        if (dy < bestYd) {
          bestYd = dy;
          bestY = position.y + (ot.y - pt.y);
        }
      }
    }
  }
  return {
    x: bestX ?? position.x,
    y: bestY ?? position.y,
  };
}
