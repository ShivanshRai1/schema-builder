import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import type { CircuitSnapshot } from "../history/circuitHistory";
import { COMPONENT_SPECS } from "../model/componentSpecs";

const FORMAT = "simulai-schematic" as const;
const VERSION = 1;

export interface CircuitFile {
  format: typeof FORMAT;
  version: number;
  savedAt: string;
  nodes: Node<ComponentData>[];
  edges: Edge[];
  directives?: string[];
  library?: string;
}

export function toCircuitFile(snap: CircuitSnapshot): CircuitFile {
  return {
    format: FORMAT,
    version: VERSION,
    savedAt: new Date().toISOString(),
    nodes: snap.nodes,
    edges: snap.edges,
    directives: snap.directives,
    library: snap.library || undefined,
  };
}

export function parseCircuitFile(raw: unknown): CircuitSnapshot {
  if (!raw || typeof raw !== "object") throw new Error("Invalid file");
  const f = raw as Partial<CircuitFile>;
  if (f.format !== FORMAT) throw new Error("Not a SimulAI schematic file");
  if (!Array.isArray(f.nodes) || !Array.isArray(f.edges)) {
    throw new Error("File missing nodes/edges");
  }
  for (const n of f.nodes) {
    const kind = (n as Node<ComponentData>)?.data?.kind;
    if (!kind || !COMPONENT_SPECS[kind]) {
      throw new Error(`Unknown component kind: ${String(kind)}`);
    }
  }
  return {
    nodes: f.nodes as Node<ComponentData>[],
    edges: f.edges as Edge[],
    directives: f.directives,
    library: f.library ?? "",
  };
}

export function downloadCircuit(snap: CircuitSnapshot, filename = "circuit.json") {
  const blob = new Blob([JSON.stringify(toCircuitFile(snap), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function readCircuitFile(file: File): Promise<CircuitSnapshot> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseCircuitFile(JSON.parse(String(reader.result))));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
