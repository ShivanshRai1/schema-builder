import type { ComponentKind } from "../model/types";
import type { Op } from "./ops";

/** Snapshot sent to the assistant backend / LLM. */
export interface AssistantComponent {
  refdes: string;
  kind: ComponentKind;
  params: Record<string, string>;
  /** Pin ids available on this part (for connect ops). */
  pins?: string[];
}

export interface AssistantWire {
  a: string; // e.g. "R1.b"
  b: string; // e.g. "C1.a"
}

export interface AssistantHistoryTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AssistantContext {
  components: AssistantComponent[];
  wires?: AssistantWire[];
  netlist: string;
  /** Analysis / WC markers (.tran, *.wc, …). */
  directives?: string[];
  /** Truncated Models library text (.subckt / .model). */
  library?: string;
}

export interface AssistantRequest {
  message: string;
  context: AssistantContext;
  /** Recent chat turns for follow-up questions (oldest → newest, excludes current). */
  history?: AssistantHistoryTurn[];
}

export interface AssistantResponse {
  ops: Op[];
  reply: string;
  /** Where the reply came from (for UI badge / debugging). */
  source?: "rules" | "api" | "stub" | "llm" | "llm+rules";
}

/** LLM tool / JSON schema description — mirror this on the server. */
export const OP_TOOL_SCHEMA = {
  name: "circuit_ops",
  description:
    "Edit the schematic via structured operations, or answer questions with ops=[]. Never rewrite raw netlist text.",
  parameters: {
    type: "object",
    properties: {
      ops: {
        type: "array",
        items: {
          oneOf: [
            {
              type: "object",
              properties: {
                type: { const: "addComponent" },
                kind: { type: "string", description: "ComponentKind e.g. R, C, SICMOS" },
              },
              required: ["type", "kind"],
            },
            {
              type: "object",
              properties: {
                type: { const: "setParam" },
                refdes: { type: "string" },
                key: { type: "string" },
                value: { type: "string" },
              },
              required: ["type", "refdes", "key", "value"],
            },
            {
              type: "object",
              properties: {
                type: { const: "deleteComponent" },
                refdes: { type: "string" },
              },
              required: ["type", "refdes"],
            },
            {
              type: "object",
              properties: {
                type: { const: "connectPins" },
                aRefdes: { type: "string" },
                bRefdes: { type: "string" },
                aPin: { type: "string" },
                bPin: { type: "string" },
              },
              required: ["type", "aRefdes", "bRefdes"],
            },
            {
              type: "object",
              properties: {
                type: { const: "disconnectPins" },
                aRefdes: { type: "string" },
                aPin: { type: "string" },
                bRefdes: { type: "string" },
                bPin: { type: "string" },
              },
              required: ["type", "aRefdes"],
            },
          ],
        },
      },
      reply: {
        type: "string",
        description:
          "User-facing answer. For questions, write a clear explanation. For edits, confirm what ops will do.",
      },
    },
    required: ["ops", "reply"],
  },
} as const;
