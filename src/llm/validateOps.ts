import type { ComponentKind } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import type { Op } from "./ops";

const KINDS = new Set(Object.keys(COMPONENT_SPECS) as ComponentKind[]);

function normRef(s: unknown): string {
  const t = String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (t === "GROUND" || t === "EARTH" || t === "0") return "GND";
  if (/^(MID|MIDDLE|MIDPOINT|JUNCTION|CLAMP|NETMID)$/i.test(t)) return "MID";
  if (/^(NEWC|NEWCAP|CAPACITOR|CAP)$/i.test(t)) return "NEWC";
  const netNum = /^NET(\d+)$/i.exec(t);
  if (netNum) return netNum[1]!;
  return t;
}

function optPin(s: unknown): string | undefined {
  const p = String(s ?? "").trim().toLowerCase();
  return p || undefined;
}

/** Alias cleanup for setParam keys (B1/B3). */
export function normalizeSetParamKey(raw: string): string {
  let key = String(raw ?? "").trim().toLowerCase().replace(/[^a-z_]/g, "");
  if (
    key === "resistance" ||
    key === "capacitance" ||
    key === "inductance" ||
    key === "val" ||
    key === "param" ||
    key === "parameter"
  ) {
    key = "value";
  }
  if (
    key === "part" ||
    key === "pn" ||
    key === "subckt" ||
    key === "subcircuit" ||
    key === "type" ||
    key === "spicemodel"
  ) {
    key = "model";
  }
  return key;
}

/** Editable attribute keys for a kind (from COMPONENT_SPECS). */
export function allowedParamKeysForKind(kind: ComponentKind): Set<string> {
  const spec = COMPONENT_SPECS[kind];
  if (!spec) return new Set();
  return new Set(spec.attributes.map((a) => a.key));
}

/** True for engineering values like 4.7k / 100n / 2 — not model names. */
export function looksLikeSpiceValue(value: string): boolean {
  return /^[+\-]?\d/.test(String(value ?? "").trim());
}

/**
 * Letter-led identifiers (SM8S36A, XFD11K54CA, DZEN, FooBar).
 * Used to rewrite mistaken setParam key "value" → "model".
 */
export function looksLikeModelName(value: string): boolean {
  const t = String(value ?? "").trim();
  if (!t || t.length > 80) return false;
  if (looksLikeSpiceValue(t)) return false;
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(t);
}

/**
 * Coerce / drop a setParam so diodes get `model` and passives get `value`.
 * When `kind` is known, unknown keys for that kind are dropped.
 */
export function coerceSetParam(
  keyRaw: string,
  valueRaw: string,
  kind?: ComponentKind | null,
): { key: string; value: string } | null {
  let key = normalizeSetParamKey(keyRaw);
  const value = String(valueRaw ?? "").trim();
  if (!key || !value) return null;

  // LLM often sends key:"value" for a part/model name on diodes/TVS.
  if (key === "value" && looksLikeModelName(value)) {
    key = "model";
  }
  // Rare inverse: model key with a numeric string on a value-only part.
  if (key === "model" && looksLikeSpiceValue(value)) {
    key = "value";
  }

  if (kind && COMPONENT_SPECS[kind]) {
    const allowed = allowedParamKeysForKind(kind);
    if (!allowed.size) return null;
    if (!allowed.has(key)) {
      if (key === "value" && allowed.has("model") && looksLikeModelName(value)) {
        key = "model";
      } else if (key === "model" && allowed.has("value") && looksLikeSpiceValue(value)) {
        key = "value";
      } else {
        return null;
      }
    }
  }

  return { key, value };
}

function filterParamsForKind(
  kind: ComponentKind,
  params: Record<string, string>,
): Record<string, string> | undefined {
  const allowed = allowedParamKeysForKind(kind);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    const coerced = coerceSetParam(k, v, kind);
    if (coerced && allowed.has(coerced.key)) out[coerced.key] = coerced.value;
  }
  return Object.keys(out).length ? out : undefined;
}

export interface ValidateOpsOptions {
  /** Optional refdes → kind map from the live schematic (stricter B3). */
  kindByRefdes?: Record<string, ComponentKind>;
}

/**
 * Validate ops from the assistant API / LLM before applying to the graph.
 * Drops anything malformed so a bad model response cannot break the app.
 */
export function validateOps(raw: unknown, opts?: ValidateOpsOptions): Op[] {
  if (!Array.isArray(raw)) return [];
  const out: Op[] = [];
  const kindByRefdes = opts?.kindByRefdes ?? {};

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const type = o.type;

    if (type === "addComponent") {
      const kind = String(o.kind ?? "") as ComponentKind;
      if (!KINDS.has(kind)) continue;
      const paramsRaw = o.params;
      let params: Record<string, string> | undefined;
      if (paramsRaw && typeof paramsRaw === "object" && !Array.isArray(paramsRaw)) {
        const draft: Record<string, string> = {};
        for (const [k, v] of Object.entries(paramsRaw as Record<string, unknown>)) {
          const key = String(k).trim();
          const value = String(v ?? "").trim();
          if (key && value) draft[key] = value;
        }
        params = filterParamsForKind(kind, draft);
      } else if (o.value != null && String(o.value).trim()) {
        params = filterParamsForKind(kind, { value: String(o.value).trim() });
      }
      out.push(params ? { type: "addComponent", kind, params } : { type: "addComponent", kind });
      continue;
    }

    if (type === "setParam") {
      const refdes = normRef(o.refdes);
      const value = String(o.value ?? "").trim();
      const kind =
        kindByRefdes[refdes] ?? kindByRefdes[refdes.toUpperCase()] ?? null;
      const coerced = coerceSetParam(String(o.key ?? ""), value, kind);
      if (refdes && coerced) {
        out.push({ type: "setParam", refdes, key: coerced.key, value: coerced.value });
      }
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
