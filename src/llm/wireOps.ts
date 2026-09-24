import type { Edge, Node } from "@xyflow/react";
import { addEdge } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import { COMPONENT_SPECS, getComponentPins, isGroundKind } from "../model/componentSpecs";
import { rotatePinSpec } from "../model/rotation";
import { extractNets } from "../netlist/nets";

/** Resolve refdes (or GND/ground/0) to a graph node. Also matches XD1 ↔ D1. */
export function findNodeByRefdes(
  nodes: Node<ComponentData>[],
  refdes: string,
): Node<ComponentData> | undefined {
  const want = refdes.trim().toUpperCase();
  if (!want) return undefined;
  if (want === "GND" || want === "GROUND" || want === "0" || want === "EARTH") {
    return nodes.find((n) => isGroundKind(n.data.kind));
  }
  const direct = nodes.find((n) => n.data.refdes.toUpperCase() === want);
  if (direct) return direct;
  // XD1 (netlist) ↔ D1 (schematic)
  if (want.startsWith("X") && want.length > 1) {
    const base = want.slice(1);
    const byBase = nodes.find((n) => n.data.refdes.toUpperCase() === base);
    if (byBase) return byBase;
  }
  // Net-label / wire-label by name
  const byLabel = nodes.find((n) => {
    if (n.data.kind !== "NODE" && n.data.kind !== "WIRELABEL") return false;
    return String(n.data.params.name ?? "").trim().toUpperCase() === want;
  });
  if (byLabel) return byLabel;
  return nodes.find((n) => {
    const rd = n.data.refdes.toUpperCase();
    return rd === `X${want}` || (rd.startsWith("X") && rd.slice(1) === want);
  });
}

export function pinExists(node: Node<ComponentData>, pinId: string): boolean {
  return getComponentPins(node.data.kind, node.data.params).some((p) => p.id === pinId);
}

/** Prefer outgoing (right/bottom) for "from", incoming (left/top) for "to". */
export function defaultPin(node: Node<ComponentData>, role: "from" | "to"): string {
  const pins = getComponentPins(node.data.kind, node.data.params).map((p) =>
    rotatePinSpec(p, node.data.rotation),
  );
  if (isGroundKind(node.data.kind)) {
    return pins[0]?.id ?? "g";
  }
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

export type ResolvedEndpoint = { node: Node<ComponentData>; pin: string };

function isDiodeLike(kind: string): boolean {
  return (
    kind === "D" ||
    kind === "DZ" ||
    kind === "DS" ||
    kind === "LED" ||
    kind === "DTVS" ||
    kind === "DTVSBI"
  );
}

/**
 * Pick any real (non-TIP) pin already on a named/numbered net so connectPins
 * can attach to that electrical node.
 */
export function findPinOnNet(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  netName: string,
): ResolvedEndpoint | null {
  const want = netName.trim();
  if (!want) return null;
  const nets = extractNets(nodes, edges);
  const wantU = want.toUpperCase();
  const candidates: ResolvedEndpoint[] = [];
  for (const n of nodes) {
    if (n.data.kind === "TIP") continue;
    for (const pin of getComponentPins(n.data.kind, n.data.params)) {
      const net = nets.netOf(n.id, pin.id);
      if (net === want || net.toUpperCase() === wantU) {
        candidates.push({ node: n, pin: pin.id });
      }
    }
  }
  if (!candidates.length) return null;
  // Prefer diode/TVS pins (load-dump "mid"), then any emitting part, then labels.
  const scored = candidates
    .map((c) => {
      const k = c.node.data.kind;
      let s = 0;
      if (isDiodeLike(k)) s += 50;
      if (COMPONENT_SPECS[k]?.emits) s += 20;
      if (k === "NODE" || k === "WIRELABEL") s += 5;
      if (isGroundKind(k)) s -= 100;
      return { c, s };
    })
    .sort((a, b) => b.s - a.s);
  return scored[0]!.c;
}

/**
 * Heuristic "mid" / clamp junction: shared non-ground net between D1 and D2
 * (or the first two diode-like parts). Falls back to the busiest non-0 net.
 */
export function findMidNetEndpoint(
  nodes: Node<ComponentData>[],
  edges: Edge[],
): ResolvedEndpoint | null {
  const nets = extractNets(nodes, edges);
  const diodes = nodes.filter((n) => isDiodeLike(n.data.kind) && n.data.refdes);
  const d1 =
    diodes.find((n) => /^d1$/i.test(n.data.refdes)) ??
    diodes.find((n) => /^x1$/i.test(n.data.refdes)) ??
    diodes[0];
  const d2 =
    diodes.find((n) => n.id !== d1?.id && /^d2$/i.test(n.data.refdes)) ??
    diodes.find((n) => n.id !== d1?.id && /^x2$/i.test(n.data.refdes)) ??
    diodes.find((n) => n.id !== d1?.id) ??
    null;

  if (d1 && d2) {
    const d1Nets = new Set(
      getComponentPins(d1.data.kind, d1.data.params).map((p) =>
        nets.netOf(d1.id, p.id),
      ),
    );
    for (const pin of getComponentPins(d2.data.kind, d2.data.params)) {
      const net = nets.netOf(d2.id, pin.id);
      if (net !== "0" && d1Nets.has(net)) {
        return { node: d2, pin: pin.id };
      }
    }
  }

  const degree = new Map<string, number>();
  for (const n of nodes) {
    if (n.data.kind === "TIP") continue;
    for (const pin of getComponentPins(n.data.kind, n.data.params)) {
      const net = nets.netOf(n.id, pin.id);
      if (net === "0") continue;
      degree.set(net, (degree.get(net) ?? 0) + 1);
    }
  }
  let bestNet: string | null = null;
  let bestDeg = 0;
  for (const [net, deg] of degree) {
    if (deg > bestDeg) {
      bestDeg = deg;
      bestNet = net;
    }
  }
  if (bestNet && bestDeg >= 2) return findPinOnNet(nodes, edges, bestNet);
  return null;
}

/**
 * Resolve a connect endpoint token: R1 / R1.b / GND / mid / net 3 / NET3 / label.
 */
export function resolveConnectEndpoint(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  refdesRaw: string,
  pinRaw?: string,
  role: "from" | "to" = "to",
): ResolvedEndpoint | null {
  const ref = refdesRaw.trim();
  if (!ref) return null;
  const refU = ref.toUpperCase().replace(/\s+/g, "");
  const pinHint = pinRaw?.trim().toLowerCase();

  /** Newest capacitor (C / CPOL / …) for “connect new capacitor …”. */
  if (/^(NEWC|NEWCAP|CAPACITOR|CAP)$/i.test(refU)) {
    const caps = nodes
      .filter((n) => {
        const pfx = COMPONENT_SPECS[n.data.kind]?.refdesPrefix;
        return pfx === "C" && n.data.refdes;
      })
      .sort((a, b) => {
        const na = parseInt(/(\d+)/.exec(a.data.refdes)?.[1] ?? "0", 10);
        const nb = parseInt(/(\d+)/.exec(b.data.refdes)?.[1] ?? "0", 10);
        return nb - na;
      });
    const newest = caps[0];
    if (newest) {
      return {
        node: newest,
        pin: pinHint && pinExists(newest, pinHint) ? pinHint : defaultPin(newest, role),
      };
    }
  }

  // Aliases for the series / clamp junction ("net mid").
  if (
    /^(MID|MIDDLE|MIDPOINT|JUNCTION|CLAMP|NETMID|NET_MID)$/i.test(refU) ||
    /^NET[\s_-]*MID$/i.test(ref)
  ) {
    const mid = findMidNetEndpoint(nodes, edges);
    if (mid) return mid;
  }

  // Explicit net number / name: "3", "NET3", "net 3"
  const netNum = /^(?:NET)?(\d+)$/i.exec(refU);
  if (netNum?.[1]) {
    const onNet = findPinOnNet(nodes, edges, netNum[1]);
    if (onNet) return onNet;
  }
  const netNamed = /^NET(.+)$/i.exec(refU);
  if (netNamed?.[1] && !/^\d+$/.test(netNamed[1])) {
    const onNet = findPinOnNet(nodes, edges, netNamed[1]);
    if (onNet) return onNet;
  }

  const node = findNodeByRefdes(nodes, ref);
  if (!node) {
    // Last chance: treat token as a netlist net name (named nets / labels).
    return findPinOnNet(nodes, edges, ref);
  }
  if (pinHint && pinExists(node, pinHint)) {
    return { node, pin: pinHint };
  }
  // NODE / WIRELABEL: single join pin is the net itself.
  if (node.data.kind === "NODE" || node.data.kind === "WIRELABEL") {
    const p = getComponentPins(node.data.kind, node.data.params)[0]?.id ?? "a";
    return { node, pin: p };
  }
  return { node, pin: defaultPin(node, role) };
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
      type: "schematic",
      source: a.id,
      sourceHandle: aPin,
      target: b.id,
      targetHandle: bPin,
      data: { waypoints: [] },
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
  const ref = node.data.refdes || (isGroundKind(node.data.kind) ? "GND" : node.id);
  return `${ref}.${pinId}`;
}
