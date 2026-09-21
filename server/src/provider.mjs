import "./loadEnv.mjs";
import { interpretFallback, normalizeOps } from "./fallback.mjs";

/**
 * Gemini provider for the schematic assistant.
 * Supports circuit edits (ops) and complex Q&A (ops=[] + detailed reply).
 */

const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const API_KEY = process.env.GEMINI_API_KEY?.trim();

const COMPONENT_KINDS = [
  "R", "RBOX", "RVAR", "POT", "L", "LVAR", "C", "CPOL", "CVAR", "CFIXED",
  "V", "BATTERY", "VAC", "I", "IAC", "VPULSE",
  "D", "DZ", "DS", "LED", "DTVS", "DTVSBI",
  "NMOS", "PMOS", "NMOS_D", "PMOS_D", "NJFET", "PJFET",
  "SICMOS", "SICMOS_K", "GANHEMT", "IGBT", "IGBT_K", "NPN", "PNP", "UJT",
  "SCR", "GATEDRV", "COMP", "EAMP", "OPAMP", "OPAMP5",
  "CSENSE", "VSENSE", "IPROBE", "VPROBE", "GND", "NODE", "WIRELABEL",
];

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    ops: {
      type: "array",
      description:
        "Circuit edits. Non-empty when the user asks to add/set/delete/connect/disconnect (can be several ops for multi-step). Empty [] for questions, explanations, or advice with no schematic change.",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "addComponent",
              "setParam",
              "deleteComponent",
              "connectPins",
              "disconnectPins",
            ],
          },
          kind: {
            type: "string",
            description: "For addComponent only. One of: " + COMPONENT_KINDS.join(", "),
          },
          refdes: {
            type: "string",
            description: "For setParam/deleteComponent. Exact id like R1, C1.",
          },
          key: {
            type: "string",
            description: 'For setParam. Almost always "value" for R/L/C/V/I.',
          },
          value: {
            type: "string",
            description: "For setParam. New parameter value, e.g. 4.7k",
          },
          params: {
            type: "object",
            description: "Optional initial params for addComponent",
          },
          aRefdes: { type: "string", description: "connect/disconnect: first part (or GND)" },
          bRefdes: { type: "string", description: "connect/disconnect: second part (or GND)" },
          aPin: { type: "string", description: "Optional pin id e.g. a, b, p, n, g" },
          bPin: { type: "string", description: "Optional pin id" },
        },
        required: ["type"],
      },
    },
    reply: {
      type: "string",
      description:
        "User-facing answer. For questions/analysis: clear, substantive explanation (a few sentences is fine). For edits: briefly confirm what the ops will change. Never claim an edit unless ops is non-empty.",
    },
  },
  required: ["ops", "reply"],
};

/**
 * @param {{ components?: unknown[], wires?: unknown[], netlist?: string, directives?: string[], library?: string }} context
 */
function formatContext(context) {
  const components = Array.isArray(context?.components) ? context.components : [];
  const wires = Array.isArray(context?.wires) ? context.wires : [];
  const netlist = String(context?.netlist ?? "").trim();
  const directives = Array.isArray(context?.directives)
    ? context.directives.map(String).filter(Boolean)
    : [];
  const library = String(context?.library ?? "").trim();

  const componentLines =
    components.length === 0
      ? "(empty circuit)"
      : components
          .map((c) => {
            const row = /** @type {{ refdes?: string, kind?: string, params?: Record<string, string>, pins?: string[] }} */ (c);
            const params = row.params ? JSON.stringify(row.params) : "{}";
            const pins = Array.isArray(row.pins) ? row.pins.join(",") : "?";
            return `- ${row.refdes ?? "?"} kind=${row.kind ?? "?"} pins=[${pins}] params=${params}`;
          })
          .join("\n");
  const wireLines =
    wires.length === 0
      ? "(no wires)"
      : wires.map((w) => `- ${w.a} ↔ ${w.b}`).join("\n");

  const parts = [
    "Current components:",
    componentLines,
    "",
    "Current wires:",
    wireLines,
  ];
  if (directives.length) {
    parts.push("", "Directives / analysis:", directives.join("\n"));
  }
  if (library) {
    const clipped = library.length > 6000 ? `${library.slice(0, 6000)}\n…(truncated)` : library;
    parts.push("", "Models library (.subckt / .model):", clipped);
  }
  if (netlist) {
    const clipped = netlist.length > 12000 ? `${netlist.slice(0, 12000)}\n…(truncated)` : netlist;
    parts.push("", "Current netlist (read-only context):", clipped);
  } else {
    parts.push("", "No netlist attached.");
  }
  return parts.join("\n");
}

/**
 * @param {string} message
 * @param {object} context
 * @param {{ role: string, text: string }[]} [history]
 */
function buildSystemAndUser(message, context, history) {
  const system = [
    "You are the SimulAI schematic assistant for SPICE circuits.",
    "You can (1) edit the schematic via structured JSON ops, and (2) answer complex questions about the circuit, netlist, models, and simulation setup.",
    "Never rewrite raw netlist text yourself — only return ops + reply.",
    "",
    "MODES:",
    "A) EDIT — user wants add/change/delete/wire. Fill ops with one or more operations (multi-step is encouraged). reply briefly confirms the plan.",
    "B) QUESTION / ANALYSIS — user asks why/how/what/explain/compare/design advice. Set ops to []. Write a clear, helpful reply using the circuit context. Be specific to their parts, nets, and directives.",
    "C) MIXED — e.g. explain then propose a change. Put proposed edits in ops and explain in reply.",
    "",
    "CRITICAL:",
    "1. NEVER claim you updated the schematic unless ops is non-empty.",
    "2. For R/L/C/sources, param key is usually \"value\" (or dc/stimulus fields when relevant).",
    "3. Wiring uses connectPins / disconnectPins. Pin ids come from each component's pins list. GND uses pin g. Omit aPin/bPin to auto-pick.",
    "4. Multi-step requests → multiple ops in order.",
    "",
    "Edit examples:",
    'User: "add resistor" → ops:[{"type":"addComponent","kind":"R"}]',
    'User: "change R1 to 4.7k and connect it to C1" → two ops: setParam + connectPins',
    'User: "remove C1" → [{"type":"deleteComponent","refdes":"C1"}]',
    "",
    "Q&A example:",
    'User: "Why is .tran only 1m?" → ops:[], reply explains the directive and suggests a longer stop if needed.',
    "",
    "Allowed kinds for addComponent: " + COMPONENT_KINDS.join(", "),
    "",
    formatContext(context),
  ].join("\n");

  const hist = Array.isArray(history) ? history.slice(-8) : [];
  const histBlock =
    hist.length === 0
      ? ""
      : "\n\nRecent conversation:\n" +
        hist
          .map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${String(h.text ?? "").slice(0, 800)}`)
          .join("\n");

  return {
    system,
    user: `${histBlock}\n\nUser message: ${message}`.trim(),
  };
}

/**
 * @param {string} message
 * @param {object} context
 * @param {{ role: string, text: string }[]} [history]
 */
async function callGemini(message, context, history) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=` +
    encodeURIComponent(API_KEY);

  const { system, user } = buildSystemAndUser(message, context, history);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.35,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const err =
      data?.error?.message ||
      (typeof data === "object" ? JSON.stringify(data) : String(data));
    throw new Error(err || `Gemini HTTP ${res.status}`);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");

  const parsed = JSON.parse(text);
  return {
    ops: normalizeOps(parsed.ops),
    reply: String(parsed.reply ?? "Done."),
  };
}

/**
 * @param {string} message
 * @param {object} context
 * @param {{ role: string, text: string }[]} [history]
 * @returns {Promise<{ ops: unknown[], reply: string, source: string }>}
 */
export async function handleAssistant(message, context, history) {
  if (!API_KEY) {
    const fb = interpretFallback(message);
    if (fb) return { ...fb, source: "rules" };
    return {
      ops: [],
      reply:
        "No GEMINI_API_KEY in server/.env — I can only run simple edit phrases offline. Add your key and restart the server for complex questions and multi-step edits.",
      source: "stub",
    };
  }

  try {
    const result = await callGemini(message, context, history);
    if (Array.isArray(result.ops) && result.ops.length > 0) {
      return { ...result, source: "llm" };
    }
    // Empty ops: may be a valid Q&A answer — keep reply. Still try rules if it looks like an edit.
    const fb = interpretFallback(message);
    if (fb && looksLikeEditRequest(message)) {
      return { ...fb, source: "llm+rules" };
    }
    return { ...result, source: "llm" };
  } catch (e) {
    const err = e instanceof Error ? e.message : "LLM request failed";
    const fb = interpretFallback(message);
    if (fb) return { ...fb, source: "rules" };
    const quota =
      /quota|rate.?limit|resource.?exhausted|limit:\s*0/i.test(err)
        ? ` Gemini free-tier quota hit for ${MODEL}. Wait a minute and retry, or set GEMINI_MODEL in server/.env. Check https://ai.dev/rate-limit`
        : "";
    return { ops: [], reply: `Assistant error: ${err}${quota}`, source: "llm" };
  }
}

function looksLikeEditRequest(message) {
  return /\b(add|insert|place|create|set|change|update|modify|delete|remove|connect|disconnect|wire|link)\b/i.test(
    message,
  );
}

export function providerStatus() {
  return API_KEY ? `gemini:${MODEL}` : "stub (no GEMINI_API_KEY)";
}
