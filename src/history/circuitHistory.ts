import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";

/** Serializable circuit snapshot for undo/redo and save/load. */
export interface CircuitSnapshot {
  nodes: Node<ComponentData>[];
  edges: Edge[];
  directives?: string[];
  /** Raw .subckt library text prepended to the netlist. */
  library: string;
}

export function cloneSnapshot(s: CircuitSnapshot): CircuitSnapshot {
  return {
    nodes: s.nodes.map((n) => ({
      ...n,
      position: { ...n.position },
      data: { ...n.data, params: { ...n.data.params } },
    })),
    edges: s.edges.map((e) => ({ ...e })),
    directives: s.directives ? [...s.directives] : undefined,
    library: s.library,
  };
}

const MAX = 60;

export function createHistory() {
  const past: CircuitSnapshot[] = [];
  const future: CircuitSnapshot[] = [];

  return {
    push(current: CircuitSnapshot) {
      past.push(cloneSnapshot(current));
      if (past.length > MAX) past.shift();
      future.length = 0;
    },
    undo(current: CircuitSnapshot): CircuitSnapshot | null {
      const prev = past.pop();
      if (!prev) return null;
      future.push(cloneSnapshot(current));
      return prev;
    },
    redo(current: CircuitSnapshot): CircuitSnapshot | null {
      const next = future.pop();
      if (!next) return null;
      past.push(cloneSnapshot(current));
      return next;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}

export type CircuitHistory = ReturnType<typeof createHistory>;
