import type {
  AssistantContext,
  AssistantHistoryTurn,
  AssistantRequest,
  AssistantResponse,
} from "./assistantTypes";
import { validateOps } from "./validateOps";

const DEFAULT_DEV_ASSISTANT = "/api/assistant";

/** Assistant backend URL. Env wins; in the browser, fall back to Vite-proxied /api/assistant. */
export function assistantApiUrl(): string | null {
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> })
      .env;
    const u = typeof env?.VITE_ASSISTANT_API_URL === "string" ? env.VITE_ASSISTANT_API_URL.trim() : "";
    if (u) return u;
    // Local Vite proxies this to the assistant server (complex Q&A / multi-step).
    if (typeof window !== "undefined") return DEFAULT_DEV_ASSISTANT;
    return null;
  } catch {
    return null;
  }
}

/**
 * POST to your assistant backend.
 * Throws on network / HTTP / shape errors — caller decides fallback.
 */
export async function callAssistantApi(
  url: string,
  message: string,
  context: AssistantContext,
  signal?: AbortSignal,
  history?: AssistantHistoryTurn[],
): Promise<AssistantResponse> {
  const body: AssistantRequest = {
    message,
    context,
    ...(history?.length ? { history } : {}),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    throw new Error(`Assistant API HTTP ${res.status}`);
  }

  const data = (await res.json()) as unknown;
  if (!data || typeof data !== "object") {
    throw new Error("Assistant API returned non-object JSON");
  }

  const d = data as Record<string, unknown>;
  const reply = String(d.reply ?? "").trim() || "Done.";
  const ops = validateOps(d.ops);

  return {
    ops,
    reply,
    source: (d.source as AssistantResponse["source"]) ?? "api",
  };
}
