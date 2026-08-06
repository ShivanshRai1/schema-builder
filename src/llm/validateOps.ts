import type { ComponentKind } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import type { Op } from "./ops";

const KINDS = new Set(Object.keys(COMPONENT_SPECS) as ComponentKind[]);

function normRef(s: unknown): string {
  const t = String(s ?? "").trim().toUpperCase();
  if (t === "GROUND" || t === "EARTH" || t === "0") return "GND";
  return t;
}

function optPin(s: unknown): string | undefined {
  const p = String(s ?? "").trim().toLowerCase();
  return p || undefined;
}

/**
 * Validate ops from the assistant API / LLM before applying to the graph.
 * Drops anything malformed so a bad model response cannot break the app.
 */
export function validateOps(raw: unknown): Op[] {
  if (!Array.isArray(raw)) return [];
  const out: Op[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const type = o.type;

    if (type === "addComponent") {
      const kind = String(o.kind ?? "") as ComponentKind;
      if (KINDS.has(kind)) out.push({ type: "addComponent", kind });
      continue;
    }

    if (type === "setParam") {
      const refdes = normRef(o.refdes);
      let key = String(o.key ?? "").trim().toLowerCase();
      if (key === "resistance" || key === "capacitance" || key === "inductance") key = "value";
      const value = String(o.value ?? "").trim();
      if (refdes && key) out.push({ type: "setParam", refdes, key, value });
      continue;
    }

    if (type === "deleteComponent") {
      const refdes = normRef(o.refdes);
      if (refdes) out.push({ type: "deleteComponent", refdes });
      continue;
    }

    if (type === "connectPins") {
      const aRefdes = normRef(o.aRefdes ?? o.fromRefdes ?? o.from);
      const bRefdes = normRef(o.bRefdes ?? o.toRefdes ?? o.to);
      const aPin = optPin(o.aPin ?? o.fromPin);
      const bPin = optPin(o.bPin ?? o.toPin);
      if (aRefdes && bRefdes) {
        out.push({
          type: "connectPins",
          aRefdes,
          bRefdes,
          ...(aPin ? { aPin } : {}),
          ...(bPin ? { bPin } : {}),
        });
      }
      continue;
    }

    if (type === "disconnectPins") {
      const aRefdes = normRef(o.aRefdes ?? o.refdes ?? o.from);
      const aPin = optPin(o.aPin);
      const bPin = optPin(o.bPin);
      const bRaw = String(o.bRefdes ?? o.to ?? "").trim();
      const bRefdes = bRaw ? normRef(bRaw) : undefined;
      if (aRefdes) {
        out.push({
          type: "disconnectPins",
          aRefdes,
          ...(aPin ? { aPin } : {}),
          ...(bRefdes ? { bRefdes } : {}),
          ...(bPin ? { bPin } : {}),
        });
      }
    }
  }

  return out;
}
