/**
 * Detect netlist dialects.
 * ExpressPCB is converted on Apply (simplified). Other foreign quoted tables are refused.
 */

export type NetlistFormatKind = "spice" | "expresspcb" | "foreign";

export type NetlistFormatInfo = {
  kind: NetlistFormatKind;
  /** Human message when kind is foreign (or legacy expresspcb hint). */
  message?: string;
};

/**
 * Classify pasted netlist text. Default is "spice" (existing Apply path).
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
        "LTspice ExpressPCB .net — Apply will convert to a simplified schematic " +
        "(FETs → SIC_MOS, V=if → VPULSE).",
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
