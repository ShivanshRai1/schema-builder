/**
 * Email point-3 pulse profiles (ISO 16750-2 Test A / ISO 7637-2 5a).
 * Bundled as .subckt text so Models / Run decks include them without .include files.
 *
 * Schematic keeps V1+R1 for UI. At Run, sanitize can swap in a live XPULSE-equivalent
 * stimulus (numeric B-source + R) so QSPICE does not depend on `{Ri}` inside .subckt.
 */

export const PULSE_ISO16750_TESTA_INC = `* ==========================================================
* ISO 16750-2 Test A - unsuppressed load dump
* Us (Uspk) is the ABSOLUTE PEAK voltage.
* XPULSE out 0 ISO16750_TESTA UA=24 Uspk=202 Ri=3 td=350m tr=10m
* ==========================================================
.subckt ISO16750_TESTA out ref params: UA=24 Uspk=202 Ri=3 td=350m tr=10m
.param ln10=2.302585093
.param Usa=Uspk-UA
.param tpk=1.25*tr
.param tau=(td-1.125*tr)/ln10
B1 src ref V = UA + Usa*min(time/tpk,1)*exp(-max(time-tpk,0)/tau)
R1 src out Ri
.ends ISO16750_TESTA
`;

export const PULSE_ISO7637_5A_INC = `* ==========================================================
* ISO 7637-2 Test pulse 5a - unsuppressed load dump
* Us is the AMPLITUDE ABOVE UA. Absolute peak = UA + Us.
* XPULSE out 0 ISO7637_5A UA=27.8 Us=123.2 Ri=2 td=350m tr=10m
* ==========================================================
.subckt ISO7637_5A out ref params: UA=27.8 Us=123.2 Ri=2 td=350m tr=10m
.param ln10=2.302585093
.param tpk=1.25*tr
.param tau=(td-1.125*tr)/ln10
B1 src ref V = UA + Us*min(time/tpk,1)*exp(-max(time-tpk,0)/tau)
R1 src out Ri
.ends ISO7637_5A
`;

const PULSE_LIB_MARKER = "* --- load-dump pulse profiles (ISO16750_TESTA / ISO7637_5A) ---";

/** True if both pulse subckts are already present in library/netlist text. */
export function hasLoadDumpPulseLibrary(text: string): boolean {
  const u = text.toUpperCase();
  return u.includes(".SUBCKT ISO16750_TESTA") && u.includes(".SUBCKT ISO7637_5A");
}

/** Strip previously bundled pulse profiles so we can refresh QSPICE-safe bodies. */
function stripLoadDumpPulseLibrary(library: string): string {
  let cur = library;
  cur = cur.replace(/\* --- load-dump pulse profiles[^\n]*\n?/gi, "");
  cur = cur.replace(
    /\* =+\s*\r?\n\* ISO 16750-2[\s\S]*?\.ends\s+ISO16750_TESTA\s*\r?\n?/gi,
    "",
  );
  cur = cur.replace(
    /\* =+\s*\r?\n\* ISO 7637-2[\s\S]*?\.ends\s+ISO7637_5A\s*\r?\n?/gi,
    "",
  );
  cur = cur.replace(/\.subckt\s+ISO16750_TESTA\b[\s\S]*?\.ends\s+ISO16750_TESTA\s*\r?\n?/gi, "");
  cur = cur.replace(/\.subckt\s+ISO7637_5A\b[\s\S]*?\.ends\s+ISO7637_5A\s*\r?\n?/gi, "");
  return cur.replace(/\n{3,}/g, "\n\n").trim();
}

/** Merge pulse .inc bodies into Models library text (idempotent; refreshes old `{Ri}` bodies). */
export function ensureLoadDumpPulseLibrary(library: string): string {
  const cur = stripLoadDumpPulseLibrary(library);
  const block = [
    PULSE_LIB_MARKER,
    PULSE_ISO16750_TESTA_INC.trim(),
    "",
    PULSE_ISO7637_5A_INC.trim(),
    "",
  ].join("\n");
  if (!cur) return `${block}\n`;
  return `${cur}\n\n${block}\n`;
}

function wcField(body: string, key: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)${key}\\s*=\\s*([^\\s]+)`, "i");
  return re.exec(body)?.[1];
}

function isGnd(net: string): boolean {
  return /^(0|gnd|ground)$/i.test(net.trim());
}

/** Parse SPICE time (s) or resistance (Ω). */
function parseSpiceScalar(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "").replace(/v$/i, "").replace(/ohm$/i, "");
  if (!t) return null;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([a-zA-Zµμ]*)$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const suf = (m[2] ?? "").toUpperCase().replace(/µ|μ/g, "U");
  if (!suf) return n;
  if (suf.startsWith("MEG")) return n * 1e6;
  const mult: Record<string, number> = {
    T: 1e12,
    G: 1e9,
    K: 1e3,
    M: 1e-3,
    U: 1e-6,
    N: 1e-9,
    P: 1e-12,
    F: 1e-15,
  };
  const key = suf[0]!;
  if (!(key in mult)) return null;
  return n * mult[key]!;
}

/**
 * Build live XPULSE instance line from *.wc marker + profile.
 * Kept for directives / Monaco docs (comment form).
 */
export function formatLiveXpulseLine(args: {
  outNet: string;
  refNet: string;
  pulse: string;
  ua: string;
  us: string;
  ri: string;
  td: string;
  tr: string;
}): string {
  const ua = args.ua.replace(/v$/i, "") || "24";
  const us = args.us.replace(/v$/i, "") || "202";
  const ri = args.ri.replace(/ohm$/i, "") || "2";
  const td = /[a-z]/i.test(args.td) ? args.td : `${args.td || "350"}m`;
  const tr = /[a-z]/i.test(args.tr) ? args.tr : `${args.tr || "10"}m`;
  const pulse = args.pulse.toUpperCase();
  if (pulse.includes("7637")) {
    return `XPULSE ${args.outNet} ${args.refNet} ISO7637_5A UA=${ua} Us=${us} Ri=${ri} td=${td} tr=${tr}`;
  }
  return `XPULSE ${args.outNet} ${args.refNet} ISO16750_TESTA UA=${ua} Uspk=${us} Ri=${ri} td=${td} tr=${tr}`;
}

/**
 * Equivalent XPULSE instance comment for directives / Monaco docs.
 */
export function formatXpulseComment(c: {
  pulse: string;
  uaSupply: string;
  usPeak: string;
  ri: string;
  tdMs: string;
  trMs: string;
}): string {
  return `* ${formatLiveXpulseLine({
    outNet: "vin",
    refNet: "0",
    pulse: c.pulse,
    ua: c.uaSupply,
    us: c.usPeak,
    ri: c.ri,
    td: `${c.tdMs.trim() || "350"}m`,
    tr: `${c.trMs.trim() || "10"}m`,
  })}`;
}

/**
 * QSPICE-safe live stimulus: same ISO math as the .subckt, but with numbers
 * baked into a top-level B-source + R (avoids dead `{Ri}` on clamp).
 * Returns null if params cannot be parsed — caller must leave V1 PWL alone.
 */
function formatLivePulseBR(args: {
  outNet: string;
  refNet: string;
  pulse: string;
  ua: string;
  us: string;
  ri: string;
  td: string;
  tr: string;
}): { lines: string[]; profile: string } | null {
  const ua = parseSpiceScalar(args.ua);
  const us = parseSpiceScalar(args.us);
  const ri = parseSpiceScalar(args.ri);
  let tr = parseSpiceScalar(args.tr);
  let td = parseSpiceScalar(args.td);
  // WC often stores td/tr as plain ms numbers ("350", "10")
  if (tr == null && /^\d+(\.\d+)?$/.test(args.tr.trim())) tr = Number(args.tr) * 1e-3;
  if (td == null && /^\d+(\.\d+)?$/.test(args.td.trim())) td = Number(args.td) * 1e-3;
  if (ua == null || us == null || ri == null || tr == null || td == null) return null;
  if (!(ri > 0) || !(tr > 0) || !(td > 0)) return null;

  const is7637 = args.pulse.toUpperCase().includes("7637");
  const usa = is7637 ? us : us - ua;
  const tpk = 1.25 * tr;
  const tau = (td - 1.125 * tr) / 2.302585093;
  if (!(tpk > 0) || !(tau > 0)) return null;

  const src = "xp_src";
  const expr = `${ua} + ${usa}*min(time/${tpk},1)*exp(-max(time-${tpk},0)/${tau})`;
  const doc = formatLiveXpulseLine(args);
  const profile = is7637 ? "ISO7637_5A" : "ISO16750_TESTA";
  return {
    profile,
    lines: [
      `* --- live XPULSE (B+R numeric; V1/R1 bypassed for Run; schematic unchanged) ---`,
      `* ${doc}`,
      `BXPULSE ${src} ${args.refNet} V=${expr}`,
      `RXPULSE ${src} ${args.outNet} ${ri}`,
      "",
    ],
  };
}

/**
 * At Run: if *.wc load-dump marker exists, drive the clamp node with a live
 * XPULSE-equivalent B+R and comment out schematic V1+R1 so they are not double-driven.
 * Canvas symbols stay put — only the submitted deck changes.
 * If params cannot be resolved safely, returns the netlist unchanged (V1 PWL path).
 */
export function applyLiveXpulseStimulus(netlist: string): {
  text: string;
  notes: string[];
} {
  const notes: string[] = [];
  let wcBody: string | null = null;
  for (const line of netlist.split(/\r?\n/)) {
    const m = /^\*\s*\.wc\b(.*)$/i.exec(line.trim());
    if (m) wcBody = m[1] ?? "";
  }
  if (wcBody == null) return { text: netlist, notes: [] };

  const pulse = wcField(wcBody, "pulse") ?? "ISO16750_A";
  const ua = wcField(wcBody, "UA") ?? "24";
  const us = wcField(wcBody, "Us") ?? wcField(wcBody, "US") ?? "202";
  const ri = wcField(wcBody, "Ri") ?? wcField(wcBody, "RI") ?? "2";
  const tr = wcField(wcBody, "tr") ?? wcField(wcBody, "Tr") ?? "10m";
  const td = wcField(wcBody, "td") ?? wcField(wcBody, "Td") ?? "350m";

  const lines = netlist.split(/\r?\n/);
  let vIdx = -1;
  let rIdx = -1;
  let vA = "";
  let vB = "";
  let rA = "";
  let rB = "";

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (!t || t.startsWith("*") || t.startsWith(".")) continue;
    const v = /^(V1)\s+(\S+)\s+(\S+)\s+/i.exec(t);
    if (v && vIdx < 0) {
      vIdx = i;
      vA = v[2]!;
      vB = v[3]!;
      continue;
    }
    const r = /^(R1)\s+(\S+)\s+(\S+)\s+/i.exec(t);
    if (r && rIdx < 0) {
      rIdx = i;
      rA = r[2]!;
      rB = r[3]!;
    }
  }

  // Fallback: first V* / R* if V1/R1 missing
  if (vIdx < 0 || rIdx < 0) {
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]!.trim();
      if (!t || t.startsWith("*") || t.startsWith(".")) continue;
      if (vIdx < 0) {
        const v = /^(V\S*)\s+(\S+)\s+(\S+)\s+/i.exec(t);
        if (v) {
          vIdx = i;
          vA = v[2]!;
          vB = v[3]!;
        }
      }
      if (rIdx < 0) {
        const r = /^(R\S*)\s+(\S+)\s+(\S+)\s+/i.exec(t);
        if (r) {
          rIdx = i;
          rA = r[2]!;
          rB = r[3]!;
        }
      }
    }
  }

  if (vIdx < 0) return { text: netlist, notes: [] };

  const vHot = isGnd(vA) ? vB : isGnd(vB) ? vA : vA;
  const refNet = isGnd(vA) ? vA : isGnd(vB) ? vB : "0";
  let outNet = vHot;
  if (rIdx >= 0) {
    // Clamp = R1 pin that is not the V-source hot node
    if (rA === vHot) outNet = rB;
    else if (rB === vHot) outNet = rA;
    else outNet = isGnd(rA) ? rB : rA;
  }

  const live = formatLivePulseBR({
    outNet,
    refNet,
    pulse,
    ua,
    us,
    ri,
    td,
    tr,
  });
  // Safe fallback: leave proven V1 PWL + R1 alone
  if (!live) {
    notes.push("Live XPULSE skipped (could not parse WC params) — keeping V1 PWL + R1");
    return { text: netlist, notes };
  }

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const t = raw.trim();
    // Drop prior live / comment XPULSE / B+R — we re-insert one canonical block
    if (
      /^XPULSE\b/i.test(t) ||
      /^\*\s*XPULSE\b/i.test(t) ||
      /^BXPULSE\b/i.test(t) ||
      /^RXPULSE\b/i.test(t) ||
      /^\*\s*---\s*live XPULSE\b/i.test(t)
    ) {
      continue;
    }
    if (i === vIdx) {
      out.push(`* (xpulse) ${t}`);
      continue;
    }
    if (i === rIdx) {
      out.push(`* (xpulse) ${t}`);
      continue;
    }
    out.push(raw);
  }

  // Insert live stimulus just before directives / .end
  let insertAt = out.findIndex((l) => /^\*\s*---\s*directives/i.test(l.trim()));
  if (insertAt < 0) insertAt = out.findIndex((l) => /^\.end\b/i.test(l.trim()));
  if (insertAt < 0) insertAt = out.length;
  out.splice(insertAt, 0, ...live.lines);

  notes.push(`Live XPULSE (B+R) → ${outNet}/${refNet} (${live.profile})`);
  notes.push("V1+R1 commented for Run (avoid double drive)");
  return { text: out.join("\n"), notes };
}
