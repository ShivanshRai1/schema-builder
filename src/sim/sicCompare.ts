/** SiC reverse-recovery compare — same models/math as sic_demo.html. */

export type AnaModel = "v1" | "v2";

export interface SicPart {
  mfr: string;
  grp: 1200 | 650;
  CJO: number;
  VJ: number;
  M: number;
  BV: number;
  cf: number;
  c0: number;
  vf25: number;
  vfIf: number;
  tc: number;
  qcDs: number | null;
  rthjc: number;
  ifr: number;
  vf0: number;
  rd: number;
}

export interface SicCond {
  vbus: number;
  il: number;
  iout: number;
  fsw: number;
  duty: number;
  ta: number;
  rthca: number;
  dvdt: number;
}

export interface RrMetrics {
  wave: { x: number; y: number }[];
  irrm: number;
  vd5: number;
  qrr: number;
  trr: number;
  psw: number;
  ptot: number;
}

export interface SicRow {
  part: string;
  err?: string;
  tj: number;
  vf: number;
  pcond: number;
  spice?: RrMetrics;
  ana: RrMetrics;
}

export const SIC_PAL = [
  "#4FC3F7",
  "#3ecf8e",
  "#c792ea",
  "#ff5c5c",
  "#F5B841",
  "#7fdbff",
  "#f78c6c",
  "#82aaff",
  "#e0e0e0",
];

export const SIC_PARTS: Record<string, SicPart> = {
  G5S12002C: {
    mfr: "Globalpower",
    grp: 1200,
    CJO: 171.17e-12,
    VJ: 1.213,
    M: 0.4609,
    BV: 1200,
    cf: 0,
    c0: 171.2e-12,
    vf25: 1.38,
    vfIf: 2,
    tc: 4.24,
    qcDs: 14.3e-9,
    rthjc: 2.96,
    ifr: 8.8,
    vf0: 0.9029,
    rd: 0.2344,
  },
  E4D02120E: {
    mfr: "Wolfspeed",
    grp: 1200,
    CJO: 173.09e-12,
    VJ: 5.713,
    M: 0.533,
    BV: 1200,
    cf: 0,
    c0: 173.1e-12,
    vf25: 1.4,
    vfIf: 2,
    tc: 5.47,
    qcDs: 16e-9,
    rthjc: 2.99,
    ifr: 8,
    vf0: 0.9633,
    rd: 0.2461,
  },
  SDS120J002D3: {
    mfr: "Sanan",
    grp: 1200,
    CJO: 165.71e-12,
    VJ: 1.644,
    M: 0.4799,
    BV: 1200,
    cf: 0,
    c0: 165.7e-12,
    vf25: 1.35,
    vfIf: 2,
    tc: 5.9,
    qcDs: 12.1e-9,
    rthjc: 1.72,
    ifr: 11,
    vf0: 0.9294,
    rd: 0.2038,
  },
  "VS-4C10ET12S2LH": {
    mfr: "Vishay",
    grp: 1200,
    CJO: 798.39e-12,
    VJ: 1.039,
    M: 0.4655,
    BV: 1200,
    cf: 0,
    c0: 798.4e-12,
    vf25: 1.34,
    vfIf: 10,
    tc: 2.26,
    qcDs: 52e-9,
    rthjc: 1.1,
    ifr: 10,
    vf0: 0.9894,
    rd: 0.02967,
  },
  "DSC06A065D1-13": {
    mfr: "Diodes",
    grp: 650,
    CJO: 284.79e-12,
    VJ: 1.278,
    M: 0.4641,
    BV: 650,
    cf: 0,
    c0: 284.8e-12,
    vf25: 1.32,
    vfIf: 6,
    tc: 2.11,
    qcDs: 16.1e-9,
    rthjc: 4.0,
    ifr: 6,
    vf0: 0.8718,
    rd: 0.0724,
  },
  SCS206AJHR: {
    mfr: "ROHM",
    grp: 650,
    CJO: 317.79e-12,
    VJ: 0.8119,
    M: 0.454,
    BV: 650,
    cf: 0,
    c0: 317.8e-12,
    vf25: 1.35,
    vfIf: 6,
    tc: 1.38,
    qcDs: 16.7e-9,
    rthjc: 2.3,
    ifr: 6,
    vf0: 1.042,
    rd: 0.05843,
  },
  PCDD0665G3: {
    mfr: "Panjit",
    grp: 650,
    CJO: 526.4e-12,
    VJ: 6.128,
    M: 1.15,
    BV: 650,
    cf: 34.41e-12,
    c0: 526.4e-12,
    vf25: 1.3,
    vfIf: 6,
    tc: 1.26,
    qcDs: 20.7e-9,
    rthjc: 1.25,
    ifr: 6,
    vf0: 0.9814,
    rd: 0.04782,
  },
  WNSC6D06650D: {
    mfr: "Weensemi",
    grp: 650,
    CJO: 380.6e-12,
    VJ: 2.86,
    M: 1,
    BV: 650,
    cf: 31e-12,
    c0: 380.6e-12,
    vf25: 1.26,
    vfIf: 6,
    tc: 0.646,
    qcDs: 13.5e-9,
    rthjc: 0.93,
    ifr: 6,
    vf0: 0.9551,
    rd: 0.04756,
  },
  "VS-4C06ET07S2L": {
    mfr: "Vishay",
    grp: 650,
    CJO: 346.59e-12,
    VJ: 1.443,
    M: 0.4973,
    BV: 650,
    cf: 0,
    c0: 346.6e-12,
    vf25: 1.3,
    vfIf: 6,
    tc: 0.867,
    qcDs: 16e-9,
    rthjc: 2.5,
    ifr: 6,
    vf0: 0.9752,
    rd: 0.05659,
  },
  "VS-4C08ET07TH": {
    mfr: "Vishay",
    grp: 650,
    CJO: 479.92e-12,
    VJ: 1.341,
    M: 0.4858,
    BV: 650,
    cf: 0,
    c0: 479.9e-12,
    vf25: 1.3,
    vfIf: 8,
    tc: 0.955,
    qcDs: 22e-9,
    rthjc: 2.2,
    ifr: 8,
    vf0: 0.9534,
    rd: 0.04254,
  },
};

export const SIC_DEFAULT_SELECTED = ["G5S12002C", "VS-4C10ET12S2LH"];

/** Voltage-controlled switch — D1SPICE/ngspice. Avoids the B-source MOSFET subckt. */
export function buildSicNetlist(part: string, c: SicCond): string {
  const d = SIC_PARTS[part];
  if (!d) throw new Error(`Unknown part ${part}`);
  const L = [
    `* SiC reverse-recovery (switch clamp) -- ${part}  (D1SPICE)`,
    ".options method=gear maxord=2 reltol=1e-3 abstol=1e-9 itl4=100",
    `.model DUT D(Is=2e-10 N=1.05 Rs=0.02 Cjo=${d.CJO.toExponential(6)} Vj=${d.VJ} M=${d.M} Tt=0 Bv=${d.BV})`,
    ".model QSW SW(Vt=5 Ron=50m Roff=10Meg Vh=0)",
    `Vbus nbus 0 DC ${c.vbus}`,
    `Iload nbus sw DC ${c.il}`,
    "Vsense sw na 0",
    "Rlp na nx 2.5",
    "Lpar nx nd 10n",
    "D5 nd nbus DUT",
  ];
  if (d.cf > 0) L.push(`Cflr nd nbus ${d.cf.toExponential(4)}`);
  L.push(
    "S1 sw 0 vg 0 QSW",
    "Vgs vg 0 PWL(0 0 1u 0 1.01u 12 3u 12)",
    ".print tran I(Vsense) V(nbus) V(nd)",
    ".tran 2n 3u",
    ".end",
  );
  return L.join("\n");
}

function tableFromFleet(data: unknown): { columns: string[]; rows: unknown[][] } | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const inner = (d.result ?? d) as Record<string, unknown>;
  let a: Record<string, unknown> | null = null;
  if (Array.isArray(inner.columns) && Array.isArray(inner.rows)) a = inner;
  else if (Array.isArray(inner.analyses) && inner.analyses[0] && typeof inner.analyses[0] === "object") {
    a = inner.analyses[0] as Record<string, unknown>;
  }
  if (!a || !Array.isArray(a.columns) || !Array.isArray(a.rows) || !a.rows.length) return null;
  return { columns: a.columns.map(String), rows: a.rows as unknown[][] };
}

export function analyseRR(data: unknown): Omit<RrMetrics, "psw" | "ptot"> {
  const tab = tableFromFleet(data);
  if (!tab) throw new Error("worker returned no waveform");
  const { columns: cols, rows } = tab;
  let iT = 0;
  let iI = -1;
  let iVo = -1;
  let iNd = -1;
  for (let k = 0; k < cols.length; k++) {
    const lc = cols[k]!.toLowerCase();
    if (lc === "time") iT = k;
    else if (lc.includes("vsense")) iI = k;
    else if (lc.includes("v(vout)") || lc === "vout" || lc.includes("v(nbus)") || lc === "nbus") iVo = k;
    else if (lc.includes("v(nd)") || lc === "nd") iNd = k;
  }
  if (iI < 0 || iVo < 0 || iNd < 0) throw new Error("waveform missing I(Vsense) / V(Vout) / V(nd)");
  const wave: { x: number; y: number }[] = [];
  let irrm = -1e9;
  let vd5 = -1e9;
  let qrr = 0;
  let pt: number | null = null;
  let pir = 0;
  for (const row of rows) {
    const t = Number(row[iT]);
    const id = -Number(row[iI]);
    const vr = Number(row[iVo]) - Number(row[iNd]);
    wave.push({ x: t * 1e9, y: id });
    if (id > irrm) irrm = id;
    if (vr > vd5) vd5 = vr;
    const ir = id > 0 ? id : 0;
    if (pt !== null) qrr += 0.5 * (ir + pir) * (t - pt);
    pt = t;
    pir = ir;
  }
  return { wave, irrm, vd5, qrr, trr: irrm > 0 ? (2 * qrr) / irrm : 0 };
}

function qcAna(d: SicPart, vbus: number): number {
  const q =
    Math.abs(d.M - 1) < 1e-6
      ? d.CJO * d.VJ * Math.log(1 + vbus / d.VJ)
      : ((d.CJO * d.VJ) / (1 - d.M)) * (Math.pow(1 + vbus / d.VJ, 1 - d.M) - 1);
  return q + d.cf * vbus;
}

function synthWave(irrm: number, trr: number, il: number): { x: number; y: number }[] {
  const t = trr * 1e9;
  const tp = 1.0 + t * 0.35;
  const te = 1.0 + t;
  return [
    { x: 0, y: -il },
    { x: 1.0, y: -il },
    { x: tp, y: irrm },
    { x: te, y: 0 },
    { x: te + 2, y: 0 },
  ];
}

export function anaRR(d: SicPart, c: SicCond, model: AnaModel): Omit<RrMetrics, "psw" | "ptot"> {
  const qrr = model === "v2" ? qcAna(d, c.vbus) : (d.qcDs != null ? d.qcDs : qcAna(d, c.vbus));
  const irrm = d.c0 * c.dvdt + c.il;
  const trr = (2 * qrr) / irrm;
  return { qrr, irrm, trr, vd5: c.vbus + irrm * 7.6, wave: synthWave(irrm, trr, c.il) };
}

export function vfAna(d: SicPart, I: number, Tj: number): number {
  return d.vf0 + d.rd * I + (d.tc * (Tj - 25)) / 1000;
}

export function computeTj(d: SicPart, c: SicCond): number {
  const rthja = (d.rthjc != null ? d.rthjc : 3) + c.rthca;
  let Tj = c.ta;
  const qrr = d.qcDs != null ? d.qcDs : qcAna(d, c.vbus);
  for (let k = 0; k < 8; k++) {
    const pc = vfAna(d, c.iout, Tj) * c.iout * c.duty;
    const ps = qrr * c.vbus * c.fsw;
    Tj = c.ta + (pc + ps) * rthja;
  }
  return Tj;
}

export function buildSicRow(
  part: string,
  c: SicCond,
  model: AnaModel,
  spiceIn: Omit<RrMetrics, "psw" | "ptot"> | null,
  err?: string,
): SicRow {
  const d = SIC_PARTS[part]!;
  const tj = computeTj(d, c);
  const vf = vfAna(d, c.iout, tj);
  const pcond = vf * c.iout * c.duty;
  const ana0 = anaRR(d, c, model);
  const ana: RrMetrics = {
    ...ana0,
    psw: ana0.qrr * c.vbus * c.fsw,
    ptot: 0,
  };
  ana.ptot = pcond + ana.psw;
  if (err || !spiceIn) {
    return { part, err: err ?? "no SPICE", tj, vf, pcond, ana };
  }
  const spice: RrMetrics = {
    ...spiceIn,
    psw: spiceIn.qrr * c.vbus * c.fsw,
    ptot: 0,
  };
  spice.ptot = pcond + spice.psw;
  return { part, tj, vf, pcond, spice, ana };
}

export function recomputeAnaRows(rows: SicRow[], c: SicCond, model: AnaModel): SicRow[] {
  return rows.map((o) =>
    buildSicRow(o.part, c, model, o.spice ? { ...o.spice } : null, o.err),
  );
}

export function fmt(x: number | null | undefined, d: number): string {
  if (x == null || Number.isNaN(x)) return "—";
  return x.toFixed(d);
}

export function dpct(x: number, y: number): number {
  return x ? ((x - y) / x) * 100 : 0;
}
