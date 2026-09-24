/**
 * Server-side op validation (keep aligned with src/llm/validateOps.ts).
 */

/** Allowed ComponentKind values (keep in sync with frontend catalog as needed). */
const KINDS = new Set([
  "R", "RBOX", "RVAR", "POT", "L", "LVAR", "C", "CPOL", "CVAR", "CFIXED",
  "V", "BATTERY", "VAC", "I", "IAC", "VPULSE",
  "D", "DZ", "DS", "LED", "DTVS", "DTVSBI",
  "NMOS", "PMOS", "NMOS_D", "PMOS_D", "NJFET", "PJFET",
  "SICMOS", "SICMOS_K", "GANHEMT", "IGBT", "IGBT_K", "NPN", "PNP", "UJT",
  "SCR", "GATEDRV", "COMP", "EAMP", "OPAMP", "OPAMP5",
  "CSENSE", "VSENSE", "IPROBE", "VPROBE", "GND", "NODE", "WIRELABEL",
]);

/** Kinds that primarily use model (not value) — used when context kind is missing. */
const MODEL_KINDS = new Set([
  "D", "DZ", "DS", "LED", "DTVS", "DTVSBI",
  "NMOS", "PMOS", "NMOS_D", "PMOS_D", "NJFET", "PJFET",
  "SICMOS", "SICMOS_K", "GANHEMT", "IGBT", "IGBT_K", "NPN", "PNP", "UJT",
  "SCR", "GATEDRV", "XTAL",
]);

function normRef(s) {
  const t = String(s ?? "").trim().toUpperCase();
  if (t === "GROUND" || t === "EARTH" || t === "0") return "GND";
  return t;
}

function optPin(s) {
  const p = String(s ?? "").trim().toLowerCase();
  return p || undefined;
}

function normalizeSetParamKey(raw) {
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

function looksLikeSpiceValue(value) {
  return /^[+\-]?\d/.test(String(value ?? "").trim());
}

function looksLikeModelName(value) {
  const t = String(value ?? "").trim();
  if (!t || t.length > 80) return false;
  if (looksLikeSpiceValue(t)) return false;
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(t);
}

/**
 * @param {string} keyRaw
 * @param {string} valueRaw
 * @param {string | null | undefined} kind
 */
function coerceSetParam(keyRaw, valueRaw, kind) {
  let key = normalizeSetParamKey(keyRaw);
  const value = String(valueRaw ?? "").trim();
  if (!key || !value) return null;

  if (key === "value" && looksLikeModelName(value)) key = "model";
  if (key === "model" && looksLikeSpiceValue(value)) key = "value";

  if (kind && MODEL_KINDS.has(kind) && key === "value" && looksLikeModelName(value)) {
    key = "model";
  }

  return { key, value };
}

/**
 * @param {unknown} raw
 * @param {{ kindByRefdes?: Record<string, string> }} [opts]
 */
export function validateOpsPayload(raw, opts = {}) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const kindByRefdes = opts.kindByRefdes ?? {};

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const type = item.type;

    if (type === "addComponent") {
      const kind = String(item.kind ?? "");
      if (KINDS.has(kind)) out.push({ type: "addComponent", kind });
      continue;
    }
    if (type === "setParam") {
      const refdes = normRef(item.refdes);
      const kind = kindByRefdes[refdes] ?? kindByRefdes[refdes.toUpperCase()] ?? null;
      const coerced = coerceSetParam(String(item.key ?? ""), String(item.value ?? ""), kind);
      if (refdes && coerced) {
        out.push({ type: "setParam", refdes, key: coerced.key, value: coerced.value });
      }
      continue;
    }
    if (type === "deleteComponent") {
      const refdes = normRef(item.refdes);
      if (refdes) out.push({ type: "deleteComponent", refdes });
      continue;
    }
    if (type === "connectPins") {
      const aRefdes = normRef(item.aRefdes ?? item.fromRefdes ?? item.from);
      const bRefdes = normRef(item.bRefdes ?? item.toRefdes ?? item.to);
      const aPin = optPin(item.aPin ?? item.fromPin);
      const bPin = optPin(item.bPin ?? item.toPin);
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
      const aRefdes = normRef(item.aRefdes ?? item.refdes ?? item.from);
      const aPin = optPin(item.aPin);
      const bPin = optPin(item.bPin);
      const bRaw = String(item.bRefdes ?? item.to ?? "").trim();
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
