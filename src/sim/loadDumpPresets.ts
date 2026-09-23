/**
 * ISO 16750-2 Test A part-number rows (email PN table).
 * Selecting a PN fills UA/Us/Ri/td and binds the model to D1 (XFD) or D2 (SM).
 * Pulse profile is a separate control — tweaking numbers must not clear the PN
 * or switch the pulse to a “custom” shape.
 */

import type { LoadDumpConditions, LoadDumpPulseId } from "./loadDumpConditions";

export type LoadDumpDiodeSlot = "D1" | "D2";

export type LoadDumpPreset = {
  /** Stable id for the select value (PN can repeat with different UA). */
  id: string;
  /** Short label shown in the Part number dropdown. */
  label: string;
  pn: string;
  /** Recommended test-pulse profile for this table row (usually ISO16750_A). */
  pulse: LoadDumpPulseId;
  /** Which schematic diode gets this PN model (email: XFD→D1, SM→D2). */
  diodeSlot: LoadDumpDiodeSlot;
  /** Preferred symbol kind for that slot. */
  diodeKind: "DTVS" | "DTVSBI";
  conditions: LoadDumpConditions;
};

function cond(
  partial: Omit<LoadDumpConditions, "pulse" | "trMs" | "simStopMs"> & {
    pulse?: LoadDumpPulseId;
    trMs?: string;
    simStopMs?: string;
  },
): LoadDumpConditions {
  return {
    trMs: partial.trMs ?? "10",
    simStopMs: partial.simStopMs ?? "1000",
    pulse: partial.pulse ?? "ISO16750_A",
    usPeak: partial.usPeak,
    uaSupply: partial.uaSupply,
    ri: partial.ri,
    tdMs: partial.tdMs,
  };
}

/** Email table rows — tr=10 ms, stop=1 s (matches example .tran). */
export const LOAD_DUMP_PRESETS: readonly LoadDumpPreset[] = [
  {
    id: "SM5S36A_12",
    label: "SM5S36A · 12V",
    pn: "SM5S36A",
    pulse: "ISO16750_A",
    diodeSlot: "D2",
    diodeKind: "DTVS",
    conditions: cond({ usPeak: "101", uaSupply: "12", ri: "1", tdMs: "400" }),
  },
  {
    id: "SM8S36A_12",
    label: "SM8S36A · 12V",
    pn: "SM8S36A",
    pulse: "ISO16750_A",
    diodeSlot: "D2",
    diodeKind: "DTVS",
    conditions: cond({ usPeak: "101", uaSupply: "12", ri: "1", tdMs: "400" }),
  },
  {
    id: "SM8S36A_24",
    label: "SM8S36A · 24V",
    pn: "SM8S36A",
    pulse: "ISO16750_A",
    diodeSlot: "D2",
    diodeKind: "DTVS",
    conditions: cond({ usPeak: "202", uaSupply: "24", ri: "3", tdMs: "350" }),
  },
  {
    id: "XFD11K48CA_24",
    label: "XFD11K48CA · 24V",
    pn: "XFD11K48CA",
    pulse: "ISO16750_A",
    diodeSlot: "D1",
    diodeKind: "DTVSBI",
    conditions: cond({ usPeak: "202", uaSupply: "24", ri: "8", tdMs: "350" }),
  },
  {
    id: "XFD11K54CA_24",
    label: "XFD11K54CA · 24V",
    pn: "XFD11K54CA",
    pulse: "ISO16750_A",
    diodeSlot: "D1",
    diodeKind: "DTVSBI",
    conditions: cond({ usPeak: "202", uaSupply: "24", ri: "8", tdMs: "350" }),
  },
  {
    id: "XFD11K58CA_24",
    label: "XFD11K58CA · 24V",
    pn: "XFD11K58CA",
    pulse: "ISO16750_A",
    diodeSlot: "D1",
    diodeKind: "DTVSBI",
    conditions: cond({ usPeak: "202", uaSupply: "24", ri: "4", tdMs: "350" }),
  },
];

export function findLoadDumpPreset(id: string): LoadDumpPreset | undefined {
  return LOAD_DUMP_PRESETS.find((p) => p.id === id);
}

/** Suggested tab / project name when saving from the sim toolbar. */
export function loadDumpConditionSaveName(
  partNumberId: string,
  c: LoadDumpConditions,
): string {
  const preset = findLoadDumpPreset(partNumberId);
  if (preset) return preset.id;
  const ua = (c.uaSupply.trim() || "UA").replace(/[^\w.-]+/g, "");
  const us = (c.usPeak.trim() || "Us").replace(/[^\w.-]+/g, "");
  return `${c.pulse}_${ua}V_Us${us}`;
}
