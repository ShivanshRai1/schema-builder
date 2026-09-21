import { interpret } from "./ops";
import type {
  AssistantContext,
  AssistantHistoryTurn,
  AssistantResponse,
} from "./assistantTypes";
import { assistantApiUrl, callAssistantApi } from "./assistantApi";

export interface RunAssistantOptions {
  signal?: AbortSignal;
  /** Prior chat turns (excluding the current user message). */
  history?: AssistantHistoryTurn[];
}

const UNKNOWN_REPLY =
  'I didn’t catch a simple edit command. For circuit questions or multi-step changes, start the assistant server (`cd server && npm start`) with GEMINI_API_KEY set. Simple edits still work: "add 10k resistor", "set R1 value 4.7k", "connect R1 to C1".';

/**
 * True when the utterance looks like Q&A, design advice, or multi-step work —
 * those should go to the LLM (with rules as fallback), not stop at local parse.
 */
export function prefersLlmAssistant(message: string): boolean {
  const t = message.trim();
  if (!t) return false;
  if (/\?/.test(t)) return true;
  if (
    /\b(why|how|what|which|when|where|explain|analyze|analyse|compare|design|suggest|recommend|advise|should|could|would|help me|walk me|describe|summarize|summary|difference|calculate|estimate|review|debug|troubleshoot|improve|optimize|optimise|meaning|purpose|behavior|behaviour|does this|is this|can you explain)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(and then|then also|also add|after that|as well as|followed by|plus add|and add|and set|and connect|and remove|multi-?step|several|multiple)\b/i.test(t)) {
    return true;
  }
  // Longer free-form prompts
  if (t.split(/\s+/).filter(Boolean).length >= 16) return true;
  return false;
}

/**
 * Chat entry point.
 *
 * - Short edit phrases → local rules first (reliable).
 * - Questions / multi-step / complex → LLM API (rules fill gaps if API empty/fails).
 */
export async function runAssistant(
  message: string,
  context: AssistantContext,
  opts: RunAssistantOptions = {},
): Promise<AssistantResponse> {
  const text = message.trim();
  if (!text) {
    return { ops: [], reply: "Say something to edit the circuit, or ask a question about it.", source: "rules" };
  }

  const local = interpret(text);
  const wantLlm = prefersLlmAssistant(text);

  // Simple, unambiguous edits: rules win immediately (no canned-API loop).
  if (!wantLlm && local.ops.length) {
    return { ops: local.ops, reply: local.reply, source: "rules" };
  }

  const url = assistantApiUrl();
  if (!url) {
    if (local.ops.length) return { ops: local.ops, reply: local.reply, source: "rules" };
    return { ops: [], reply: UNKNOWN_REPLY, source: "rules" };
  }

  try {
    const api = await callAssistantApi(url, text, context, opts.signal, opts.history);
    if (api.ops.length) return { ...api, source: api.source ?? "api" };

    // Q&A / advice: keep a real answer; only discard canned help loops.
    const reply = api.reply?.trim() ?? "";
    if (reply && !looksLikeCannedHelp(reply)) {
      // If the model answered but rules also found edits, prefer ops from rules
      // only when the user clearly asked for an edit that rules understood AND
      // this was not a prefersLlm question. For prefersLlm, trust the answer.
      if (!wantLlm && local.ops.length) {
        return { ops: local.ops, reply: local.reply, source: "rules" };
      }
      return { ops: [], reply, source: api.source ?? "api" };
    }

    if (local.ops.length) {
      return { ops: local.ops, reply: local.reply, source: "rules" };
    }
    return { ops: [], reply: UNKNOWN_REPLY, source: "api" };
  } catch (e) {
    const err = e instanceof Error ? e.message : "unknown error";
    if (local.ops.length) {
      return {
        ops: local.ops,
        reply: `${local.reply} (assistant API unavailable — applied via built-in rules)`,
        source: "rules",
      };
    }
    return {
      ops: [],
      reply:
        wantLlm
          ? `I need the assistant server for that question (${err}). Start it with \`cd server && npm start\` and set GEMINI_API_KEY. Simple edits still work offline.`
          : `${UNKNOWN_REPLY} (${err})`,
      source: "api",
    };
  }
}

/** Welcome / help dumps that used to loop when the API ignored the prompt. */
function looksLikeCannedHelp(reply: string): boolean {
  const t = reply.toLowerCase();
  if (t.length > 220) return false; // real explanations are longer
  return (
    /^(hi|hello|hey)\b/.test(t) ||
    (t.includes("try:") && t.includes("resistor")) ||
    (t.includes("try “") && t.includes("resistor")) ||
    (t.includes('try "') && t.includes("resistor")) ||
    (t.includes("confirm") && t.includes("add") && t.includes("resistor"))
  );
}
