import type { WorkspaceFile } from "./workspaceFile";
import { parseWorkspaceFile } from "./workspaceFile";

const STORE_KEY = "simulai-projects-v1";
const DRAFT_KEY = "simulai-draft-workspace-v1";
const LAST_ID_KEY = "simulai-last-project-id";

export type LocalProjectMeta = {
  id: string;
  name: string;
  updatedAt: string;
  tabCount: number;
};

export type LocalProjectRecord = LocalProjectMeta & {
  workspace: WorkspaceFile;
};

type StoreShape = {
  projects: LocalProjectRecord[];
};

function readStore(): StoreShape {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { projects: [] };
    const parsed = JSON.parse(raw) as StoreShape;
    if (!parsed || !Array.isArray(parsed.projects)) return { projects: [] };
    return { projects: parsed.projects.filter((p) => p?.id && p.workspace) };
  } catch {
    return { projects: [] };
  }
}

function writeStore(store: StoreShape): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function listLocalProjects(): LocalProjectMeta[] {
  return readStore()
    .projects.map((p) => ({
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
      tabCount: p.workspace?.tabs?.length ?? 0,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getLocalProject(id: string): LocalProjectRecord | null {
  return readStore().projects.find((p) => p.id === id) ?? null;
}

export function saveLocalProject(
  workspace: WorkspaceFile,
  existingId?: string | null,
): LocalProjectRecord {
  const ws = parseWorkspaceFile(workspace);
  const store = readStore();
  const now = new Date().toISOString();
  const id = existingId && store.projects.some((p) => p.id === existingId) ? existingId : newId();
  const record: LocalProjectRecord = {
    id,
    name: ws.name,
    updatedAt: now,
    tabCount: ws.tabs.length,
    workspace: { ...ws, savedAt: now },
  };
  const idx = store.projects.findIndex((p) => p.id === id);
  if (idx >= 0) store.projects[idx] = record;
  else store.projects.unshift(record);
  writeStore(store);
  try {
    localStorage.setItem(LAST_ID_KEY, id);
  } catch {
    /* ignore */
  }
  return record;
}

export function renameLocalProject(id: string, name: string): void {
  const store = readStore();
  const p = store.projects.find((x) => x.id === id);
  if (!p) return;
  const n = name.trim() || "Untitled";
  p.name = n;
  p.workspace = { ...p.workspace, name: n };
  p.updatedAt = new Date().toISOString();
  writeStore(store);
}

export function deleteLocalProject(id: string): void {
  const store = readStore();
  store.projects = store.projects.filter((p) => p.id !== id);
  writeStore(store);
  try {
    if (localStorage.getItem(LAST_ID_KEY) === id) localStorage.removeItem(LAST_ID_KEY);
  } catch {
    /* ignore */
  }
}

export function saveDraftWorkspace(workspace: WorkspaceFile): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(workspace));
  } catch {
    /* quota — ignore draft */
  }
}

export function loadDraftWorkspace(): WorkspaceFile | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return parseWorkspaceFile(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearDraftWorkspace(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export function getLastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_ID_KEY);
  } catch {
    return null;
  }
}
