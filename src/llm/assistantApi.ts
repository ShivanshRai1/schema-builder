import type { AssistantContext, AssistantRequest, AssistantResponse } from "./assistantTypes";
import { validateOps } from "./validateOps";

/** Default path when VITE_ASSISTANT_API_URL is unset. */
export function assistantApiUrl(): string | null {
  const u = (import.meta.env.VITE_ASSISTANT_API_URL as string | undefined)?.trim();
  return u || null;
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
): Promise<AssistantResponse> {
  const body: AssistantRequest = { message, context };

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
