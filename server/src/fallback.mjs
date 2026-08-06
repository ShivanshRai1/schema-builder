/**
 * Local NL fallback when the LLM returns a reply but empty/invalid ops.
 * Keep in sync with src/llm/ops.ts interpret().
 */

const KIND_WORDS = {
  resistor: "R", resistors: "R", resistance: "R", ohm: "R", ohms: "R", r: "R",
  inductor: "L", inductors: "L", inductance: "L", henry: "L", henries: "L", l: "L", coil: "L",
  capacitor: "C", capacitors: "C", capacitance: "C", farad: "C", cap: "C", caps: "C", c: "C",
  vsource: "V", voltage: "V", voltagesource: "V", battery: "V", supply: "V", vdc: "V", v: "V",
  isource: "I", current: "I", currentsource: "I", idc: "I", i: "I",
  diode: "D", diodes: "D", d: "D",
  mosfet: "NMOS", nmos: "NMOS", pmos: "PMOS", transistor: "NMOS", fet: "NMOS",
  sic: "SICMOS", sicmosfet: "SICMOS", gan: "GANHEMT", ganhemt: "GANHEMT", igbt: "IGBT",
  bjt: "NPN", npn: "NPN", pnp: "PNP",
  thyristor: "SCR", scr: "SCR",
  driver: "GATEDRV", gatedriver: "GATEDRV", gatedrv: "GATEDRV",
  comparator: "COMP", comp: "COMP",
  opamp: "EAMP", eamp: "EAMP", erroramp: "EAMP", amplifier: "EAMP",
  shunt: "CSENSE", csense: "CSENSE",
  vsense: "VSENSE", vprobe: "VPROBE", iprobe: "IPROBE", ammeter: "IPROBE",
  ground: "GND", gnd: "GND", earth: "GND",
  node: "NODE", label: "NODE", netlabel: "NODE",
};

const KEY_ALIASES = {
  value: "value", val: "value", param: "value", parameter: "value",
  resistance: "value", resistivity: "value", ohms: "value", ohm: "value",
  capacitance: "value", farads: "value", farad: "value",
  inductance: "value", henries: "value", henry: "value",
  voltage: "value", volts: "value", volt: "value",
  current: "value", amps: "value", amp: "value", amperes: "value",
  r: "value", c: "value", l: "value",
  model: "model", type: "model",
  name: "name", label: "name",
  ic: "ic",
};

const ADD_VERBS = "add|insert|place|create|put|include|drop|spawn|introduce|append|new";
const SET_VERBS = "set|change|update|modify|edit|adjust|make|alter|revise|tune|replace|switch|assign|configure|fix";
const DEL_VERBS = "delete|remove|erase|drop|clear|discard|destroy|kill|omit|exclude|uninstall|take\\s+out|get\\s+rid\\s+of";
const VALUE_WORDS = "value|val|param(?:eter)?|resistance|capacitance|inductance|ohms?|farads?|henr(?:y|ies)|voltage|current|amps?|volts?|model|name|ic";

function normalizeUtterance(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/[.!?]+$/g, "")
    .replace(
      /^(?:please|pls|can\s+you|could\s+you|would\s+you|hey|hi|hello|ok(?:ay)?|just|now|then|also|and|,|\s)+/gi,
      "",
    )
    .replace(/^(?:i\s+(?:want\s+to|need\s+to|would\s+like\s+to|wanna)\s+)/i, "")
    .replace(/^(?:try\s+to\s+|go\s+ahead\s+and\s+)/i, "")
    .trim();
}

/**
 * @param {string} input
 * @returns {{ ops: object[], reply: string } | null}
 */
export function interpretFallback(input) {
  const text = normalizeUtterance(input);
  if (!text) return null;

  const disc = matchDisconnect(text);
  if (disc) return disc;

  const conn = matchConnect(text);
  if (conn) return conn;

  const del = matchDelete(text);
  if (del) return del;

  const add = matchAdd(text);
  if (add) return add;

  const set = matchSet(text);
  if (set) return set;

  return null;
}

const REF = "([A-Za-z]+\\d+|GND|ground|earth|0)";
const PIN = "([A-Za-z][A-Za-z0-9]*)";
const ENDPOINT = `${REF}(?:\\s*(?:\\.|\\s+pin\\s+|\\s+pin\\s*=\\s*|\\s+)\\s*${PIN})?`;

function normalizeRefToken(raw) {
  const t = String(raw ?? "").trim().toUpperCase();
  if (t === "GROUND" || t === "EARTH" || t === "0") return "GND";
  return t;
}

function matchConnect(text) {
  if (!/^(?:connect|wire|link|join|attach|rewire|reconnect)\b/i.test(text)) return null;
  const withPins = text.match(
    new RegExp(
      `^(?:connect|wire|link|join|attach|rewire|reconnect)\\s+${ENDPOINT}\\s+(?:to|with|and|->|→)\\s+${ENDPOINT}$`,
      "i",
    ),
  );
  if (!withPins) return null;
  const aRefdes = normalizeRefToken(withPins[1]);
  const aPin = withPins[2]?.trim().toLowerCase();
  const bRefdes = normalizeRefToken(withPins[3]);
  const bPin = withPins[4]?.trim().toLowerCase();
  const op = {
    type: "connectPins",
    aRefdes,
    bRefdes,
    ...(aPin ? { aPin } : {}),
    ...(bPin ? { bPin } : {}),
  };
  const aLabel = aPin ? `${aRefdes}.${aPin}` : aRefdes;
  const bLabel = bPin ? `${bRefdes}.${bPin}` : bRefdes;
  return { ops: [op], reply: `Connected ${aLabel} → ${bLabel}.` };
}

function matchDisconnect(text) {
  if (!/^(?:disconnect|unwire|unlink|detach)\b/i.test(text)) return null;
  const both = text.match(
    new RegExp(
      `^(?:disconnect|unwire|unlink|detach)\\s+${ENDPOINT}\\s+(?:from|and|->|→)\\s+${ENDPOINT}$`,
      "i",
    ),
  );
  if (both) {
    const aRefdes = normalizeRefToken(both[1]);
    const aPin = both[2]?.trim().toLowerCase();
    const bRefdes = normalizeRefToken(both[3]);
    const bPin = both[4]?.trim().toLowerCase();
    return {
      ops: [
        {
          type: "disconnectPins",
          aRefdes,
          bRefdes,
          ...(aPin ? { aPin } : {}),
          ...(bPin ? { bPin } : {}),
        },
      ],
      reply: `Disconnected ${aRefdes}${aPin ? "." + aPin : ""} from ${bRefdes}${bPin ? "." + bPin : ""}.`,
    };
  }
  const one = text.match(
    new RegExp(
      `^(?:disconnect|unwire|unlink|detach)\\s+(?:(?:all\\s+(?:wires?\\s+)?(?:on|from|of)\\s+)?)?${ENDPOINT}$`,
      "i",
    ),
  );
  if (one) {
    const aRefdes = normalizeRefToken(one[1]);
    const aPin = one[2]?.trim().toLowerCase();
    return {
      ops: [{ type: "disconnectPins", aRefdes, ...(aPin ? { aPin } : {}) }],
      reply: aPin
        ? `Disconnected pin ${aRefdes}.${aPin}.`
        : `Disconnected all wires on ${aRefdes}.`,
    };
  }
  return null;
}

function matchAdd(text) {
  const re = new RegExp(
    `^(?:${ADD_VERBS})\\s+(?:(?:a|an|another|one|new|the)\\s+)*([a-z][a-z0-9]*)`,
    "i",
  );
  const m = text.match(re);
  if (!m) return null;
  const word = m[1].toLowerCase().replace(/[^a-z]/g, "");
  const kind = KIND_WORDS[word];
  if (!kind) return null;
  return { ops: [{ type: "addComponent", kind }], reply: `Added ${kind}.` };
}

function matchSet(text) {
  const strict = text.match(
    new RegExp(`^(?:${SET_VERBS})\\s+([A-Za-z]+\\d+)\\s+(${VALUE_WORDS})\\s+(?:to\\s+|as\\s+|==?\\s*)?(.+)$`, "i"),
  );
  if (strict) {
    const refdes = strict[1].toUpperCase();
    const key = normalizeKey(strict[2]);
    const value = cleanValue(strict[3]);
    if (key && value) {
      return {
        ops: [{ type: "setParam", refdes, key, value }],
        reply: `Set ${refdes} ${key} = ${value}.`,
      };
    }
  }

  const patterns = [
    new RegExp(
      `^(?:${SET_VERBS})\\s+(?:the\\s+)?([A-Za-z]+\\d+)(?:'s)?\\s+(?:the\\s+)?(${VALUE_WORDS})\\s+(?:to\\s+|as\\s+|==?\\s*)(.+)$`,
      "i",
    ),
    new RegExp(
      `^(?:${SET_VERBS})\\s+(?:the\\s+)?(${VALUE_WORDS})\\s+(?:of\\s+|for\\s+|on\\s+)?([A-Za-z]+\\d+)\\s+(?:to\\s+|as\\s+|==?\\s*)(.+)$`,
      "i",
    ),
    /^(?:give|assign)\s+([A-Za-z]+\d+)\s+(?:a\s+)?(?:value|resistance|capacitance|inductance)\s+(?:of\s+)?(.+)$/i,
    new RegExp(`^(?:${SET_VERBS})\\s+([A-Za-z]+\\d+)\\s+(?:(?:to|as|=|==)\\s*)?(.+)$`, "i"),
    new RegExp(`^([A-Za-z]+\\d+)\\s+(?:(?:${VALUE_WORDS})\\s+)?(?:(?:to|as|=|==)\\s*)(.+)$`, "i"),
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;

    if (m.length >= 4) {
      let refdes = "";
      let key = "value";
      let value = "";
      if (/^[A-Za-z]+\d+$/i.test(m[1]) && isValueWord(m[2])) {
        refdes = m[1].toUpperCase();
        key = normalizeKey(m[2]);
        value = cleanValue(m[3]);
      } else if (isValueWord(m[1]) && /^[A-Za-z]+\d+$/i.test(m[2])) {
        key = normalizeKey(m[1]);
        refdes = m[2].toUpperCase();
        value = cleanValue(m[3]);
      }
      if (refdes && key && value) {
        return {
          ops: [{ type: "setParam", refdes, key, value }],
          reply: `Set ${refdes} ${key} = ${value}.`,
        };
      }
    }

    if (m.length >= 3 && /^[A-Za-z]+\d+$/i.test(m[1])) {
      const refdes = m[1].toUpperCase();
      const value = cleanValue(m[m.length - 1]);
      if (!value || /^(a|an|the)\b/i.test(value)) continue;
      return {
        ops: [{ type: "setParam", refdes, key: "value", value }],
        reply: `Set ${refdes} value = ${value}.`,
      };
    }
  }
  return null;
}

function isValueWord(s) {
  return /^(?:value|val|param(?:eter)?|resistance|capacitance|inductance|ohms?|farads?|henr(?:y|ies)|voltage|current|amps?|volts?|model|name|ic)$/i.test(
    String(s ?? "").trim(),
  );
}

function matchDelete(text) {
  const re = new RegExp(
    `^(?:${DEL_VERBS})\\s+(?:(?:the|this|that|component|part|device)\\s+)*([A-Za-z]+\\d+)`,
    "i",
  );
  const m = text.match(re);
  if (!m) return null;
  const refdes = m[1].toUpperCase();
  return {
    ops: [{ type: "deleteComponent", refdes }],
    reply: `Removed ${refdes}.`,
  };
}

function normalizeKey(key) {
  const k = String(key ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  return KEY_ALIASES[k] ?? (k || "value");
}

function cleanValue(v) {
  return String(v ?? "").trim().replace(/^["']|["']$/g, "").replace(/\s+/g, " ");
}

/**
 * @param {unknown} raw
 */
export function normalizeOps(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (!item || typeof item !== "object") return item;
    if (item.type === "setParam") {
      return {
        type: "setParam",
        refdes: String(item.refdes ?? "").trim().toUpperCase(),
        key: normalizeKey(String(item.key ?? "")),
        value: cleanValue(String(item.value ?? "")),
      };
    }
    if (item.type === "deleteComponent") {
      return {
        type: "deleteComponent",
        refdes: String(item.refdes ?? "").trim().toUpperCase(),
      };
    }
    if (item.type === "connectPins") {
      return {
        type: "connectPins",
        aRefdes: normRef(item.aRefdes ?? item.from),
        bRefdes: normRef(item.bRefdes ?? item.to),
        ...(optPin(item.aPin) ? { aPin: optPin(item.aPin) } : {}),
        ...(optPin(item.bPin) ? { bPin: optPin(item.bPin) } : {}),
      };
    }
    if (item.type === "disconnectPins") {
      const bRaw = String(item.bRefdes ?? item.to ?? "").trim();
      return {
        type: "disconnectPins",
        aRefdes: normRef(item.aRefdes ?? item.refdes ?? item.from),
        ...(optPin(item.aPin) ? { aPin: optPin(item.aPin) } : {}),
        ...(bRaw ? { bRefdes: normRef(bRaw) } : {}),
        ...(optPin(item.bPin) ? { bPin: optPin(item.bPin) } : {}),
      };
    }
    return item;
  });
}

function normRef(s) {
  const t = String(s ?? "").trim().toUpperCase();
  if (t === "GROUND" || t === "EARTH" || t === "0") return "GND";
  return t;
}

function optPin(s) {
  const p = String(s ?? "").trim().toLowerCase();
  return p || undefined;
}
