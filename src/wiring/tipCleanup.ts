import type { Edge, Node } from "@xyflow/react";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import type { ComponentData } from "../model/types";
import { pinWorldPoint } from "./pinGeometry";
import type { Point } from "./orthogonal";
import { computeEdgePolyline, polylineToStoredWaypoints } from "./wireGeometry";
import { collapseMicroBends } from "./wireMove";

function polyLen(poly: Point[]): number {
  let n = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    n += Math.hypot(poly[i + 1]!.x - poly[i]!.x, poly[i + 1]!.y - poly[i]!.y);
  }
  return n;
}
/**
 * Remove TIP nodes that have no edges, and strip tip-edges attached to a
 * specific real pin so a new direct wire can replace the dangling stub.
 */
export function pruneOrphanTips(
  nodes: Node<ComponentData>[],
  edges: Edge[],
): { nodes: Node<ComponentData>[]; edges: Edge[] } {
  const used = new Set<string>();
  for (const e of edges) {
    used.add(e.source);
    used.add(e.target);
  }
  const nodesOut = nodes.filter((n) => n.data.kind !== "TIP" || used.has(n.id));
  const keep = new Set(nodesOut.map((n) => n.id));
  const edgesOut = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  return { nodes: nodesOut, edges: edgesOut };
}

/** True if this edge attaches a TIP to the given real pin. */
function isTipStubOnPin(
  e: Edge,
  nodesById: Map<string, Node<ComponentData>>,
  nodeId: string,
  handle: string,
): boolean {
  const src = nodesById.get(e.source);
  const tgt = nodesById.get(e.target);
  if (!src || !tgt) return false;
  if (e.source === nodeId && e.sourceHandle === handle && tgt.data.kind === "TIP") return true;
  if (e.target === nodeId && e.targetHandle === handle && src.data.kind === "TIP") return true;
  return false;
}

/**
 * Before connecting two real pins, remove any dangling TIP stubs already on
 * those pins (left behind by Move/Esc). Otherwise new wires look connected
 * while the graph still has tip fragments — and GND never rejoins net 0.
 */
export function clearTipStubsOnPins(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  pins: { nodeId: string; handle: string }[],
): { nodes: Node<ComponentData>[]; edges: Edge[] } {
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const tipsToDrop = new Set<string>();
  const edgesOut: Edge[] = [];

  for (const e of edges) {
    let drop = false;
    for (const p of pins) {
      if (isTipStubOnPin(e, nodesById, p.nodeId, p.handle)) {
        const tipId = e.source === p.nodeId ? e.target : e.source;
        tipsToDrop.add(tipId);
        drop = true;
        break;
      }
    }
    if (!drop) edgesOut.push(e);
  }

  if (!tipsToDrop.size) return { nodes, edges };

  const nodesOut = nodes.filter((n) => !tipsToDrop.has(n.id));
  return pruneOrphanTips(nodesOut, edgesOut);
}

/**
 * Free tips parked on a pin draw a hollow square that looks like an open pin.
 * - Pin free → absorb tip into the pin (real connection).
 * - Pin already wired → drop the ghost tip.
 */
export function absorbTipsOntoPins(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  radius = 8,
): { nodes: Node<ComponentData>[]; edges: Edge[]; changed: number } {
  let nextNodes = nodes;
  let nextEdges = edges;
  let changed = 0;

  const tipPt = (n: Node<ComponentData>): Point => ({
    x: n.position.x,
    y: n.position.y + ((n.style?.height as number | undefined) ?? 8) / 2,
  });

  let guard = 0;
  while (guard++ < 64) {
    const deg = tipDegree(nextEdges);
    let absorbed = false;

    for (const tip of nextNodes) {
      if (tip.data.kind !== "TIP") continue;
      if ((deg.get(tip.id) ?? 0) !== 1) continue;
      const t = tipPt(tip);
      const stub = nextEdges.find((e) => e.source === tip.id || e.target === tip.id);
      if (!stub) continue;

      let best: { partId: string; pinId: string; d: number } | null = null;
      for (const part of nextNodes) {
        if (part.data.kind === "TIP") continue;
        for (const pin of COMPONENT_SPECS[part.data.kind].pins) {
          const pt = pinWorldPoint(part, pin.id);
          if (!pt) continue;
          const d = Math.hypot(pt.x - t.x, pt.y - t.y);
          if (d <= radius && (!best || d < best.d)) {
            best = { partId: part.id, pinId: pin.id, d };
          }
        }
      }
      if (!best) continue;

      const tipIsSource = stub.source === tip.id;
      const otherId = tipIsSource ? stub.target : stub.source;
      if (otherId === best.partId) {
        // Degenerate tip looping onto its own part — just drop it.
        nextEdges = nextEdges.filter((e) => e.id !== stub.id);
        nextNodes = nextNodes.filter((n) => n.id !== tip.id);
        changed++;
        absorbed = true;
        break;
      }

      const pinAlreadyWired = nextEdges.some((e) => {
        if (e.id === stub.id) return false;
        return (
          (e.source === best!.partId && e.sourceHandle === best!.pinId) ||
          (e.target === best!.partId && e.targetHandle === best!.pinId)
        );
      });

      if (pinAlreadyWired) {
        nextEdges = nextEdges.filter((e) => e.id !== stub.id);
        nextNodes = nextNodes.filter((n) => n.id !== tip.id);
        changed++;
        absorbed = true;
        break;
      }

      nextEdges = nextEdges.map((e) =>
        e.id === stub.id
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
      changed++;
      absorbed = true;
      break;
    }

    if (!absorbed) break;
  }

  if (!changed) return { nodes, edges, changed: 0 };
  const pruned = pruneOrphanTips(nextNodes, nextEdges);
  return { nodes: pruned.nodes, edges: pruned.edges, changed };
}

/**
 * Remove free (deg-1) tips that sit on a real pin which already has a
 * non-tip wire. Those draw as hollow squares on GND/pins after Drag reconnect.
 */
export function pruneGhostTipsOnPins(
  nodes: Node<ComponentData>[],
  edges: Edge[],
): { nodes: Node<ComponentData>[]; edges: Edge[]; removed: number } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const deg = tipDegree(edges);
  const dropTips = new Set<string>();
  const dropEdges = new Set<string>();

  for (const tip of nodes) {
    if (tip.data.kind !== "TIP") continue;
    if ((deg.get(tip.id) ?? 0) !== 1) continue;
    const tipPt = {
      x: tip.position.x,
      y: tip.position.y + ((tip.style?.height as number | undefined) ?? 8) / 2,
    };
    const stub = edges.find((e) => e.source === tip.id || e.target === tip.id);
    if (!stub) continue;

    let ghost = false;
    for (const part of nodes) {
      if (part.data.kind === "TIP") continue;
      for (const pin of COMPONENT_SPECS[part.data.kind].pins) {
        const pt = pinWorldPoint(part, pin.id);
        if (!pt) continue;
        if (Math.hypot(pt.x - tipPt.x, pt.y - tipPt.y) > 3) continue;
        const pinHasReal = edges.some((e) => {
          const onPin =
            (e.source === part.id && e.sourceHandle === pin.id) ||
            (e.target === part.id && e.targetHandle === pin.id);
          if (!onPin) return false;
          if (e.id === stub.id) return false;
          const otherId = e.source === part.id ? e.target : e.source;
          const other = byId.get(otherId);
          return other != null && other.data.kind !== "TIP";
        });
        if (pinHasReal) {
          ghost = true;
          break;
        }
      }
      if (ghost) break;
    }
    if (!ghost) continue;
    dropTips.add(tip.id);
    dropEdges.add(stub.id);
  }

  if (!dropTips.size) return { nodes, edges, removed: 0 };
  const nextNodes = nodes.filter((n) => !dropTips.has(n.id));
  const nextEdges = edges.filter((e) => !dropEdges.has(e.id));
  const pruned = pruneOrphanTips(nextNodes, nextEdges);
  return { nodes: pruned.nodes, edges: pruned.edges, removed: dropTips.size };
}

function tipDegree(edges: Edge[]): Map<string, number> {
  const deg = new Map<string, number>();
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
  }
  return deg;
}

function otherEnd(
  e: Edge,
  tipId: string,
): { nodeId: string; handle: string } | null {
  if (e.source === tipId) {
    if (!e.targetHandle) return null;
    return { nodeId: e.target, handle: e.targetHandle };
  }
  if (e.target === tipId) {
    if (!e.sourceHandle) return null;
    return { nodeId: e.source, handle: e.sourceHandle };
  }
  return null;
}

function orientPolyTowardTip<T>(poly: T[], tipAtStart: boolean): T[] {
  if (poly.length < 2) return poly;
  return tipAtStart ? [...poly].reverse() : poly;
}

function orientPolyFromTip<T>(poly: T[], tipAtStart: boolean): T[] {
  if (poly.length < 2) return poly;
  return tipAtStart ? poly : [...poly].reverse();
}

/**
 * After deleting a branch off a mid-wire join, the rail is often left as
 * leftHalf—TIP—rightHalf (degree 2). That still draws a junction square.
 * Merge only *straight* pass-through tips (colinear H or V through the tip).
 *
 * Do NOT merge L-corners of free tip↔tip wires (deg 2 at a bend) — those are
 * intentional geometry. Collapsing them used to cascade into self-loop drops
 * and wipe almost an entire free-wire drawing on one scissors click.
 */
export function collapsePassThroughTips(
  nodes: Node<ComponentData>[],
  edges: Edge[],
): { nodes: Node<ComponentData>[]; edges: Edge[]; merged: number } {
  let nextNodes = nodes;
  let nextEdges = edges;
  let merged = 0;
  let guard = 0;
  const skipTips = new Set<string>();

  while (guard++ < 64) {
    const deg = tipDegree(nextEdges);
    const tip = nextNodes.find(
      (n) =>
        n.data.kind === "TIP" &&
        (deg.get(n.id) ?? 0) === 2 &&
        !skipTips.has(n.id),
    );
    if (!tip) break;

    const pair = nextEdges.filter((e) => e.source === tip.id || e.target === tip.id);
    if (pair.length !== 2) {
      skipTips.add(tip.id);
      continue;
    }
    const e1 = pair[0]!;
    const e2 = pair[1]!;
    const a = otherEnd(e1, tip.id);
    const b = otherEnd(e2, tip.id);
    if (!a || !b || a.nodeId === tip.id || b.nodeId === tip.id) {
      skipTips.add(tip.id);
      continue;
    }

    // Digon (two edges tip↔same end): keep the longer path, drop the shorter.
    // Never drop both — that wiped wires after tip-extend onto the same rail.
    if (a.nodeId === b.nodeId && a.handle === b.handle) {
      const p1 = computeEdgePolyline(nextNodes, e1);
      const p2 = computeEdgePolyline(nextNodes, e2);
      const dropId = polyLen(p1) >= polyLen(p2) ? e2.id : e1.id;
      nextEdges = nextEdges.filter((e) => e.id !== dropId);
      skipTips.add(tip.id);
      merged++;
      continue;
    }

    const poly1raw = computeEdgePolyline(nextNodes, e1);
    const poly2raw = computeEdgePolyline(nextNodes, e2);
    if (poly1raw.length < 2 || poly2raw.length < 2) {
      skipTips.add(tip.id);
      continue;
    }

    const poly1 = orientPolyTowardTip(poly1raw, e1.source === tip.id);
    const poly2 = orientPolyFromTip(poly2raw, e2.source === tip.id);

    // L-bend / tee corner: keep the tip. Only collapse a straight through-run.
    if (!isStraightPassThrough(poly1, poly2)) {
      skipTips.add(tip.id);
      continue;
    }

    // A → … → tip → … → B (drop duplicate tip point at the join).
    const mergedPoly = collapseMicroBends([...poly1.slice(0, -1), ...poly2]);
    if (mergedPoly.length < 2) {
      skipTips.add(tip.id);
      continue;
    }

    const newEdge: Edge = {
      id: `${a.nodeId}${a.handle}-${b.nodeId}${b.handle}`,
      type: "schematic",
      source: a.nodeId,
      sourceHandle: a.handle,
      target: b.nodeId,
      targetHandle: b.handle,
      data: { waypoints: [] },
      selected: Boolean(e1.selected || e2.selected),
    };
    const waypoints = polylineToStoredWaypoints(nextNodes, newEdge, mergedPoly);
    newEdge.data = { waypoints };

    if (nextEdges.some((e) => e.id === newEdge.id && e.id !== e1.id && e.id !== e2.id)) {
      newEdge.id = `${newEdge.id}-m${merged}`;
    }

    nextEdges = [
      ...nextEdges.filter((e) => e.id !== e1.id && e.id !== e2.id),
      newEdge,
    ];
    nextNodes = nextNodes.filter((n) => n.id !== tip.id);
    merged++;
  }

  const pruned = pruneOrphanTips(nextNodes, nextEdges);
  return { nodes: pruned.nodes, edges: pruned.edges, merged };
}

/** True when poly1 ends at tip and poly2 starts at tip on one straight H/V run. */
function isStraightPassThrough(poly1: Point[], poly2: Point[]): boolean {
  if (poly1.length < 2 || poly2.length < 2) return false;
  const tip = poly1[poly1.length - 1]!;
  const before = poly1[poly1.length - 2]!;
  const after = poly2[1]!;
  const h =
    Math.abs(before.y - tip.y) < 0.6 && Math.abs(after.y - tip.y) < 0.6;
  const v =
    Math.abs(before.x - tip.x) < 0.6 && Math.abs(after.x - tip.x) < 0.6;
  return h || v;
}

/**
 * Merge one tip only, and only if it is a straight pass-through.
 * Used after wire-draw partial/extend so we never scan the whole mesh.
 */
export function collapseOnePassThroughTip(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  tipId: string,
): { nodes: Node<ComponentData>[]; edges: Edge[]; merged: number } {
  const tip = nodes.find((n) => n.id === tipId);
  if (!tip || tip.data.kind !== "TIP") {
    return { nodes, edges, merged: 0 };
  }
  const deg = tipDegree(edges);
  if ((deg.get(tipId) ?? 0) !== 2) {
    return { nodes, edges, merged: 0 };
  }

  const pair = edges.filter((e) => e.source === tipId || e.target === tipId);
  if (pair.length !== 2) return { nodes, edges, merged: 0 };
  const e1 = pair[0]!;
  const e2 = pair[1]!;
  const a = otherEnd(e1, tipId);
  const b = otherEnd(e2, tipId);
  if (!a || !b || a.nodeId === tipId || b.nodeId === tipId) {
    return { nodes, edges, merged: 0 };
  }

  if (a.nodeId === b.nodeId && a.handle === b.handle) {
    // Digon: keep longer edge, never wipe both.
    const p1 = computeEdgePolyline(nodes, e1);
    const p2 = computeEdgePolyline(nodes, e2);
    const dropId = polyLen(p1) >= polyLen(p2) ? e2.id : e1.id;
    const nextEdges = edges.filter((e) => e.id !== dropId);
    return { nodes, edges: nextEdges, merged: 1 };
  }

  const poly1raw = computeEdgePolyline(nodes, e1);
  const poly2raw = computeEdgePolyline(nodes, e2);
  if (poly1raw.length < 2 || poly2raw.length < 2) {
    return { nodes, edges, merged: 0 };
  }

  const poly1 = orientPolyTowardTip(poly1raw, e1.source === tipId);
  const poly2 = orientPolyFromTip(poly2raw, e2.source === tipId);
  if (!isStraightPassThrough(poly1, poly2)) {
    return { nodes, edges, merged: 0 };
  }

  const mergedPoly = collapseMicroBends([...poly1.slice(0, -1), ...poly2]);
  if (mergedPoly.length < 2) return { nodes, edges, merged: 0 };

  const newEdge: Edge = {
    id: `${a.nodeId}${a.handle}-${b.nodeId}${b.handle}`,
    type: "schematic",
    source: a.nodeId,
    sourceHandle: a.handle,
    target: b.nodeId,
    targetHandle: b.handle,
    data: { waypoints: [] },
    selected: Boolean(e1.selected || e2.selected),
  };
  const waypoints = polylineToStoredWaypoints(nodes, newEdge, mergedPoly);
  newEdge.data = { waypoints };
  if (edges.some((e) => e.id === newEdge.id && e.id !== e1.id && e.id !== e2.id)) {
    newEdge.id = `${newEdge.id}-m1`;
  }

  const nextEdges = [
    ...edges.filter((e) => e.id !== e1.id && e.id !== e2.id),
    newEdge,
  ];
  const nextNodes = nodes.filter((n) => n.id !== tipId);
  const pruned = pruneOrphanTips(nextNodes, nextEdges);
  return { nodes: pruned.nodes, edges: pruned.edges, merged: 1 };
}
