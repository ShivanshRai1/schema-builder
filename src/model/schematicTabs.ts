import type { CircuitHistory, CircuitSnapshot } from "../history/circuitHistory";
import { cloneSnapshot, createHistory } from "../history/circuitHistory";

export type SchematicTabMeta = {
  id: string;
  title: string;
};

/** Frozen per-tab document (inactive tabs). Active tab lives in React state. */
export type SchematicTabDoc = {
  id: string;
  title: string;
  snap: CircuitSnapshot;
  history: CircuitHistory;
  hiddenCrossingKeys: string[];
  nextId: number;
};

let tabSeq = 1;

export function nextTabId(): string {
  return `tab-${++tabSeq}`;
}

export function emptySchematic(opts?: {
  library?: string;
  directives?: string[];
}): CircuitSnapshot {
  return {
    nodes: [],
    edges: [],
    directives: opts?.directives ?? [".tran 1u 1m", ".options reltol=1e-3"],
    library: opts?.library ?? "",
  };
}

export function createTabDoc(
  title: string,
  snap: CircuitSnapshot,
  opts?: { id?: string; history?: CircuitHistory; nextId?: number },
): SchematicTabDoc {
  return {
    id: opts?.id ?? nextTabId(),
    title,
    snap: cloneSnapshot(snap),
    history: opts?.history ?? createHistory(),
    hiddenCrossingKeys: [],
    nextId: opts?.nextId ?? 0,
  };
}

export function maxNodeId(nodes: { id: string }[]): number {
  let max = 0;
  for (const n of nodes) {
    const m = /^n(\d+)$/.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}
