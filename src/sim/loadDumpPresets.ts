/**
 * ISO 16750-2 Test A condition table (email PN rows).
 * Selecting a row fills Working Conditions and binds the PN model to D1/D2.
 */

import type { LoadDumpConditions } from "./loadDumpConditions";

export type LoadDumpDiodeSlot = "D1" | "D2";

export type LoadDumpPreset = {
  /** Stable id for the select value (PN can repeat with different UA). */
  id: string;
  /** Short label shown in the dropdown. */
  label: string;
  pn: string;
  pulse: "ISO16750_A";
  /** Which schematic diode gets this PN model (email: XFD→D1, SM→D2). */
  diodeSlot: LoadDumpDiodeSlot;
  /** Preferred symbol kind for that slot. */
  diodeKind: "DTVS" | "DTVSBI";
  conditions: LoadDumpConditions;
};

/** Email table rows — tr=10 ms, stop=1 s (matches example .tran). */
export const LOAD_DUMP_PRESETS: readonly LoadDumpPreset[] = [
  {
    id: "SM5S36A_12",
    label: "SM5S36A · 12V",
    pn: "SM5S36A",
    pulse: "ISO16750_A",
    diodeSlot: "D2",
    diodeKind: "DTVS",
    conditions: {
      usPeak: "101",
      uaSupply: "12",
      ri: "1",
      trMs: "10",
      tdMs: "400",
      simStopMs: "1000",
    },
  },
  {
    id: "SM8S36A_12",
    label: "SM8S36A · 12V",
    pn: "SM8S36A",
    pulse: "ISO16750_A",
    diodeSlot: "D2",
    diodeKind: "DTVS",
    conditions: {
      usPeak: "101",
      uaSupply: "12",
      ri: "1",
      trMs: "10",
      tdMs: "400",
      simStopMs: "1000",
    },
  },
  {
    id: "SM8S36A_24",
    label: "SM8S36A · 24V",
    pn: "SM8S36A",
    pulse: "ISO16750_A",
    diodeSlot: "D2",
    diodeKind: "DTVS",
    conditions: {
      usPeak: "202",
      uaSupply: "24",
      ri: "3",
      trMs: "10",
      tdMs: "350",
      simStopMs: "1000",
    },
  },
  {
    id: "XFD11K48CA_24",
    label: "XFD11K48CA · 24V",
    pn: "XFD11K48CA",
    pulse: "ISO16750_A",
    diodeSlot: "D1",
    diodeKind: "DTVSBI",
    conditions: {
      usPeak: "202",
      uaSupply: "24",
      ri: "8",
      trMs: "10",
      tdMs: "350",
      simStopMs: "1000",
    },
  },
  {
    id: "XFD11K54CA_24",
    label: "XFD11K54CA · 24V",
    pn: "XFD11K54CA",
    pulse: "ISO16750_A",
    diodeSlot: "D1",
    diodeKind: "DTVSBI",
    conditions: {
      usPeak: "202",
      uaSupply: "24",
      ri: "8",
      trMs: "10",
      tdMs: "350",
      simStopMs: "1000",
    },
  },
  {
    id: "XFD11K58CA_24",
    label: "XFD11K58CA · 24V",
    pn: "XFD11K58CA",
    pulse: "ISO16750_A",
    diodeSlot: "D1",
    diodeKind: "DTVSBI",
    conditions: {
      usPeak: "202",
      uaSupply: "24",
      ri: "4",
      trMs: "10",
      tdMs: "350",
      simStopMs: "1000",
    },
  },
];

export function findLoadDumpPreset(id: string): LoadDumpPreset | undefined {
  return LOAD_DUMP_PRESETS.find((p) => p.id === id);
}
