import type { Edge, Node } from "@xyflow/react";
import type { ComponentData, ComponentKind } from "../model/types";
import { COMPONENT_SPECS, defaultParams } from "../model/componentSpecs";
import {
  extractParamsFromRest,
  inferKindFromRefdes,
  parseDeviceLines,
  splitNetsAndParams,
  spicePinOrder,
} from "./parseDeviceParams";

export interface ApplyNetlistResult {
  nodes: Node<ComponentData>[];
  edges: Edge[];
  updated: string[];
  added: string[];
  deleted: string[];
  /** True when device↔net connectivity was rebuilt from text. */
  rewired: boolean;
  /** Device lines we could not map to a known kind. */
  skippedUnknown: string[];
}

type Endpoint = { nodeId: string; pinId: string };

function mergeParams(
  kind: ComponentKind,
  current: Record<string, string>,
  paramTokens: string[],
): { params: Record<string, string>; changed: boolean } {
  const patch = extractParamsFromRest(kind, paramTokens);
  if (!Object.keys(patch).length) return { params: current, changed: false };
  const params = { ...current };
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (params[k] !== v) {
      params[k] = v;
      changed = true;
    }
  }
  return { params, changed };
}

function addEndpoint(
  map: Map<string, Endpoint[]>,
  net: string,
  nodeId: string,
  pinId: string,
) {
  const list = map.get(net) ?? [];
  if (!list.some((e) => e.nodeId === nodeId && e.pinId === pinId)) {
    list.push({ nodeId, pinId });
  }
  map.set(net, list);
}

/** Star-connect all pins that share a net name. */
function edgesFromNetMap(netToPins: Map<string, Endpoint[]>): Edge[] {
  const edges: Edge[] = [];
  let i = 0;
  for (const [net, pins] of netToPins) {
    if (pins.length < 2) continue;
    const hub = pins[0]!;
    for (let j = 1; j < pins.length; j++) {
      const p = pins[j]!;
      edges.push({
        id: `nl-${net}-${i++}`,
        type: "smoothstep",
        source: hub.nodeId,
        sourceHandle: hub.pinId,
        target: p.nodeId,
        targetHandle: p.pinId,
      });
    }
  }
  return edges;
}

/**
 * Full Step-2 apply: params (B) + add/delete (C) + rewire emitting devices (D).
 *
 * Preserves:
 * - Positions of existing nodes (by refdes)
 * - Non-emitting structural parts (GND, NODE, VSENSE, VPROBE)
 * - Old edges that touch VSENSE/VPROBE (they have no device lines)
 *
 * Does not run auto-layout for cold paste (new parts are flagged unplaced).
 */
export function applyNetlistToGraph(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  netlistText: string,
): ApplyNetlistResult {
  const devices = parseDeviceLines(netlistText);
  const updated: string[] = [];
  const added: string[] = [];
  const deleted: string[] = [];
  const skippedUnknown: string[] = [];

  const byRefdes = new Map<string, Node<ComponentData>>();
  for (const n of nodes) {
    if (n.data.refdes) byRefdes.set(n.data.refdes, n);
  }

  // --- Phase C: delete emitting nodes missing from text -------------------
  const textRefdes = new Set(devices.map((d) => d.refdes));
  const kept: Node<ComponentData>[] = [];
  for (const n of nodes) {
    const spec = COMPONENT_SPECS[n.data.kind];
    if (spec.emits && n.data.refdes && !textRefdes.has(n.data.refdes)) {
      deleted.push(n.data.refdes);
      continue;
    }
    kept.push(n);
  }

  byRefdes.clear();
  for (const n of kept) {
    if (n.data.refdes) byRefdes.set(n.data.refdes, n);
  }

  // --- Phase B + C: update existing / add new -----------------------------
  let working = [...kept];

  let nextIdNum = 0;
  for (const n of working) {
    const m = /^n(\d+)$/.exec(n.id);
    if (m) nextIdNum = Math.max(nextIdNum, Number(m[1]));
  }
  const allocId = () => `n${++nextIdNum}`;

  let maxX = 0;
  let minY = 120;
  for (const n of working) {
    maxX = Math.max(maxX, n.position.x);
    minY = Math.min(minY, n.position.y);
  }
  let addSlot = 0;

  const deviceNets = new Map<string, { kind: ComponentKind; nets: string[] }>();

  for (const device of devices) {
    const existing = byRefdes.get(device.refdes);
    const kind = inferKindFromRefdes(device.refdes, existing?.data.kind);
    if (!kind) {
      skippedUnknown.push(device.refdes);
      continue;
    }

    const split = splitNetsAndParams(kind, device.rest);
    if (!split) {
      skippedUnknown.push(device.refdes);
      continue;
    }

    deviceNets.set(device.refdes, { kind, nets: split.nets });

    if (existing) {
      const { params, changed } = mergeParams(
        kind,
        existing.data.params,
        split.paramTokens,
      );
      if (changed) {
        updated.push(device.refdes);
        working = working.map((n) =>
          n.id === existing.id
            ? { ...n, data: { ...n.data, params, unplaced: false } }
            : n,
        );
        byRefdes.set(device.refdes, working.find((n) => n.id === existing.id)!);
      }
    } else {
      const params = {
        ...defaultParams(kind),
        ...extractParamsFromRest(kind, split.paramTokens),
      };
      const node: Node<ComponentData> = {
        id: allocId(),
        type: "component",
        position: {
          x: maxX + 140 + (addSlot % 4) * 30,
          y: minY + (addSlot % 6) * 70,
        },
        data: {
          kind,
          refdes: device.refdes,
          params,
          unplaced: true,
        },
      };
      addSlot++;
      working = [...working, node];
      byRefdes.set(device.refdes, node);
      added.push(device.refdes);
    }
  }

  // --- Phase D: rebuild wires among emitting devices + GND + NODE --------
  const netToPins = new Map<string, Endpoint[]>();

  for (const [refdes, { kind, nets }] of deviceNets) {
    const node = byRefdes.get(refdes);
    if (!node) continue;
    const order = spicePinOrder(kind);
    const seenPins = new Set<string>();
    for (let i = 0; i < order.length && i < nets.length; i++) {
      const pinId = order[i]!;
      if (seenPins.has(pinId)) continue;
      seenPins.add(pinId);
      addEndpoint(netToPins, nets[i]!, node.id, pinId);
    }
  }

  for (const n of working) {
    if (n.data.kind === "GND") addEndpoint(netToPins, "0", n.id, "g");
    if (n.data.kind === "NODE" && n.data.params.name) {
      addEndpoint(netToPins, n.data.params.name, n.id, "g");
    }
  }

  const rebuilt = edgesFromNetMap(netToPins);

  const alive = new Set(working.map((n) => n.id));
  const kindOf = new Map(working.map((n) => [n.id, n.data.kind]));
  const preserved = edges.filter((e) => {
    if (!alive.has(e.source) || !alive.has(e.target)) return false;
    const sk = kindOf.get(e.source);
    const tk = kindOf.get(e.target);
    return sk === "VSENSE" || sk === "VPROBE" || tk === "VSENSE" || tk === "VPROBE";
  });

  const edgeKey = (e: Edge) =>
    `${e.source}:${e.sourceHandle ?? ""}-${e.target}:${e.targetHandle ?? ""}`;
  const seen = new Set(rebuilt.map(edgeKey));
  const extra = preserved.filter((e) => {
    const k = edgeKey(e);
    const rev = `${e.target}:${e.targetHandle ?? ""}-${e.source}:${e.sourceHandle ?? ""}`;
    if (seen.has(k) || seen.has(rev)) return false;
    seen.add(k);
    return true;
  });

  return {
    nodes: working,
    edges: [...rebuilt, ...extra],
    updated,
    added,
    deleted,
    rewired: true,
    skippedUnknown,
  };
}
