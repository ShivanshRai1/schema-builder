/**
 * Detect netlist dialects that are not SPICE decks.
 * Apply must refuse these so the schematic is never wiped by a foreign paste.
 */

export type NetlistFormatKind = "spice" | "expresspcb" | "foreign";

export type NetlistFormatInfo = {
  kind: NetlistFormatKind;
  /** Human message when kind !== "spice". */
  message?: string;
};

/**
 * Classify pasted netlist text. Default is "spice" (existing Apply path).
 * ExpressPCB / mostly-quoted tables are rejected before any graph mutation.
 */
export function classifyNetlistText(text: string): NetlistFormatInfo {
  const t = text.trim();
  if (!t) return { kind: "spice" };

  if (
    /ExpressPCB\s+Netlist/i.test(t) ||
    /"Part IDs Table"/i.test(t) ||
    /"Net Names Table"/i.test(t) ||
    /"Net Connections Table"/i.test(t)
  ) {
    return {
      kind: "expresspcb",
      message:
        "This is an LTspice ExpressPCB .net file, not a SPICE deck. " +
        "Use a SPICE netlist (lines like V1 n1 0 PULSE(...), R1 n1 n2 1k). " +
        "Your schematic was not changed.",
    };
  }

  const lines = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("*") && !l.startsWith("."));
  if (lines.length >= 6) {
    const quoted = lines.filter((l) => l.startsWith('"')).length;
    if (quoted / lines.length >= 0.6) {
      return {
        kind: "foreign",
        message:
          "This text does not look like a SPICE netlist (too many quoted table lines). " +
          "Paste a SPICE deck instead. Your schematic was not changed.",
      };
    }
  }

  return { kind: "spice" };
}
