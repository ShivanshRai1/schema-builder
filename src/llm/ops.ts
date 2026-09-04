import type { ComponentKind } from "../model/types";

// ---------------------------------------------------------------------------
// Structured circuit edit operations + natural-language interpret / fallback.
// ---------------------------------------------------------------------------

export type Op =
  | { type: "addComponent"; kind: ComponentKind; params?: Record<string, string> }
  | { type: "setParam"; refdes: string; key: string; value: string }
  | { type: "deleteComponent"; refdes: string }
  | {
      type: "connectPins";
      aRefdes: string;
      bRefdes: string;
      /** Pin id; omit/empty → auto-pick (right/bottom ↔ left/top). */
      aPin?: string;
      bPin?: string;
    }
  | {
      type: "disconnectPins";
      aRefdes: string;
      aPin?: string;
      bRefdes?: string;
      bPin?: string;
    };

export interface InterpretResult {
  ops: Op[];
  reply: string;
}

const KIND_WORDS: Record<string, ComponentKind> = {
  resistor: "R", resistors: "R", resistance: "R", ohm: "R", ohms: "R", r: "R",
  rheostat: "RVAR", potentiometer: "POT", pot: "POT",
  inductor: "L", inductors: "L", inductance: "L", henry: "L", henries: "L", l: "L", coil: "L",
  varinductor: "LVAR", variableinductor: "LVAR",
  capacitor: "C", capacitors: "C", capacitance: "C", farad: "C", cap: "C", caps: "C", c: "C",
  polarized: "CPOL", electrolytic: "CPOL",
  varicap: "CVAR",
  vsource: "V", voltage: "V", voltagesource: "V", battery: "V", supply: "V", vdc: "V", v: "V",
  isource: "I", current: "I", currentsource: "I", idc: "I", i: "I",
  diode: "D", diodes: "D", d: "D",
  zener: "DZ", zenerdiode: "DZ", zenerdiodes: "DZ", dz: "DZ",
  mosfet: "NMOS", nmos: "NMOS", pmos: "PMOS", transistor: "NMOS", fet: "NMOS",
  jfet: "NJFET", njfet: "NJFET", pjfet: "PJFET",
  sic: "SICMOS", sicmosfet: "SICMOS", gan: "GANHEMT", ganhemt: "GANHEMT", igbt: "IGBT",
  bjt: "NPN", npn: "NPN", pnp: "PNP",
  thyristor: "SCR", scr: "SCR",
  driver: "GATEDRV", gatedriver: "GATEDRV", gatedrv: "GATEDRV",
  comparator: "COMP", comp: "COMP",
  opamp: "OPAMP", operationalamplifier: "OPAMP",
  eamp: "OPAMP", erroramp: "OPAMP", amplifier: "OPAMP",
  shunt: "CSENSE", csense: "CSENSE",
  vsense: "VSENSE", vprobe: "VPROBE", iprobe: "IPROBE", ammeter: "IPROBE",
  ground: "GND", gnd: "GND", earth: "GND",
  node: "NODE", label: "NODE", netlabel: "NODE",
  wirelabel: "WIRELABEL", netname: "WIRELABEL", labelnet: "WIRELABEL",
};

const KEY_ALIASES: Record<string, string> = {
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

/** Strip polite / filler prefixes so patterns can anchor at the verb. */
function normalizeUtterance(raw: string): string {
  return raw
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
 * Rule-based interpreter + NL fallback used when the LLM returns empty ops.
 */
export function interpret(input: string): InterpretResult {
  const text = normalizeUtterance(input);
  if (!text) {
    return { ops: [], reply: "Say something to edit the circuit." };
  }

  // Wire ops before add/set so "connect …" is not misread.
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

  return {
    ops: [],
    reply:
      'Try: "add resistor", "change the R1 value to 4.7k", "connect R1 to C1", "connect R1.b to C1.a", "disconnect R1", "remove C1".',
  };
}

const REF = "([A-Za-z]+\\d+|GND|ground|earth|0)";
const PIN = "([A-Za-z][A-Za-z0-9]*)";
const ENDPOINT = `${REF}(?:\\s*(?:\\.|\\s+pin\\s+|\\s+pin\\s*=\\s*|\\s+)\\s*${PIN})?`;

function normalizeRefToken(raw: string): string {
  const t = raw.trim().toUpperCase();
  if (t === "GROUND" || t === "EARTH" || t === "0") return "GND";
  return t;
}

function matchConnect(text: string): InterpretResult | null {
  if (!/^(?:connect|wire|link|join|attach|rewire|reconnect)\b/i.test(text)) return null;

  // connect R1.b to C1.a / wire R1 pin b to C1 pin a
  const withPins = text.match(
    new RegExp(
      `^(?:connect|wire|link|join|attach|rewire|reconnect)\\s+${ENDPOINT}\\s+(?:to|with|and|->|→)\\s+${ENDPOINT}$`,
      "i",
    ),
  );
  if (withPins) {
    const aRefdes = normalizeRefToken(withPins[1]);
    const aPin = withPins[2]?.trim().toLowerCase();
    const bRefdes = normalizeRefToken(withPins[3]);
    const bPin = withPins[4]?.trim().toLowerCase();
    const op: Op = {
      type: "connectPins",
      aRefdes,
      bRefdes,
      ...(aPin ? { aPin } : {}),
      ...(bPin ? { bPin } : {}),
    };
    const aLabel = aPin ? `${aRefdes}.${aPin}` : aRefdes;
    const bLabel = bPin ? `${bRefdes}.${bPin}` : bRefdes;
    return { ops: [op], reply: `Ready to connect ${aLabel} → ${bLabel}.` };
  }
  return null;
}

function matchDisconnect(text: string): InterpretResult | null {
  if (!/^(?:disconnect|unwire|unlink|detach)\b/i.test(text)) return null;

  // disconnect R1.b from C1.a
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
      reply: `Ready to disconnect ${aRefdes}${aPin ? "." + aPin : ""} from ${bRefdes}${bPin ? "." + bPin : ""}.`,
    };
  }

  // disconnect R1 / unwire R1.b
  const one = text.match(
    new RegExp(`^(?:disconnect|unwire|unlink|detach)\\s+(?:(?:all\\s+(?:wires?\\s+)?(?:on|from|of)\\s+)?)?${ENDPOINT}$`, "i"),
  );
  if (one) {
    const aRefdes = normalizeRefToken(one[1]);
    const aPin = one[2]?.trim().toLowerCase();
    return {
      ops: [{ type: "disconnectPins", aRefdes, ...(aPin ? { aPin } : {}) }],
      reply: aPin ? `Ready to disconnect pin ${aRefdes}.${aPin}.` : `Ready to disconnect all wires on ${aRefdes}.`,
    };
  }
  return null;
}

function matchAdd(text: string): InterpretResult | null {
  // "add 10k resistor" / "add resistor 10k" / "add a 4.7k resistor"
  const withValueFirst = text.match(
    new RegExp(
      `^(?:${ADD_VERBS})\\s+(?:(?:a|an|another|one|new|the)\\s+)*([0-9.][\\w.]*)\\s+([a-z][a-z0-9]*)$`,
      "i",
    ),
  );
  if (withValueFirst) {
    const value = withValueFirst[1]!;
    const word = withValueFirst[2]!.toLowerCase().replace(/[^a-z]/g, "");
    const kind = KIND_WORDS[word];
    if (kind) {
      return {
        ops: [{ type: "addComponent", kind, params: { value } }],
        reply: `Ready to add ${kind} (${value}) — confirm in the form.`,
      };
    }
  }

  const withValueLast = text.match(
    new RegExp(
      `^(?:${ADD_VERBS})\\s+(?:(?:a|an|another|one|new|the)\\s+)*([a-z][a-z0-9]*)\\s+([0-9.][\\w.]*)$`,
      "i",
    ),
  );
  if (withValueLast) {
    const word = withValueLast[1]!.toLowerCase().replace(/[^a-z]/g, "");
    const value = withValueLast[2]!;
    const kind = KIND_WORDS[word];
    if (kind) {
      return {
        ops: [{ type: "addComponent", kind, params: { value } }],
        reply: `Ready to add ${kind} (${value}) — confirm in the form.`,
      };
    }
  }

  const re = new RegExp(
    `^(?:${ADD_VERBS})\\s+(?:(?:a|an|another|one|new|the|another)\\s+)*([a-z][a-z0-9]*)`,
    "i",
  );
  const m = text.match(re);
  if (!m) return null;
  const word = m[1].toLowerCase().replace(/[^a-z]/g, "");
  const kind = KIND_WORDS[word];
  if (!kind) return null;
  return { ops: [{ type: "addComponent", kind }], reply: `Ready to add ${kind} — confirm in the form.` };
}

function matchSet(text: string): InterpretResult | null {
  // "set R1 value 4.7k" / "set R1 value to 4.7k" / "set R1 model Foo"
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
        reply: `Ready to set ${refdes} ${key} = ${value}.`,
      };
    }
  }

  const patterns: RegExp[] = [
    // change the R1 value to 4.7k / update R1's resistance to 4.7k
    new RegExp(
      `^(?:${SET_VERBS})\\s+(?:the\\s+)?([A-Za-z]+\\d+)(?:'s)?\\s+(?:the\\s+)?(${VALUE_WORDS})\\s+(?:to\\s+|as\\s+|==?\\s*)(.+)$`,
      "i",
    ),
    // change value of R1 to 4.7k / modify the resistance of R1 to 4.7k
    new RegExp(
      `^(?:${SET_VERBS})\\s+(?:the\\s+)?(${VALUE_WORDS})\\s+(?:of\\s+|for\\s+|on\\s+)?([A-Za-z]+\\d+)\\s+(?:to\\s+|as\\s+|==?\\s*)(.+)$`,
      "i",
    ),
    // give R1 a value of 4.7k / give R1 value 4.7k
    /^(?:give|assign)\s+([A-Za-z]+\d+)\s+(?:a\s+)?(?:value|resistance|capacitance|inductance)\s+(?:of\s+)?(.+)$/i,
    // change R1 to 4.7k / set R1 = 4.7k / make C1 2.2n
    new RegExp(`^(?:${SET_VERBS})\\s+([A-Za-z]+\\d+)\\s+(?:(?:to|as|=|==)\\s*)?(.+)$`, "i"),
    // R1 = 4.7k / R1 value = 4.7k / R1 to 4.7k
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
          reply: `Ready to set ${refdes} ${key} = ${value}.`,
        };
      }
    }

    if (m.length >= 3 && /^[A-Za-z]+\d+$/i.test(m[1])) {
      const refdes = m[1].toUpperCase();
      const value = cleanValue(m[m.length - 1]);
      if (!value || /^(a|an|the)\b/i.test(value)) continue;
      return {
        ops: [{ type: "setParam", refdes, key: "value", value }],
        reply: `Ready to set ${refdes} value = ${value}.`,
      };
    }
  }
  return null;
}

function isValueWord(s: string): boolean {
  return /^(?:value|val|param(?:eter)?|resistance|capacitance|inductance|ohms?|farads?|henr(?:y|ies)|voltage|current|amps?|volts?|model|name|ic)$/i.test(
    String(s ?? "").trim(),
  );
}

function matchDelete(text: string): InterpretResult | null {
  const re = new RegExp(
    `^(?:${DEL_VERBS})\\s+(?:(?:the|this|that|component|part|device)\\s+)*([A-Za-z]+\\d+)`,
    "i",
  );
  const m = text.match(re);
  if (!m) return null;
  const refdes = m[1].toUpperCase();
  return {
    ops: [{ type: "deleteComponent", refdes }],
    reply: `Ready to remove ${refdes}.`,
  };
}

function normalizeKey(key: string): string {
  const k = key.trim().toLowerCase().replace(/[^a-z]/g, "");
  return KEY_ALIASES[k] ?? (k || "value");
}

function cleanValue(v: string): string {
  return v.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, " ");
}
