import type { Edge, Node } from "@xyflow/react";
import { addEdge } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import { rotatePinSpec } from "../model/rotation";

/** Resolve refdes (or GND/ground/0) to a graph node. */
export function findNodeByRefdes(
  nodes: Node<ComponentData>[],
  refdes: string,
): Node<ComponentData> | undefined {
  const want = refdes.trim().toUpperCase();
  if (!want) return undefined;
  if (want === "GND" || want === "GROUND" || want === "0" || want === "EARTH") {
    return nodes.find((n) => n.data.kind === "GND");
  }
  return nodes.find((n) => n.data.refdes.toUpperCase() === want);
}

export function pinExists(node: Node<ComponentData>, pinId: string): boolean {
  return COMPONENT_SPECS[node.data.kind].pins.some((p) => p.id === pinId);
}

/** Prefer outgoing (right/bottom) for "from", incoming (left/top) for "to". */
export function defaultPin(node: Node<ComponentData>, role: "from" | "to"): string {
  const pins = COMPONENT_SPECS[node.data.kind].pins.map((p) =>
    rotatePinSpec(p, node.data.rotation),
  );
  if (node.data.kind === "GND") return pins[0]?.id ?? "g";
  if (role === "from") {
    return (
      pins.find((p) => p.side === "right")?.id ??
      pins.find((p) => p.side === "bottom")?.id ??
      pins[pins.length - 1]?.id ??
      "a"
    );
  }
  return (
    pins.find((p) => p.side === "left")?.id ??
    pins.find((p) => p.side === "top")?.id ??
    pins[0]?.id ??
    "a"
  );
}

function sameWire(
  e: Edge,
  aId: string,
  aPin: string,
  bId: string,
  bPin: string,
): boolean {
  const fwd =
    e.source === aId &&
    e.sourceHandle === aPin &&
    e.target === bId &&
    e.targetHandle === bPin;
  const rev =
    e.source === bId &&
    e.sourceHandle === bPin &&
    e.target === aId &&
    e.targetHandle === aPin;
  return Boolean(fwd || rev);
}

export function alreadyConnected(
  edges: Edge[],
  aId: string,
  aPin: string,
  bId: string,
  bPin: string,
): boolean {
  return edges.some((e) => sameWire(e, aId, aPin, bId, bPin));
}

/** Apply a connect between two resolved endpoints. Returns new edges (or same). */
export function connectEndpoints(
  edges: Edge[],
  a: Node<ComponentData>,
  aPin: string,
  b: Node<ComponentData>,
  bPin: string,
): Edge[] {
  if (!pinExists(a, aPin) || !pinExists(b, bPin)) return edges;
  if (a.id === b.id && aPin === bPin) return edges;
  if (alreadyConnected(edges, a.id, aPin, b.id, bPin)) return edges;
  const id = `${a.id}${aPin}-${b.id}${bPin}`;
  return addEdge(
    {
      id,
      type: "step",
      source: a.id,
      sourceHandle: aPin,
      target: b.id,
      targetHandle: bPin,
    },
    edges,
  );
}

/** Remove wire(s). If only `a` given, strip all edges on that component (or pin). */
export function disconnectEndpoints(
  edges: Edge[],
  a: Node<ComponentData>,
  aPin: string | undefined,
  b: Node<ComponentData> | undefined,
  bPin: string | undefined,
): Edge[] {
  if (b && aPin && bPin) {
    return edges.filter((e) => !sameWire(e, a.id, aPin, b.id, bPin));
  }
  if (b) {
    return edges.filter(
      (e) =>
        !(
          (e.source === a.id && e.target === b.id) ||
          (e.source === b.id && e.target === a.id)
        ),
    );
  }
  if (aPin) {
    return edges.filter(
      (e) =>
        !(
          (e.source === a.id && e.sourceHandle === aPin) ||
          (e.target === a.id && e.targetHandle === aPin)
        ),
    );
  }
  return edges.filter((e) => e.source !== a.id && e.target !== a.id);
}

/** Human label for assistant context: "R1.b" or "GND.g". */
export function endpointLabel(node: Node<ComponentData>, pinId: string): string {
  const ref = node.data.refdes || (node.data.kind === "GND" ? "GND" : node.id);
  return `${ref}.${pinId}`;
}
