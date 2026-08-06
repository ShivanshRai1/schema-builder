import { interpret } from "./ops";
import type { AssistantContext, AssistantResponse } from "./assistantTypes";
import { assistantApiUrl, callAssistantApi } from "./assistantApi";

export interface RunAssistantOptions {
  signal?: AbortSignal;
}

/**
 * Step-3 entry point for the chat panel.
 *
 * - No VITE_ASSISTANT_API_URL → rule-based interpret() (current behavior).
 * - URL set → call your backend; on failure return a clear error (no silent
 *   wrong edits). Rules remain available by clearing the env var.
 */
export async function runAssistant(
  message: string,
  context: AssistantContext,
  opts: RunAssistantOptions = {},
): Promise<AssistantResponse> {
  const text = message.trim();
  if (!text) {
    return { ops: [], reply: "Say something to edit the circuit.", source: "rules" };
  }

  const url = assistantApiUrl();
  if (!url) {
    const r = interpret(text);
    return { ops: r.ops, reply: r.reply, source: "rules" };
  }

  try {
    const api = await callAssistantApi(url, text, context, opts.signal);
    // Models often claim success with empty ops — recover locally.
    if (api.ops.length === 0) {
      const local = interpret(text);
      if (local.ops.length) {
        return { ops: local.ops, reply: local.reply, source: "api" };
      }
    }
    return api;
  } catch (e) {
    const err = e instanceof Error ? e.message : "unknown error";
    const local = interpret(text);
    if (local.ops.length) {
      return { ops: local.ops, reply: local.reply, source: "rules" };
    }
    return {
      ops: [],
      reply:
        `Assistant API unavailable (${err}). ` +
        `Is the server running? Or unset VITE_ASSISTANT_API_URL to use the built-in rules.`,
      source: "api",
    };
  }
}
