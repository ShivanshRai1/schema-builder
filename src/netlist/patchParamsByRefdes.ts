import type { Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import {
  extractParamsFromRest,
  indexDeviceLines,
  netTokenCount,
} from "./parseDeviceParams";

export interface ParamPatchResult {
  /** New nodes array (same ids/positions; params may change). */
  nodes: Node<ComponentData>[];
  /** Refdes whose params actually changed. */
  updated: string[];
  /** Emitting refdes present in the graph but missing from the text (not deleted). */
  missingInText: string[];
}

/**
 * Apply netlist text → graph param updates BY REFDES.
 *
 * Safe Step-2 v1 guarantees:
 * - Never changes node positions or ids
 * - Never adds/deletes nodes
 * - Never touches edges / wiring
 * - Only updates params for devices that already exist in the graph
 */
export function patchParamsByRefdes(
  nodes: Node<ComponentData>[],
  netlistText: string,
): ParamPatchResult {
  const lines = indexDeviceLines(netlistText);
  const updated: string[] = [];
  const missingInText: string[] = [];

  const next = nodes.map((n) => {
    const { kind, refdes, params } = n.data;
    const spec = COMPONENT_SPECS[kind];
    if (!refdes || !spec.emits) return n;

    const rest = lines.get(refdes);
    if (!rest) {
      missingInText.push(refdes);
      return n;
    }

    const nets = netTokenCount(kind);
    if (rest.length < nets) return n;

    const patch = extractParamsFromRest(kind, rest.slice(nets));
    if (!Object.keys(patch).length) return n;

    let changed = false;
    const merged = { ...params };
    for (const [key, value] of Object.entries(patch)) {
      if (merged[key] !== value) {
        merged[key] = value;
        changed = true;
      }
    }
    if (!changed) return n;

    updated.push(refdes);
    return { ...n, data: { ...n.data, params: merged } };
  });

  return { nodes: next, updated, missingInText };
}
