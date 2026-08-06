import "./loadEnv.mjs";
import { interpretFallback, normalizeOps } from "./fallback.mjs";

/**
 * Gemini provider for the schematic assistant.
 * Returns structured { ops, reply } — never raw netlist edits.
 */

// New Gemini keys cannot use 2.0/2.5 Flash. Use 3.x for free-tier access.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const API_KEY = process.env.GEMINI_API_KEY?.trim();

const COMPONENT_KINDS = [
  "R", "L", "C", "V", "I", "D", "NMOS", "PMOS", "SICMOS", "SICMOS_K", "GANHEMT",
  "IGBT", "IGBT_K", "NPN", "PNP", "SCR", "GATEDRV", "COMP", "EAMP",
  "CSENSE", "VSENSE", "IPROBE", "VPROBE", "GND", "NODE",
];

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    ops: {
      type: "array",
      description:
        "Required circuit edits. Must be non-empty when the user asks to add/set/delete/connect/disconnect.",
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
      description: "Short confirmation. Only claim an edit if ops is non-empty.",
    },
  },
  required: ["ops", "reply"],
};

/**
 * @param {{ components?: unknown[], netlist?: string }} context
 */
function buildPrompt(message, context) {
  const components = Array.isArray(context?.components) ? context.components : [];
  const wires = Array.isArray(context?.wires) ? context.wires : [];
  const netlist = String(context?.netlist ?? "").trim();
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

  return [
    "You edit a SPICE schematic via structured JSON operations only.",
    "Never rewrite raw netlist text.",
    "",
    "CRITICAL RULES:",
    "1. If the user asks to add, change, set, update, delete, connect, wire, or disconnect, ops MUST contain the matching operation(s).",
    "2. NEVER claim you updated something unless ops includes that edit. An empty ops array means NO edit happened.",
    "3. For resistors/capacitors/inductors/sources, the param key is almost always \"value\".",
    "4. For wiring use connectPins / disconnectPins. Pin ids come from each component's pins list. GND uses pin g. You may omit aPin/bPin to auto-pick.",
    "",
    "Examples:",
    'User: "add resistor" → [{"type":"addComponent","kind":"R"}]',
    'User: "change the R1 value to 4.7k" → [{"type":"setParam","refdes":"R1","key":"value","value":"4.7k"}]',
    'User: "remove C1" → [{"type":"deleteComponent","refdes":"C1"}]',
    'User: "connect R1 to C1" → [{"type":"connectPins","aRefdes":"R1","bRefdes":"C1"}]',
    'User: "connect R1.b to C1.a" → [{"type":"connectPins","aRefdes":"R1","aPin":"b","bRefdes":"C1","bPin":"a"}]',
    'User: "connect R1 to ground" → [{"type":"connectPins","aRefdes":"R1","bRefdes":"GND"}]',
    'User: "disconnect R1" → [{"type":"disconnectPins","aRefdes":"R1"}]',
    "",
    "Allowed kinds for addComponent: " + COMPONENT_KINDS.join(", "),
    "",
    "Current components:",
    componentLines,
    "",
    "Current wires:",
    wireLines,
    "",
    netlist ? "Current netlist (read-only context):\n" + netlist : "No netlist attached.",
    "",
    "User message: " + message,
  ].join("\n");
}

/**
 * @param {string} message
 * @param {{ components?: unknown[], netlist?: string }} context
 */
async function callGemini(message, context) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=` +
    encodeURIComponent(API_KEY);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: buildPrompt(message, context) }] }],
      generationConfig: {
        temperature: 0.1,
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
 * @param {{ components?: unknown[], netlist?: string }} context
 * @returns {Promise<{ ops: unknown[], reply: string, source: string }>}
 */
export async function handleAssistant(message, context) {
  if (!API_KEY) {
    const fb = interpretFallback(message);
    if (fb) return { ...fb, source: "rules" };
    return {
      ops: [],
      reply:
        "No GEMINI_API_KEY in server/.env. Add your key there and restart the server.",
      source: "stub",
    };
  }

  try {
    const result = await callGemini(message, context);
    if (Array.isArray(result.ops) && result.ops.length > 0) {
      return { ...result, source: "llm" };
    }
    // Model often claims success with empty ops — fall back to local parse.
    const fb = interpretFallback(message);
    if (fb) return { ...fb, source: "llm+rules" };
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

export function providerStatus() {
  return API_KEY ? `gemini:${MODEL}` : "stub (no GEMINI_API_KEY)";
}
