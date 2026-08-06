/** Allowed ComponentKind values (keep in sync with src/model/types.ts). */
const KINDS = new Set([
  "R", "L", "C", "V", "I", "D", "NMOS", "PMOS", "SICMOS", "SICMOS_K", "GANHEMT",
  "IGBT", "IGBT_K", "NPN", "PNP", "SCR", "GATEDRV", "COMP", "EAMP",
  "CSENSE", "VSENSE", "IPROBE", "VPROBE", "GND", "NODE",
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

/**
 * Server-side op validation (same rules as frontend validateOps).
 * @param {unknown} raw
 */
export function validateOpsPayload(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];

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
      let key = String(item.key ?? "").trim().toLowerCase();
      if (key === "resistance" || key === "capacitance" || key === "inductance") key = "value";
      const value = String(item.value ?? "").trim();
      if (refdes && key) out.push({ type: "setParam", refdes, key, value });
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
