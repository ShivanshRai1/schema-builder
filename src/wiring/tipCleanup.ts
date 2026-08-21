import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import { computeEdgePolyline } from "./wireGeometry";
import { collapseMicroBends } from "./wireMove";

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
 * Merge every degree-2 TIP into a single continuous edge so the mark goes away.
 */
export function collapsePassThroughTips(
  nodes: Node<ComponentData>[],
  edges: Edge[],
): { nodes: Node<ComponentData>[]; edges: Edge[]; merged: number } {
  let nextNodes = nodes;
  let nextEdges = edges;
  let merged = 0;
  let guard = 0;

  while (guard++ < 64) {
    const deg = tipDegree(nextEdges);
    const tip = nextNodes.find(
      (n) => n.data.kind === "TIP" && (deg.get(n.id) ?? 0) === 2,
    );
    if (!tip) break;

    const pair = nextEdges.filter((e) => e.source === tip.id || e.target === tip.id);
    if (pair.length !== 2) break;
    const e1 = pair[0]!;
    const e2 = pair[1]!;
    const a = otherEnd(e1, tip.id);
    const b = otherEnd(e2, tip.id);
    if (!a || !b || a.nodeId === tip.id || b.nodeId === tip.id) break;

    // Degenerate self-loop through tip — drop both edges + tip.
    if (a.nodeId === b.nodeId && a.handle === b.handle) {
      nextEdges = nextEdges.filter((e) => e.id !== e1.id && e.id !== e2.id);
      nextNodes = nextNodes.filter((n) => n.id !== tip.id);
      merged++;
      continue;
    }

    const poly1raw = computeEdgePolyline(nextNodes, e1);
    const poly2raw = computeEdgePolyline(nextNodes, e2);
    if (poly1raw.length < 2 || poly2raw.length < 2) break;

    const poly1 = orientPolyTowardTip(poly1raw, e1.source === tip.id);
    const poly2 = orientPolyFromTip(poly2raw, e2.source === tip.id);

    // A → … → tip → … → B (drop duplicate tip point at the join).
    const mergedPoly = collapseMicroBends([...poly1.slice(0, -1), ...poly2]);
    if (mergedPoly.length < 2) break;

    const waypoints =
      mergedPoly.length <= 2 ? [] : mergedPoly.slice(1, -1).map((p) => ({ ...p }));

    const newEdge: Edge = {
      id: `${a.nodeId}${a.handle}-${b.nodeId}${b.handle}`,
      type: "schematic",
      source: a.nodeId,
      sourceHandle: a.handle,
      target: b.nodeId,
      targetHandle: b.handle,
      data: { waypoints },
      selected: Boolean(e1.selected || e2.selected),
    };

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
