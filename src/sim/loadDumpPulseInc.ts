/**
 * Email point-3 pulse profiles (ISO 16750-2 Test A / ISO 7637-2 5a).
 * Bundled as .subckt text so Models / Run decks include them without .include files.
 *
 * Schematic stimulus stays V1 PWL + R1 (proven path). These subckts match the
 * email XPULSE definitions for export / future XPULSE instance wiring.
 */

export const PULSE_ISO16750_TESTA_INC = `* ==========================================================
* ISO 16750-2 Test A - unsuppressed load dump
* Us (Uspk) is the ABSOLUTE PEAK voltage.
* XPULSE out 0 ISO16750_TESTA UA=24 Uspk=202 Ri=3 td=350m tr=10m
* ==========================================================
.subckt ISO16750_TESTA out ref params: UA=24 Uspk=202 Ri=3 td=350m tr=10m
.param ln10=2.302585093
.param Usa={Uspk-UA}
.param tpk={1.25*tr}
.param tau={(td-1.125*tr)/ln10}
B1 src ref V = UA + Usa*min(time/tpk,1)*exp(-max(time-tpk,0)/tau)
R1 src out {Ri}
.ends ISO16750_TESTA
`;

export const PULSE_ISO7637_5A_INC = `* ==========================================================
* ISO 7637-2 Test pulse 5a - unsuppressed load dump
* Us is the AMPLITUDE ABOVE UA. Absolute peak = UA + Us.
* XPULSE out 0 ISO7637_5A UA=27.8 Us=123.2 Ri=2 td=350m tr=10m
* ==========================================================
.subckt ISO7637_5A out ref params: UA=27.8 Us=123.2 Ri=2 td=350m tr=10m
.param ln10=2.302585093
.param tpk={1.25*tr}
.param tau={(td-1.125*tr)/ln10}
B1 src ref V = UA + Us*min(time/tpk,1)*exp(-max(time-tpk,0)/tau)
R1 src out {Ri}
.ends ISO7637_5A
`;

const PULSE_LIB_MARKER = "* --- load-dump pulse profiles (ISO16750_TESTA / ISO7637_5A) ---";

/** True if both pulse subckts are already present in library/netlist text. */
export function hasLoadDumpPulseLibrary(text: string): boolean {
  const u = text.toUpperCase();
  return u.includes(".SUBCKT ISO16750_TESTA") && u.includes(".SUBCKT ISO7637_5A");
}

/** Merge pulse .inc bodies into Models library text (idempotent). */
export function ensureLoadDumpPulseLibrary(library: string): string {
  if (hasLoadDumpPulseLibrary(library)) return library;
  const block = [
    PULSE_LIB_MARKER,
    PULSE_ISO16750_TESTA_INC.trim(),
    "",
    PULSE_ISO7637_5A_INC.trim(),
    "",
  ].join("\n");
  const cur = library.trim();
  if (!cur) return `${block}\n`;
  return `${cur}\n\n${block}\n`;
}

/**
 * Equivalent XPULSE instance comment for the active profile (documentation /
 * future instance path). Does not replace V1+R1.
 */
export function formatXpulseComment(c: {
  pulse: string;
  uaSupply: string;
  usPeak: string;
  ri: string;
  tdMs: string;
  trMs: string;
}): string {
  const ua = c.uaSupply.trim() || "24";
  const us = c.usPeak.trim() || "202";
  const ri = c.ri.trim() || "2";
  const td = `${c.tdMs.trim() || "350"}m`;
  const tr = `${c.trMs.trim() || "10"}m`;
  const pulse = String(c.pulse || "").toUpperCase();
  if (pulse.includes("7637")) {
    return `* XPULSE vin 0 ISO7637_5A UA=${ua} Us=${us} Ri=${ri} td=${td} tr=${tr}`;
  }
  return `* XPULSE vin 0 ISO16750_TESTA UA=${ua} Uspk=${us} Ri=${ri} td=${td} tr=${tr}`;
}
