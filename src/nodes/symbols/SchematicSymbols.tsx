import type { ComponentKind } from "../../model/types";
import { getSymbolLayout } from "./layout";

const STROKE = "var(--symbol-stroke, #5eb0ff)";
const SW = 1.6;

type SymProps = { selected?: boolean; rotation?: number };

/**
 * Draw path-space glyph (`w`×`h` viewBox) stretched to the grid-aligned
 * layout box so pin handles sit on the wire grid.
 */
function SymbolSvg({
  kind,
  w,
  h,
  children,
}: {
  kind: ComponentKind;
  w: number;
  h: number;
  children: React.ReactNode;
}) {
  const box = getSymbolLayout(kind, 0) ?? { w, h };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={box.w} height={box.h} aria-hidden>
      {children}
    </svg>
  );
}

/** Keep a glyph upright after the parent SVG is rotated. */
function upright(rotation: number | undefined, cx: number, cy: number): string | undefined {
  if (!rotation) return undefined;
  return `rotate(${-rotation} ${cx} ${cy})`;
}

function ResistorSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="R" w={48} h={24}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 12 H8" />
        <path d="M8 12 L11 5 L15 19 L19 5 L23 19 L27 5 L31 19 L35 5 L39 12" />
        <path d="M39 12 H48" />
      </g>
    </SymbolSvg>
  );
}

function ResistorBoxSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="RBOX" w={48} h={24}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 12 H10" />
        <rect x="10" y="6" width="28" height="12" />
        <path d="M38 12 H48" />
      </g>
    </SymbolSvg>
  );
}

function ResistorVarSymbol({ selected }: SymProps) {
  // Arrow runs past the zigzag so the tip stays readable.
  return (
    <SymbolSvg kind="RVAR" w={48} h={28}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={1.45}
        strokeLinecap="butt"
        strokeLinejoin="miter"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 14 H7" />
        <path d="M7 14 L10.5 7 L15 21 L19.5 7 L24 21 L28.5 7 L33 21 L37.5 7 L41 14" />
        <path d="M41 14 H48" />
        <path d="M12 22 L36 2" strokeWidth={1.25} />
      </g>
      <path
        d="M36 2 L30.6 3.4 L32.8 7.4 Z"
        fill={STROKE}
        stroke="none"
        opacity={selected ? 1 : 0.92}
      />
    </SymbolSvg>
  );
}

function ResistorVarBoxSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="RVARBOX" w={48} h={28}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={1.45}
        strokeLinecap="butt"
        strokeLinejoin="miter"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 14 H10" />
        <rect x="10" y="8.5" width="28" height="11" />
        <path d="M38 14 H48" />
        <path d="M12 22 L36 2" strokeWidth={1.25} />
      </g>
      <path
        d="M36 2 L30.6 3.4 L32.8 7.4 Z"
        fill={STROKE}
        stroke="none"
        opacity={selected ? 1 : 0.92}
      />
    </SymbolSvg>
  );
}

function PotSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="POT" w={48} h={32}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 20 H8" />
        <path d="M8 20 L11 13 L15 27 L19 13 L23 27 L27 13 L31 27 L35 13 L39 20" />
        <path d="M39 20 H48" />
        <path d="M24 0 V12" />
        <path d="M24 12 L21 8 M24 12 L27 8" />
      </g>
    </SymbolSvg>
  );
}

function PotBoxSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="POTBOX" w={48} h={32}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 20 H10" />
        <rect x="10" y="14" width="28" height="12" />
        <path d="M38 20 H48" />
        <path d="M24 0 V14" />
        <path d="M24 14 L21 10 M24 14 L27 10" />
      </g>
    </SymbolSvg>
  );
}

function CapacitorSymbol({ selected }: SymProps) {
  // Non-polarized: two equal plates.
  return (
    <SymbolSvg kind="C" w={48} h={24}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="butt"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 12 H19" />
        <path d="M19 4 V20" />
        <path d="M29 4 V20" />
        <path d="M29 12 H48" />
      </g>
    </SymbolSvg>
  );
}

function CapacitorPolSymbol({ selected }: SymProps) {
  // Polarized: straight (+) plate, curved (−) plate, polarity marks.
  return (
    <SymbolSvg kind="CPOL" w={48} h={28}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
        strokeLinecap="butt"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 16 H18" />
        <path d="M18 6 V26" />
        <path d="M28 7 A9 9 0 0 1 28 25" />
        <path d="M30 16 H48" />
        <path d="M8 7 H12 M10 5 V9" strokeWidth={1.2} />
        <path d="M36 7 H40" strokeWidth={1.2} />
      </g>
    </SymbolSvg>
  );
}

function CapacitorFixedSymbol({ selected }: SymProps) {
  // Fixed (curved plate, no polarity marks).
  return (
    <SymbolSvg kind="CFIXED" w={48} h={24}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
        strokeLinecap="butt"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 12 H18" />
        <path d="M18 4 V20" />
        <path d="M28 5 A8 8 0 0 1 28 19" />
        <path d="M30 12 H48" />
      </g>
    </SymbolSvg>
  );
}

function CapacitorVarSymbol({ selected }: SymProps) {
  // Variable: curved plates + long diagonal arrow past the body.
  return (
    <SymbolSvg kind="CVAR" w={48} h={28}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
        strokeLinecap="butt"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 14 H18" />
        <path d="M18 6 V22" />
        <path d="M28 7 A8 8 0 0 1 28 21" />
        <path d="M30 14 H48" />
        <path d="M12 23 L36 3" strokeWidth={1.25} />
      </g>
      <path
        d="M36 3 L30.6 4.4 L32.8 8.4 Z"
        fill={STROKE}
        stroke="none"
        opacity={selected ? 1 : 0.92}
      />
    </SymbolSvg>
  );
}

function InductorSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="L" w={48} h={24}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 12 H6" />
        <path d="M6 12 A6 6 0 0 1 12 12" />
        <path d="M12 12 A6 6 0 0 1 18 12" />
        <path d="M18 12 A6 6 0 0 1 24 12" />
        <path d="M24 12 A6 6 0 0 1 30 12" />
        <path d="M30 12 H48" />
      </g>
    </SymbolSvg>
  );
}

function InductorVarSymbol({ selected }: SymProps) {
  // Air-core coil + control arrow down into the windings, then right (chart style).
  return (
    <SymbolSvg kind="LVAR" w={48} h={32}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 18 H6" />
        <path d="M6 18 A6 6 0 0 1 12 18" />
        <path d="M12 18 A6 6 0 0 1 18 18" />
        <path d="M18 18 A6 6 0 0 1 24 18" />
        <path d="M24 18 A6 6 0 0 1 30 18" />
        <path d="M30 18 H48" />
        <path d="M18 4 V12" strokeWidth={1.35} />
        <path d="M18 4 H34" strokeWidth={1.35} />
      </g>
      <path
        d="M18 14 L15.2 8.6 L20.8 8.6 Z"
        fill={STROKE}
        stroke="none"
        opacity={selected ? 1 : 0.92}
      />
    </SymbolSvg>
  );
}

function VoltageSymbol({ selected, rotation = 0 }: SymProps) {
  return (
    <SymbolSvg kind="V" w={40} h={80}>
      {/* Opaque body so other wires don't show through the source. */}
      <circle cx="20" cy="40" r="16" fill="var(--bg, #0f1419)" stroke="none" />
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M20 0 V16" />
        <circle cx="20" cy="40" r="16" />
        <path d="M20 64 V80" />
      </g>
      <g
        fill={STROKE}
        stroke="none"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontWeight="700"
        fontSize="11"
        textAnchor="middle"
        opacity={selected ? 1 : 0.92}
      >
        <text x="20" y="32" dominantBaseline="central" transform={upright(rotation, 20, 32)}>
          +
        </text>
        <text x="20" y="50" dominantBaseline="central" transform={upright(rotation, 20, 50)}>
          −
        </text>
      </g>
    </SymbolSvg>
  );
}

function GroundSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="GND" w={36} h={28}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M18 0 V9" />
        <path d="M8 9 H28" />
        <path d="M11 14 H25" />
        <path d="M14 19 H22" />
      </g>
    </SymbolSvg>
  );
}

function DiodeSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="D" w={48} h={24}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 12 H16" />
        <path d="M16 4 L32 12 L16 20 Z" />
        <path d="M32 4 V20" />
        <path d="M32 12 H48" />
      </g>
    </SymbolSvg>
  );
}

function CurrentSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="I" w={40} h={80}>
      <circle cx="20" cy="40" r="16" fill="var(--bg, #0f1419)" stroke="none" />
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M20 0 V16" />
        <circle cx="20" cy="40" r="16" />
        <path d="M20 64 V80" />
        <path d="M20 28 V52" />
        <path d="M20 52 L15 44 M20 52 L25 44" />
      </g>
    </SymbolSvg>
  );
}

function NmosSymbol({ selected }: SymProps) {
  // Enhancement N-MOSFET: broken channel, body arrow in.
  return (
    <SymbolSvg kind="NMOS" w={40} h={56}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M22 0 V14" />
        <path d="M22 42 V56" />
        <path d="M16 14 V18" />
        <path d="M16 25 V31" />
        <path d="M16 38 V42" />
        <path d="M16 16 H22" />
        <path d="M16 28 H22" />
        <path d="M16 40 H22" />
        <path d="M0 28 H10" />
        <path d="M10 14 V42" />
        <path d="M22 28 H28" />
        <path d="M28 28 L24 25 M28 28 L24 31" />
      </g>
    </SymbolSvg>
  );
}

function PmosSymbol({ selected }: SymProps) {
  // Enhancement P-MOSFET: broken channel, body arrow out (D at bottom in catalog).
  return (
    <SymbolSvg kind="PMOS" w={40} h={56}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M22 0 V14" />
        <path d="M22 42 V56" />
        <path d="M16 14 V18" />
        <path d="M16 25 V31" />
        <path d="M16 38 V42" />
        <path d="M16 16 H22" />
        <path d="M16 28 H22" />
        <path d="M16 40 H22" />
        <path d="M0 28 H10" />
        <path d="M10 14 V42" />
        <path d="M22 28 H26" />
        <path d="M26 28 L30 25 M26 28 L30 31" />
        <path d="M30 28 H32" />
      </g>
    </SymbolSvg>
  );
}

function NmosDepSymbol({ selected }: SymProps) {
  // Depletion N-MOSFET: solid channel, body arrow in.
  return (
    <SymbolSvg kind="NMOS_D" w={40} h={56}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M22 0 V14" />
        <path d="M22 42 V56" />
        <path d="M16 14 V42" strokeWidth={2.2} />
        <path d="M16 16 H22" />
        <path d="M16 28 H22" />
        <path d="M16 40 H22" />
        <path d="M0 28 H10" />
        <path d="M10 14 V42" />
        <path d="M22 28 H28" />
        <path d="M28 28 L24 25 M28 28 L24 31" />
      </g>
    </SymbolSvg>
  );
}

function PmosDepSymbol({ selected }: SymProps) {
  // Depletion P-MOSFET: solid channel, body arrow out.
  return (
    <SymbolSvg kind="PMOS_D" w={40} h={56}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M22 0 V14" />
        <path d="M22 42 V56" />
        <path d="M16 14 V42" strokeWidth={2.2} />
        <path d="M16 16 H22" />
        <path d="M16 28 H22" />
        <path d="M16 40 H22" />
        <path d="M0 28 H10" />
        <path d="M10 14 V42" />
        <path d="M22 28 H26" />
        <path d="M26 28 L30 25 M26 28 L30 31" />
        <path d="M30 28 H32" />
      </g>
    </SymbolSvg>
  );
}

function NjfetSymbol({ selected }: SymProps) {
  // N-channel JFET: gate arrow into the channel.
  return (
    <SymbolSvg kind="NJFET" w={40} h={56}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M22 0 V56" />
        <path d="M16 14 V42" />
        <path d="M16 16 H22" />
        <path d="M16 40 H22" />
        <path d="M0 28 H10" />
        <path d="M10 28 L16 28" />
        <path d="M10 28 L14 24 M10 28 L14 32" />
      </g>
    </SymbolSvg>
  );
}

function PjfetSymbol({ selected }: SymProps) {
  // P-channel JFET: gate arrow out of the channel.
  return (
    <SymbolSvg kind="PJFET" w={40} h={56}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M22 0 V56" />
        <path d="M16 14 V42" />
        <path d="M16 16 H22" />
        <path d="M16 40 H22" />
        <path d="M0 28 H8" />
        <path d="M16 28 H12" />
        <path d="M12 28 L8 24 M12 28 L8 32" />
      </g>
    </SymbolSvg>
  );
}

function NpnSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="NPN" w={40} h={56}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <circle cx="22" cy="28" r="13" />
        <path d="M22 0 V15" />
        <path d="M22 41 V56" />
        <path d="M0 28 H12" />
        <path d="M12 20 V36" />
        <path d="M12 22 L22 15" />
        <path d="M12 34 L22 41" />
        <path d="M22 41 L18 47 M22 41 L26 47" />
      </g>
    </SymbolSvg>
  );
}

function PnpSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="PNP" w={40} h={56}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <circle cx="22" cy="28" r="13" />
        <path d="M22 0 V15" />
        <path d="M22 41 V56" />
        <path d="M0 28 H12" />
        <path d="M12 20 V36" />
        <path d="M12 22 L22 15" />
        <path d="M12 34 L22 41" />
        <path d="M22 15 L18 21 M22 15 L26 19" />
      </g>
    </SymbolSvg>
  );
}

function IgbtSymbol({ selected }: SymProps) {
  // Circled N-IGBT ≈ reference chart (drawn 1:1 in 64×96):
  //   G lead → thick gate plate (gap) thin channel · C/E diagonals · big arrow out on E
  const o = selected ? 1 : 0.92;
  return (
    <SymbolSvg kind="IGBT" w={64} h={96}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={o}
      >
        <circle cx="32" cy="48" r="22" />
        <path d="M0 48 H16" />
        <path d="M16 30 V48" strokeWidth={2.6} strokeLinecap="butt" />
        <path d="M26 26 V70" strokeLinecap="butt" />
        <path d="M26 32 L40 18 V0" />
        {/* Emitter: diagonal to arrow base, vertical from tip */}
        <path d="M26 64 L33 71" />
        <path d="M40 78 V96" />
      </g>
      {/* Filled arrowhead along emitter diagonal, tip at the corner toward E */}
      <path
        d="M40 78 L29 74.8 L36.8 67 Z"
        fill={STROKE}
        stroke={STROKE}
        strokeWidth={0.3}
        strokeLinejoin="round"
        opacity={o}
      />
    </SymbolSvg>
  );
}

function IgbtKelvinSymbol({ selected }: SymProps) {
  const o = selected ? 1 : 0.92;
  return (
    <SymbolSvg kind="IGBT_K" w={64} h={96}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={o}
      >
        <circle cx="32" cy="48" r="22" />
        <path d="M0 48 H16" />
        <path d="M16 30 V48" strokeWidth={2.6} strokeLinecap="butt" />
        <path d="M26 26 V70" strokeLinecap="butt" />
        <path d="M26 32 L40 18 V0" />
        <path d="M26 64 L36 71" />
        <path d="M46 78 V96" />
        <path d="M26 64 L26 78 V96" strokeWidth={1.2} />
      </g>
      <path
        d="M46 78 L35.5 74.5 L42.5 66.5 Z"
        fill={STROKE}
        stroke={STROKE}
        strokeWidth={0.3}
        strokeLinejoin="round"
        opacity={o}
      />
    </SymbolSvg>
  );
}

function ScrSymbol({ selected }: SymProps) {
  // Thyristor: diode body + gate from cathode junction, diagonal then down.
  return (
    <SymbolSvg kind="SCR" w={48} h={36}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 14 H14" />
        <path d="M14 5 L30 14 L14 23 Z" />
        <path d="M30 5 V23" />
        <path d="M30 14 H48" />
        <path d="M30 14 L36 22 V36" />
      </g>
    </SymbolSvg>
  );
}

/** Shared enhancement-MOSFET body (D top / G left / S bottom). */
function MosfetBody({ selected, kind }: SymProps & { kind: ComponentKind }) {
  const o = selected ? 1 : 0.92;
  return (
    <SymbolSvg kind={kind} w={40} h={56}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={o}
      >
        <path d="M22 0 V14" />
        <path d="M22 42 V56" />
        <path d="M16 14 V18" />
        <path d="M16 25 V31" />
        <path d="M16 38 V42" />
        <path d="M16 16 H22" />
        <path d="M16 28 H22" />
        <path d="M16 40 H22" />
        <path d="M0 28 H10" />
        <path d="M10 14 V42" />
        <path d="M22 28 H28" />
        <path d="M28 28 L24 25 M28 28 L24 31" />
      </g>
    </SymbolSvg>
  );
}

function SicMosSymbol({ selected }: SymProps) {
  // SiC MOSFET: enhancement FET + body diode (D→S).
  const o = selected ? 1 : 0.92;
  return (
    <SymbolSvg kind="SICMOS" w={40} h={56}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={o}
      >
        <path d="M22 0 V14" />
        <path d="M22 42 V56" />
        <path d="M16 14 V18" />
        <path d="M16 25 V31" />
        <path d="M16 38 V42" />
        <path d="M16 16 H22" />
        <path d="M16 28 H22" />
        <path d="M16 40 H22" />
        <path d="M0 28 H10" />
        <path d="M10 14 V42" />
        <path d="M22 28 H28" />
        <path d="M28 28 L24 25 M28 28 L24 31" />
        {/* Body diode */}
        <path d="M30 18 V38" />
        <path d="M30 24 L34 28 L30 32 Z" />
        <path d="M34 28 H36" />
      </g>
    </SymbolSvg>
  );
}

function SicMosKelvinSymbol({ selected }: SymProps) {
  // SiC Kelvin: FET body + split source (S @0.7, SK @0.3).
  const o = selected ? 1 : 0.92;
  return (
    <SymbolSvg kind="SICMOS_K" w={40} h={56}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={o}
      >
        <path d="M22 0 V14" />
        <path d="M16 14 V18" />
        <path d="M16 25 V31" />
        <path d="M16 38 V42" />
        <path d="M16 16 H22" />
        <path d="M16 28 H22" />
        <path d="M16 40 H22" />
        <path d="M0 28 H10" />
        <path d="M10 14 V42" />
        <path d="M22 28 H28" />
        <path d="M28 28 L24 25 M28 28 L24 31" />
        <path d="M22 42 L28 50 V56" />
        <path d="M22 42 L12 50 V56" strokeWidth={1.3} />
        <path d="M30 18 V36" />
        <path d="M30 22 L34 26 L30 30 Z" />
      </g>
    </SymbolSvg>
  );
}

function GanHemtSymbol({ selected }: SymProps) {
  // GaN HEMT: enhancement FET look (no body diode).
  return <MosfetBody selected={selected} kind="GANHEMT" />;
}

function GateDrvSymbol({ selected }: SymProps) {
  const o = selected ? 1 : 0.92;
  return (
    <SymbolSvg kind="GATEDRV" w={56} h={48}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={o}
      >
        <rect x="10" y="8" width="36" height="32" rx="1.5" />
        <path d="M0 24 H10" />
        <path d="M46 24 H56" />
        <path d="M28 0 V8" />
        <path d="M28 40 V48" />
      </g>
      <g
        fill={STROKE}
        stroke="none"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontWeight="700"
        fontSize="8"
        textAnchor="middle"
        opacity={o}
      >
        <text x="28" y="26" dominantBaseline="central">
          DRV
        </text>
      </g>
    </SymbolSvg>
  );
}

function CompSymbol({ selected }: SymProps) {
  // Comparator: op-amp triangle with = mark.
  return (
    <SymbolSvg kind="COMP" w={56} h={40}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 12 H10" />
        <path d="M0 28 H10" />
        <path d="M10 2 L46 20 L10 38 Z" />
        <path d="M46 20 H56" />
        <path d="M14 12 H20" />
        <path d="M17 9 V15" />
        <path d="M14 28 H20" />
        <path d="M34 16 H40 M34 24 H40" />
      </g>
    </SymbolSvg>
  );
}

function CsenseSymbol({ selected }: SymProps) {
  // Shunt resistor with sense arrow.
  return (
    <SymbolSvg kind="CSENSE" w={48} h={24}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 12 H8" />
        <path d="M8 12 L11 5 L15 19 L19 5 L23 19 L27 5 L31 19 L35 5 L39 12" />
        <path d="M39 12 H48" />
        <path d="M24 2 V8" strokeWidth={1.25} />
        <path d="M24 8 L21 5 M24 8 L27 5" strokeWidth={1.25} />
      </g>
    </SymbolSvg>
  );
}

function VsenseSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="VSENSE" w={48} h={28}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 14 H14" />
        <circle cx="24" cy="14" r="9" />
        <path d="M34 14 H48" />
      </g>
      <g
        fill={STROKE}
        stroke="none"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontWeight="700"
        fontSize="11"
        textAnchor="middle"
        opacity={selected ? 1 : 0.92}
      >
        <text x="24" y="15" dominantBaseline="central">
          V
        </text>
      </g>
    </SymbolSvg>
  );
}

function IprobeSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="IPROBE" w={40} h={40}>
      <circle cx="20" cy="20" r="14" fill="var(--bg, #0f1419)" stroke="none" />
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 20 H6" />
        <circle cx="20" cy="20" r="14" />
        <path d="M34 20 H40" />
      </g>
      <g
        fill={STROKE}
        stroke="none"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontWeight="700"
        fontSize="12"
        textAnchor="middle"
        opacity={selected ? 1 : 0.92}
      >
        <text x="20" y="21" dominantBaseline="central">
          A
        </text>
      </g>
    </SymbolSvg>
  );
}

function VprobeSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="VPROBE" w={28} h={40}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M14 0 V22" />
        <path d="M14 22 L8 32 L20 32 Z" />
        <path d="M14 32 V40" />
      </g>
      <g
        fill={STROKE}
        stroke="none"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontWeight="700"
        fontSize="9"
        textAnchor="middle"
        opacity={selected ? 1 : 0.92}
      >
        <text x="14" y="12" dominantBaseline="central">
          V
        </text>
      </g>
    </SymbolSvg>
  );
}

function NodeSymbol({ selected }: SymProps) {
  // Net label flag.
  return (
    <SymbolSvg kind="NODE" w={36} h={24}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 12 H8" />
        <circle cx="8" cy="12" r="2.2" fill={STROKE} stroke="none" />
        <path d="M10 6 H28 L34 12 L28 18 H10 Z" />
      </g>
    </SymbolSvg>
  );
}

function OpAmpSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="EAMP" w={56} h={40}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 12 H10" />
        <path d="M0 28 H10" />
        <path d="M10 2 L46 20 L10 38 Z" />
        <path d="M46 20 H56" />
        <path d="M14 12 H20" />
        <path d="M17 9 V15" />
        <path d="M14 28 H20" />
      </g>
    </SymbolSvg>
  );
}

function BasicOpampSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="OPAMP" w={56} h={40}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 12 H10" />
        <path d="M0 28 H10" />
        <path d="M10 2 L46 20 L10 38 Z" />
        <path d="M46 20 H56" />
        <path d="M14 12 H20" />
        <path d="M17 9 V15" />
        <path d="M14 28 H20" />
      </g>
    </SymbolSvg>
  );
}

function GeneralOpampSymbol({ selected, rotation = 0 }: SymProps) {
  // Triangle + V+/V− supply stubs (labels stay upright under rotation).
  return (
    <SymbolSvg kind="OPAMP5" w={56} h={56}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 18 H10" />
        <path d="M0 38 H10" />
        <path d="M10 10 L46 28 L10 46 Z" />
        <path d="M46 28 H56" />
        <path d="M28 10 V0" />
        <path d="M28 46 V56" />
        <path d="M14 18 H20" />
        <path d="M17 15 V21" />
        <path d="M14 38 H20" />
      </g>
      <g
        fill={STROKE}
        stroke="none"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontWeight="700"
        fontSize="7"
        textAnchor="middle"
        opacity={selected ? 1 : 0.92}
      >
        <text x="36" y="8" dominantBaseline="central" transform={upright(rotation, 36, 8)}>
          V+
        </text>
        <text x="36" y="50" dominantBaseline="central" transform={upright(rotation, 36, 50)}>
          V−
        </text>
      </g>
    </SymbolSvg>
  );
}

const MAP: Partial<Record<ComponentKind, (p: SymProps) => JSX.Element>> = {
  R: ResistorSymbol,
  RBOX: ResistorBoxSymbol,
  RVAR: ResistorVarSymbol,
  RVARBOX: ResistorVarBoxSymbol,
  POT: PotSymbol,
  POTBOX: PotBoxSymbol,
  C: CapacitorSymbol,
  CPOL: CapacitorPolSymbol,
  CFIXED: CapacitorFixedSymbol,
  CVAR: CapacitorVarSymbol,
  L: InductorSymbol,
  LVAR: InductorVarSymbol,
  V: VoltageSymbol,
  GND: GroundSymbol,
  D: DiodeSymbol,
  I: CurrentSymbol,
  NMOS: NmosSymbol,
  PMOS: PmosSymbol,
  NMOS_D: NmosDepSymbol,
  PMOS_D: PmosDepSymbol,
  NJFET: NjfetSymbol,
  PJFET: PjfetSymbol,
  NPN: NpnSymbol,
  PNP: PnpSymbol,
  SICMOS: SicMosSymbol,
  SICMOS_K: SicMosKelvinSymbol,
  GANHEMT: GanHemtSymbol,
  IGBT: IgbtSymbol,
  IGBT_K: IgbtKelvinSymbol,
  SCR: ScrSymbol,
  GATEDRV: GateDrvSymbol,
  COMP: CompSymbol,
  EAMP: OpAmpSymbol,
  OPAMP: BasicOpampSymbol,
  OPAMP5: GeneralOpampSymbol,
  CSENSE: CsenseSymbol,
  VSENSE: VsenseSymbol,
  IPROBE: IprobeSymbol,
  VPROBE: VprobeSymbol,
  NODE: NodeSymbol,
};

export function SchematicSymbol({
  kind,
  selected,
  rotation = 0,
}: {
  kind: ComponentKind;
  selected?: boolean;
  rotation?: number;
}) {
  const Comp = MAP[kind];
  if (!Comp) return null;
  return <Comp selected={selected} rotation={rotation} />;
}
