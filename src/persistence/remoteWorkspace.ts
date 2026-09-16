/**
 * Shared (global) workspace via workspace_api.php — same host as sim_api.php.
 * Pre-login: one shared circuit for all visitors. Later: ownerId + auth.
 */
import type { WorkspaceFile } from "./workspaceFile";
import { parseWorkspaceFile } from "./workspaceFile";

export function workspaceApiUrl(): string {
  const fromEnv = (import.meta.env.VITE_WORKSPACE_API_URL as string | undefined)?.trim();
  return fromEnv || "./workspace_api.php";
}

export type RemoteGetResult =
  | { ok: true; workspace: WorkspaceFile; updatedAt: string | null }
  | { ok: false; error: string; empty?: boolean };

export type RemoteSaveResult =
  | { ok: true; name: string; updatedAt: string }
  | { ok: false; error: string };

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, " ").slice(0, 120);
    throw new Error(
      snippet.startsWith("<!")
        ? "Workspace API returned HTML (is workspace_api.php deployed / proxied?)"
        : `Workspace API non-JSON: ${snippet || res.status}`,
    );
  }
}

/** Fetch the shared workspace. empty=true when nothing has been saved yet. */
export async function fetchSharedWorkspace(
  signal?: AbortSignal,
): Promise<RemoteGetResult> {
  try {
    const url = `${workspaceApiUrl()}?action=get&_=${Date.now()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
      cache: "no-store",
    });
    const data = (await parseJson(res)) as Record<string, unknown>;
    if (!data || data.ok !== true) {
      const err = String(data?.error ?? "empty");
      return { ok: false, error: err, empty: err === "empty" || res.status === 404 };
    }
    const ws = parseWorkspaceFile(data.workspace);
    return {
      ok: true,
      workspace: ws,
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
    };
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) {
      return { ok: false, error: "aborted" };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : "fetch failed",
    };
  }
}

/** Persist workspace for all visitors (shared file on the server). */
export async function saveSharedWorkspace(
  workspace: WorkspaceFile,
  signal?: AbortSignal,
): Promise<RemoteSaveResult> {
  try {
    const res = await fetch(`${workspaceApiUrl()}?action=save`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(workspace),
      signal,
    });
    const data = (await parseJson(res)) as Record<string, unknown>;
    if (!res.ok || !data || data.ok !== true) {
      return {
        ok: false,
        error: String(data?.error ?? `HTTP ${res.status}`),
      };
    }
    return {
      ok: true,
      name: String(data.name ?? workspace.name),
      updatedAt: String(data.updatedAt ?? new Date().toISOString()),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "save failed",
    };
  }
}
