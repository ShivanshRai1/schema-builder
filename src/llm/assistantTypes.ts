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

export interface AssistantContext {
  components: AssistantComponent[];
  wires?: AssistantWire[];
  netlist: string;
}

export interface AssistantRequest {
  message: string;
  context: AssistantContext;
}

export interface AssistantResponse {
  ops: Op[];
  reply: string;
  /** Where the reply came from (for UI badge / debugging). */
  source?: "rules" | "api" | "stub";
}

/** LLM tool / JSON schema description — mirror this on the server. */
export const OP_TOOL_SCHEMA = {
  name: "circuit_ops",
  description:
    "Edit the schematic via structured operations. Never rewrite raw netlist text.",
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
      reply: { type: "string", description: "Short user-facing confirmation" },
    },
    required: ["ops", "reply"],
  },
} as const;
