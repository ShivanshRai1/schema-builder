import type { Edge, Node } from "@xyflow/react";
import type { ComponentData } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import type { CircuitSnapshot } from "../history/circuitHistory";
import { parseCircuitFile, type CircuitFile } from "./circuitFile";

/** Multi-tab workspace — also the future cloud/login project payload. */
export const WORKSPACE_FORMAT = "simulai-workspace" as const;
export const WORKSPACE_VERSION = 1;

export type WorkspaceTabFile = {
  id: string;
  title: string;
  nodes: Node<ComponentData>[];
  edges: Edge[];
  directives?: string[];
  library?: string;
  hiddenCrossingKeys?: string[];
  nextId?: number;
};

export type WorkspaceFile = {
  format: typeof WORKSPACE_FORMAT;
  version: number;
  name: string;
  savedAt: string;
  activeTabId: string;
  tabs: WorkspaceTabFile[];
  /** Reserved for future accounts; ignored offline. */
  ownerId?: string | null;
};

export function isWorkspaceFile(raw: unknown): raw is WorkspaceFile {
  if (!raw || typeof raw !== "object") return false;
  const f = raw as Partial<WorkspaceFile>;
  return f.format === WORKSPACE_FORMAT && Array.isArray(f.tabs) && f.tabs.length > 0;
}

function validateTab(tab: WorkspaceTabFile, index: number): void {
  if (!tab || typeof tab !== "object") throw new Error(`Tab ${index}: invalid`);
  if (!Array.isArray(tab.nodes) || !Array.isArray(tab.edges)) {
    throw new Error(`Tab ${index}: missing nodes/edges`);
  }
  for (const n of tab.nodes) {
    const kind = (n as Node<ComponentData>)?.data?.kind;
    if (!kind || !COMPONENT_SPECS[kind]) {
      throw new Error(`Tab ${index}: unknown component kind: ${String(kind)}`);
    }
  }
}

export function parseWorkspaceFile(raw: unknown): WorkspaceFile {
  if (!isWorkspaceFile(raw)) throw new Error("Not a SimulAI workspace file");
  if (raw.version !== WORKSPACE_VERSION) {
    // Forward-compatible: accept same major shape; bump carefully later.
  }
  if (!raw.name?.trim()) throw new Error("Workspace missing name");
  if (!raw.activeTabId) throw new Error("Workspace missing activeTabId");
  raw.tabs.forEach(validateTab);
  if (!raw.tabs.some((t) => t.id === raw.activeTabId)) {
    throw new Error("activeTabId does not match any tab");
  }
  return {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    name: raw.name.trim(),
    savedAt: raw.savedAt || new Date().toISOString(),
    activeTabId: raw.activeTabId,
    tabs: raw.tabs.map((t) => ({
      id: t.id,
      title: t.title || "Circuit",
      nodes: t.nodes,
      edges: t.edges,
      directives: t.directives,
      library: t.library ?? "",
      hiddenCrossingKeys: t.hiddenCrossingKeys ?? [],
      nextId: t.nextId,
    })),
    ownerId: raw.ownerId ?? null,
  };
}

/** Accept either a full workspace or a legacy single-circuit JSON. */
export function parseProjectPayload(raw: unknown): WorkspaceFile {
  if (isWorkspaceFile(raw)) return parseWorkspaceFile(raw);
  // Legacy single schematic → one-tab workspace
  const snap = parseCircuitFile(raw);
  const id = "tab-1";
  const name =
    typeof raw === "object" && raw && "name" in raw && typeof (raw as { name?: unknown }).name === "string"
      ? (raw as { name: string }).name
      : "Imported circuit";
  return {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    name,
    savedAt: new Date().toISOString(),
    activeTabId: id,
    tabs: [
      {
        id,
        title: "Circuit 1",
        nodes: snap.nodes,
        edges: snap.edges,
        directives: snap.directives,
        library: snap.library,
        hiddenCrossingKeys: [],
      },
    ],
    ownerId: null,
  };
}

export function tabFromSnapshot(
  id: string,
  title: string,
  snap: CircuitSnapshot,
  extra?: { hiddenCrossingKeys?: string[]; nextId?: number },
): WorkspaceTabFile {
  return {
    id,
    title,
    nodes: snap.nodes,
    edges: snap.edges,
    directives: snap.directives,
    library: snap.library || undefined,
    hiddenCrossingKeys: extra?.hiddenCrossingKeys ?? [],
    nextId: extra?.nextId,
  };
}

export function buildWorkspaceFile(args: {
  name: string;
  activeTabId: string;
  tabs: WorkspaceTabFile[];
  ownerId?: string | null;
}): WorkspaceFile {
  return {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    name: args.name.trim() || "Untitled",
    savedAt: new Date().toISOString(),
    activeTabId: args.activeTabId,
    tabs: args.tabs,
    ownerId: args.ownerId ?? null,
  };
}

export function downloadWorkspace(ws: WorkspaceFile, filename?: string) {
  const safe = (ws.name || "project").replace(/[^\w\-]+/g, "_").slice(0, 40);
  const blob = new Blob([JSON.stringify(ws, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `${safe}.simulai.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function readProjectFile(file: File): Promise<WorkspaceFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseProjectPayload(JSON.parse(String(reader.result))));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** Active-tab only export still uses the legacy circuit format for compatibility. */
export type { CircuitFile };
