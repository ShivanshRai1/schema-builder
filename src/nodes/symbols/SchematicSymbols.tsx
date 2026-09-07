import { createContext, useContext, type ReactNode } from "react";
import type { ComponentKind } from "../../model/types";
import { parseProductOps, parseSumSigns } from "../../model/mathBlocks";
import { getSymbolLayout } from "./layout";

const STROKE = "var(--symbol-stroke, #5eb0ff)";
const SW = 2.05;
/** LTspice-like strokes: butt caps + miter joins — no gaps at vertices or past pins. */
const STROKE_BUTT = {
  fill: "none" as const,
  stroke: STROKE,
  strokeWidth: SW,
  strokeLinecap: "butt" as const,
  strokeLinejoin: "miter" as const,
};

const SymbolPreviewCtx = createContext(false);

type SymProps = {
  selected?: boolean;
  rotation?: number;
  params?: Record<string, string>;
};

/**
 * Draw path-space glyph (`w`×`h` viewBox) stretched to the grid-aligned
 * layout box so pin handles sit on the wire grid.
 * In palette preview mode, keep aspect ratio (no pin stretch).
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
  children: ReactNode;
}) {
  const preview = useContext(SymbolPreviewCtx);
  const box = getSymbolLayout(kind, 0) ?? { w, h };
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={preview ? undefined : box.w}
      height={preview ? undefined : box.h}
      preserveAspectRatio={preview ? "xMidYMid meet" : "none"}
      aria-hidden
    >
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
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H8 L11 5 L15 19 L19 5 L23 19 L27 5 L31 19 L35 5 L39 12 H48" />
      </g>
    </SymbolSvg>
  );
}

function ResistorBoxSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="RBOX" w={48} h={24}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
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
        strokeLinecap="butt"
        strokeLinejoin="miter"
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
        strokeLinecap="butt"
        strokeLinejoin="miter"
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
  return (
    <SymbolSvg kind="C" w={48} h={24}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
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
        <path d="M0 14 H18" />
        <path d="M18 5 V23" />
        <path d="M28 5 A9 9 0 0 1 28 23" />
        <path d="M28 14 H48" />
        <path d="M8 5 H12 M10 3 V7" strokeWidth={1.2} />
        <path d="M36 5 H40" strokeWidth={1.2} />
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
        <path d="M28 12 H48" />
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
        <path d="M28 14 H48" />
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
  // Three equal semicircular loops between symmetric leads (spring / coil style).
  return (
    <SymbolSvg kind="L" w={48} h={24}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H9 A5 5 0 0 1 19 12 A5 5 0 0 1 29 12 A5 5 0 0 1 39 12 H48" />
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
        strokeLinecap="butt"
        strokeLinejoin="miter"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 16 H9 A5 5 0 0 1 19 16 A5 5 0 0 1 29 16 A5 5 0 0 1 39 16 H48" />
        <path d="M24 4 V12" strokeWidth={1.35} />
        <path d="M24 4 H34" strokeWidth={1.35} />
      </g>
      <path
        d="M24 14 L21.2 8.6 L26.8 8.6 Z"
        fill={STROKE}
        stroke="none"
        opacity={selected ? 1 : 0.92}
      />
    </SymbolSvg>
  );
}

function VoltageSymbol({ selected, rotation = 0 }: SymProps) {
  // Tight viewBox: short leads + large circle (pins stay at layout box top/bottom).
  const cx = 20;
  const cy = 32;
  const r = 18;
  const h = 64;
  return (
    <SymbolSvg kind="V" w={40} h={h}>
      <circle cx={cx} cy={cy} r={r} fill="var(--bg, #0f1419)" stroke="none" />
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d={`M${cx} 0 V${cy - r}`} />
        <circle cx={cx} cy={cy} r={r} />
        <path d={`M${cx} ${cy + r} V${h}`} />
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
        <text x={cx} y={26} dominantBaseline="central" transform={upright(rotation, cx, 26)}>
          +
        </text>
        <text x={cx} y={38} dominantBaseline="central" transform={upright(rotation, cx, 38)}>
          −
        </text>
      </g>
    </SymbolSvg>
  );
}

function GroundSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="GND" w={36} h={28}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M18 0 V9" />
        <path d="M8 9 H28" />
        <path d="M11 14 H25" />
        <path d="M14 19 H22" />
      </g>
    </SymbolSvg>
  );
}

/** DIG / ANG ground — hollow inverted triangle. */
function GroundSigSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="GND_SIG" w={36} h={28}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M18 0 V10" />
        <path d="M8 10 L18 24 L28 10 Z" />
      </g>
    </SymbolSvg>
  );
}

/** Chassis ground — rake / diagonal strokes. */
function GroundChassisSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="GND_CH" w={36} h={28}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M18 0 V10" />
        <path d="M8 10 H28" />
        <path d="M10 10 L6 18" />
        <path d="M18 10 L14 18" />
        <path d="M26 10 L22 18" />
      </g>
    </SymbolSvg>
  );
}

/** DC voltage — same circle +/− glyph as classic V (not capacitor-like plates). */
function BatterySymbol({ selected, rotation = 0 }: SymProps) {
  const cx = 20;
  const cy = 32;
  const r = 18;
  const h = 64;
  return (
    <SymbolSvg kind="BATTERY" w={40} h={h}>
      <circle cx={cx} cy={cy} r={r} fill="var(--bg, #0f1419)" stroke="none" />
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d={`M${cx} 0 V${cy - r}`} />
        <circle cx={cx} cy={cy} r={r} />
        <path d={`M${cx} ${cy + r} V${h}`} />
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
        <text x={cx} y={26} dominantBaseline="central" transform={upright(rotation, cx, 26)}>
          +
        </text>
        <text x={cx} y={38} dominantBaseline="central" transform={upright(rotation, cx, 38)}>
          −
        </text>
      </g>
    </SymbolSvg>
  );
}

/** AC voltage — circle with sine; + above / − below. */
function AcSourceSymbol({ selected, rotation = 0 }: SymProps) {
  const cx = 20;
  const cy = 32;
  const r = 18;
  const h = 64;
  return (
    <SymbolSvg kind="VAC" w={40} h={h}>
      <circle cx={cx} cy={cy} r={r} fill="var(--bg, #0f1419)" stroke="none" />
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d={`M${cx} 0 V${cy - r}`} />
        <circle cx={cx} cy={cy} r={r} />
        <path d={`M${cx} ${cy + r} V${h}`} />
        <path d={`M${cx - 9} ${cy} Q ${cx - 4.5} ${cy - 8} ${cx} ${cy} Q ${cx + 4.5} ${cy + 8} ${cx + 9} ${cy}`} />
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
        <text x={cx} y={cy - r - 6} dominantBaseline="central" transform={upright(rotation, cx, cy - r - 6)}>
          +
        </text>
        <text x={cx} y={cy + r + 7} dominantBaseline="central" transform={upright(rotation, cx, cy + r + 7)}>
          −
        </text>
      </g>
    </SymbolSvg>
  );
}

/** AC current — circle with sine (same pins as I). */
function AcCurrentSymbol({ selected }: SymProps) {
  const cx = 20;
  const cy = 32;
  const r = 18;
  const h = 64;
  return (
    <SymbolSvg kind="IAC" w={40} h={h}>
      <circle cx={cx} cy={cy} r={r} fill="var(--bg, #0f1419)" stroke="none" />
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d={`M${cx} 0 V${cy - r}`} />
        <circle cx={cx} cy={cy} r={r} />
        <path d={`M${cx} ${cy + r} V${h}`} />
        <path d={`M${cx - 9} ${cy} Q ${cx - 4.5} ${cy - 8} ${cx} ${cy} Q ${cx + 4.5} ${cy + 8} ${cx + 9} ${cy}`} />
      </g>
    </SymbolSvg>
  );
}

/** Pulse generator — box with two square pulses (schematic pins top/bottom). */
function PulseGenSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="VPULSE" w={40} h={64}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M20 0 V10" />
        <rect x="5" y="10" width="30" height="44" rx="1.5" />
        {/* Two consecutive rectangular pulses */}
        <path d="M9 40 H12 V24 H17 V40 H20 V24 H25 V40 H28 V24 H31" fill="none" />
        <path d="M20 54 V64" />
      </g>
    </SymbolSvg>
  );
}

/** TVS unidirectional — Zener-like cathode bar. */
function TvsUniSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="DTVS" w={48} h={24}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H16" />
        <path d="M16 4 L32 12 L16 20 Z" fill={STROKE} stroke="none" />
        <path d="M28 0 L32 4 V20 L36 24" />
        <path d="M32 12 H48" />
      </g>
    </SymbolSvg>
  );
}

/** TVS bidirectional — two triangles tip-to-tip on a bar. */
function TvsBiSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="DTVSBI" w={48} h={24}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H10" />
        <path d="M10 4 L22 12 L10 20 Z" fill={STROKE} stroke="none" />
        <path d="M22 4 V20" />
        <path d="M38 4 L26 12 L38 20 Z" fill={STROKE} stroke="none" />
        <path d="M38 12 H48" />
      </g>
    </SymbolSvg>
  );
}

/** Thermistor — box with diagonal tick. */
function ThermistorSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="THERM" w={48} h={28}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 14 H10" />
        <rect x="10" y="6" width="28" height="16" />
        <path d="M38 14 H48" />
        <path d="M8 22 L30 4" />
        <path d="M8 22 H14" />
      </g>
    </SymbolSvg>
  );
}

/** LDR — resistor in circle with incoming light arrows. */
function LdrSymbol({ selected }: SymProps) {
  const op = selected ? 1 : 0.92;
  return (
    <SymbolSvg kind="LDR" w={48} h={32}>
      <circle cx="24" cy="16" r="13" fill="var(--bg, #0f1419)" stroke="none" />
      <g {...STROKE_BUTT} opacity={op}>
        <path d="M0 16 H8" />
        <circle cx="24" cy="16" r="13" />
        <path d="M11 16 H14 L16.5 10 L19.5 22 L22.5 10 L25.5 22 L28.5 10 L31.5 22 L34 16 H37" />
        <path d="M40 16 H48" />
        <path d="M36 4 L42 0" />
        <path d="M38 7 L44 3" />
      </g>
      <g fill={STROKE} stroke="none" opacity={op}>
        <path d="M36 4 L39.2 5.6 L37.4 1.2 Z" />
        <path d="M38 7 L41.2 8.6 L39.4 4.2 Z" />
      </g>
    </SymbolSvg>
  );
}

/** Crystal — rectangle between capacitor plates. */
function CrystalSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="XTAL" w={48} h={24}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H12" />
        <path d="M14 4 V20" />
        <rect x="17" y="6" width="14" height="12" />
        <path d="M34 4 V20" />
        <path d="M36 12 H48" />
      </g>
    </SymbolSvg>
  );
}

/** Common-mode choke — two coils with coupling lines. */
function CmmcSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="CMMC" w={56} h={48}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H8" />
        <path d="M8 12 A4 4 0 0 1 16 12 A4 4 0 0 1 24 12 A4 4 0 0 1 32 12" />
        <path d="M32 12 H40" />
        <path d="M0 36 H8" />
        <path d="M8 36 A4 4 0 0 1 16 36 A4 4 0 0 1 24 36 A4 4 0 0 1 32 36" />
        <path d="M32 36 H40" />
        <path d="M42 16 H52" />
        <path d="M42 32 H52" />
        <circle cx="10" cy="8" r="1.4" fill={STROKE} stroke="none" />
        <circle cx="10" cy="40" r="1.4" fill={STROKE} stroke="none" />
      </g>
    </SymbolSvg>
  );
}

/** Two-winding transformer — primary / secondary coils with coupling bars. */
function TransformerSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="XFMR" w={56} h={48}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H10" />
        <path d="M10 12 A4 4 0 0 1 18 12 A4 4 0 0 1 26 12" />
        <path d="M0 36 H10" />
        <path d="M10 36 A4 4 0 0 1 18 36 A4 4 0 0 1 26 36" />
        <path d="M30 10 V38" />
        <path d="M34 10 V38" />
        <path d="M38 12 A4 4 0 0 0 46 12 A4 4 0 0 0 54 12" />
        <path d="M54 12 H56" />
        <path d="M38 36 A4 4 0 0 0 46 36 A4 4 0 0 0 54 36" />
        <path d="M54 36 H56" />
        <circle cx="14" cy="8" r="1.4" fill={STROKE} stroke="none" />
        <circle cx="42" cy="8" r="1.4" fill={STROKE} stroke="none" />
      </g>
    </SymbolSvg>
  );
}

/** Ferrite bead — wire with humps. */
function FerriteBeadSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="FBEAD" w={48} h={24}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 14 H48" />
        <path d="M14 14 A4 4 0 0 1 22 14 A4 4 0 0 1 30 14 A4 4 0 0 1 38 14" />
        <path d="M16 6 H36" />
        <path d="M16 9 H36" />
      </g>
    </SymbolSvg>
  );
}

/** Antenna. */
function AntennaSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="ANT" w={36} h={40}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M18 40 V16" />
        <path d="M18 16 L6 4" />
        <path d="M18 16 L18 2" />
        <path d="M18 16 L30 4" />
      </g>
    </SymbolSvg>
  );
}

/** SPST open switch. */
function SpstSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="SPST" w={48} h={24}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 16 H10" />
        <circle cx="12" cy="16" r="2.2" fill={STROKE} stroke="none" />
        <path d="M14 15 L34 6" />
        <circle cx="36" cy="16" r="2.2" fill={STROKE} stroke="none" />
        <path d="M38 16 H48" />
      </g>
    </SymbolSvg>
  );
}

/** SPDT switch. */
function SpdtSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="SPDT" w={48} h={32}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 16 H10" />
        <circle cx="12" cy="16" r="2.2" fill={STROKE} stroke="none" />
        <path d="M14 15 L34 8" />
        <circle cx="36" cy="8" r="2.2" fill={STROKE} stroke="none" />
        <circle cx="36" cy="24" r="2.2" fill={STROKE} stroke="none" />
        <path d="M38 8 H48" />
        <path d="M38 24 H48" />
      </g>
    </SymbolSvg>
  );
}

/** Push button (NO). */
function PushButtonSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="PB" w={48} h={32}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 22 H12" />
        <circle cx="14" cy="22" r="2.2" fill={STROKE} stroke="none" />
        <circle cx="34" cy="22" r="2.2" fill={STROKE} stroke="none" />
        <path d="M36 22 H48" />
        <path d="M12 14 H36" />
        <path d="M24 14 V6" />
        <path d="M20 6 H28" />
      </g>
    </SymbolSvg>
  );
}

/** AND gate. */
function AndGateSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="AND" w={56} h={40}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H14" />
        <path d="M0 28 H14" />
        <path d="M14 4 V36 H30 A16 16 0 0 0 30 4 Z" />
        <path d="M46 20 H56" />
      </g>
    </SymbolSvg>
  );
}

/** OR gate. */
function OrGateSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="OR" w={56} h={40}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H16" />
        <path d="M0 28 H16" />
        <path d="M10 4 Q22 4 34 12 Q40 16 46 20 Q40 24 34 28 Q22 36 10 36 Q18 20 10 4 Z" />
        <path d="M46 20 H56" />
      </g>
    </SymbolSvg>
  );
}

/** NAND = AND + bubble. */
function NandGateSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="NAND" w={56} h={40}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H14" />
        <path d="M0 28 H14" />
        <path d="M14 4 V36 H28 A16 16 0 0 0 28 4 Z" />
        <circle cx="46" cy="20" r="3.2" fill="var(--bg, #0f1419)" />
        <path d="M49 20 H56" />
      </g>
    </SymbolSvg>
  );
}

/** NOR = OR + bubble. */
function NorGateSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="NOR" w={56} h={40}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H16" />
        <path d="M0 28 H16" />
        <path d="M10 4 Q22 4 32 12 Q36 16 42 20 Q36 24 32 28 Q22 36 10 36 Q18 20 10 4 Z" />
        <circle cx="46" cy="20" r="3.2" fill="var(--bg, #0f1419)" />
        <path d="M49 20 H56" />
      </g>
    </SymbolSvg>
  );
}

/** XOR gate. */
function XorGateSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="XOR" w={56} h={40}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H14" />
        <path d="M0 28 H14" />
        <path d="M8 4 Q16 20 8 36" fill="none" />
        <path d="M14 4 Q26 4 36 12 Q42 16 46 20 Q42 24 36 28 Q26 36 14 36 Q22 20 14 4 Z" />
        <path d="M46 20 H56" />
      </g>
    </SymbolSvg>
  );
}

/** XNOR = XOR + bubble. */
function XnorGateSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="XNOR" w={56} h={40}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H14" />
        <path d="M0 28 H14" />
        <path d="M8 4 Q16 20 8 36" fill="none" />
        <path d="M14 4 Q26 4 34 12 Q38 16 42 20 Q38 24 34 28 Q26 36 14 36 Q22 20 14 4 Z" />
        <circle cx="46" cy="20" r="3.2" fill="var(--bg, #0f1419)" />
        <path d="M49 20 H56" />
      </g>
    </SymbolSvg>
  );
}

/** NOT / inverter. */
function NotGateSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="NOT" w={56} h={40}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 20 H14" />
        <path d="M14 6 L40 20 L14 34 Z" />
        <circle cx="44" cy="20" r="3.2" fill="var(--bg, #0f1419)" />
        <path d="M47 20 H56" />
      </g>
    </SymbolSvg>
  );
}

/** Rectangular flip-flop body with pin stubs. */
function FlipFlopSymbol({
  kind,
  selected,
  leftLabels,
  rightLabels = ["Q", "Q̅"],
}: SymProps & { kind: ComponentKind; leftLabels: string[]; rightLabels?: string[] }) {
  const h = 48;
  const w = 64;
  const nL = leftLabels.length;
  const nR = rightLabels.length;
  return (
    <SymbolSvg kind={kind} w={w} h={h}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <rect x="14" y="4" width="36" height="40" />
        {leftLabels.map((lab, i) => {
          const y = 4 + ((i + 1) / (nL + 1)) * 40;
          return (
            <g key={`L${lab}${i}`}>
              <path d={`M0 ${y} H14`} />
              <text
                x={18}
                y={y}
                fill={STROKE}
                stroke="none"
                fontSize="7"
                dominantBaseline="central"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {lab}
              </text>
            </g>
          );
        })}
        {rightLabels.map((lab, i) => {
          const y = 4 + ((i + 1) / (nR + 1)) * 40;
          return (
            <g key={`R${lab}${i}`}>
              <path d={`M50 ${y} H${w}`} />
              <text
                x={46}
                y={y}
                fill={STROKE}
                stroke="none"
                fontSize="7"
                textAnchor="end"
                dominantBaseline="central"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {lab}
              </text>
            </g>
          );
        })}
      </g>
    </SymbolSvg>
  );
}

function SrFfSymbol({ selected }: SymProps) {
  return <FlipFlopSymbol kind="SRFF" selected={selected} leftLabels={["S", "R"]} />;
}
function JkFfSymbol({ selected }: SymProps) {
  return <FlipFlopSymbol kind="JKFF" selected={selected} leftLabels={["J", "CLK", "K"]} />;
}
function TFfSymbol({ selected }: SymProps) {
  return <FlipFlopSymbol kind="TFF" selected={selected} leftLabels={["T", "CLK"]} />;
}
function DFfSymbol({ selected }: SymProps) {
  return <FlipFlopSymbol kind="DFF" selected={selected} leftLabels={["D", "CLK"]} />;
}

function DiodeSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="D" w={48} h={24}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H16" />
        <path d="M16 4 L32 12 L16 20 Z" fill={STROKE} stroke="none" />
        <path d="M32 4 V20" />
        <path d="M32 12 H48" />
      </g>
    </SymbolSvg>
  );
}

function ZenerDiodeSymbol({ selected }: SymProps) {
  // Diode body + Z-shaped cathode bar (wings at top-left / bottom-right).
  return (
    <SymbolSvg kind="DZ" w={48} h={24}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H16" />
        <path d="M16 4 L32 12 L16 20 Z" fill={STROKE} stroke="none" />
        <path d="M28 0 L32 4 V20 L36 24" />
        <path d="M32 12 H48" />
      </g>
    </SymbolSvg>
  );
}

/** Schottky: filled triangle + S/Z cathode bar (top hook right, bottom hook left). */
function SchottkyDiodeSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="DS" w={48} h={24}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H16" />
        <path d="M16 4 L32 12 L16 20 Z" fill={STROKE} stroke="none" />
        {/* Cathode bar with opposite hooks (classic Schottky). */}
        <path d="M36 6 V4 H32 V20 H28 V18" />
        <path d="M32 12 H48" />
      </g>
    </SymbolSvg>
  );
}

/** LED: PN diode + two emission arrows (no enclosure box). */
function LedSymbol({ selected }: SymProps) {
  const op = selected ? 1 : 0.92;
  return (
    <SymbolSvg kind="LED" w={48} h={28}>
      <g {...STROKE_BUTT} opacity={op}>
        {/* Same body as PN diode, centered on y=14 for arrow headroom. */}
        <path d="M0 14 H16" />
        <path d="M16 6 L32 14 L16 22 Z" fill={STROKE} stroke="none" />
        <path d="M32 6 V22" />
        <path d="M32 14 H48" />
        {/* Emission arrows (up-right from cathode side). */}
        <path d="M34 7 L42 2" />
        <path d="M36 10 L44 5" />
      </g>
      <g fill={STROKE} stroke="none" opacity={op}>
        <path d="M42 2 L38.5 2.6 L40.6 5.4 Z" />
        <path d="M44 5 L40.5 5.6 L42.6 8.4 Z" />
      </g>
    </SymbolSvg>
  );
}

function CurrentSymbol({ selected }: SymProps) {
  const cx = 20;
  const cy = 32;
  const r = 18;
  const h = 64;
  return (
    <SymbolSvg kind="I" w={40} h={h}>
      <circle cx={cx} cy={cy} r={r} fill="var(--bg, #0f1419)" stroke="none" />
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d={`M${cx} 0 V${cy - r}`} />
        <circle cx={cx} cy={cy} r={r} />
        <path d={`M${cx} ${cy + r} V${h}`} />
        <path d={`M${cx} ${cy - 6} V${cy + 6}`} />
        <path d={`M${cx} ${cy + 6} L${cx - 5} ${cy - 2} M${cx} ${cy + 6} L${cx + 5} ${cy - 2}`} />
      </g>
    </SymbolSvg>
  );
}

/** Circled transistors — 1:1 in 96×128. Pins at (48,0), (0,64), (48,128). */
const TX = { w: 96, h: 128, cx: 48, cy: 64, r: 32, gateSw: 3.8 };
/** Depletion channel extends past D/S tees (textbook solid bar). */
const DEP_CH_EXT = 6;
/** Uncircled MOSFET gate plate — slightly heavier than channel, not as thick as circled parts. */
const MOS_GATE_SW = 2.2;
/** Filled polarity arrow. Lead should stop at `bx,by` so the triangle stays clean. */
const ARROW_LEN = 8;
const ARROW_HALF = 3.6;

function txOpacity(selected?: boolean) {
  return selected ? 1 : 0.92;
}

function lerp(x1: number, y1: number, x2: number, y2: number, t: number) {
  return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
}

function filledArrow(
  tipX: number,
  tipY: number,
  fromX: number,
  fromY: number,
  len = ARROW_LEN,
  half = ARROW_HALF,
) {
  const dx = tipX - fromX;
  const dy = tipY - fromY;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  const px = -uy;
  const py = ux;
  const bx = tipX - ux * len;
  const by = tipY - uy * len;
  return {
    d: `M${tipX} ${tipY} L${bx + px * half} ${by + py * half} L${bx - px * half} ${by - py * half} Z`,
    bx,
    by,
    tipX,
    tipY,
  };
}

function circledTransistor({
  kind,
  selected,
  children,
  arrow,
}: {
  kind: ComponentKind;
  selected?: boolean;
  children: ReactNode;
  arrow?: string;
}) {
  return (
    <SymbolSvg kind={kind} w={TX.w} h={TX.h}>
      <g {...STROKE_BUTT} opacity={txOpacity(selected)}>
        <circle cx={TX.cx} cy={TX.cy} r={TX.r} />
        {children}
      </g>
      {arrow ? <PolarityArrow d={arrow} selected={selected} /> : null}
    </SymbolSvg>
  );
}

function PolarityArrow({
  d,
  selected,
}: {
  d: string;
  selected?: boolean;
}) {
  return (
    <path
      d={d}
      fill={STROKE}
      stroke="none"
      opacity={txOpacity(selected)}
    />
  );
}

/** Schematic diode on a vertical branch (triangle + bar — not a channel arrow).
 *  Optional `centerY` places the diode body on that level (e.g. mid-channel arrow). */
function verticalBodyDiode(
  x: number,
  yHigh: number,
  yLow: number,
  pointToHigh: boolean,
  centerY?: number,
) {
  const triHalf = 6.5;
  const barHalf = 8;
  const triH = 13;
  if (pointToHigh) {
    // N-channel: anode at S, cathode at D — triangle tip + bar toward D (top)
    const yBase = centerY != null ? centerY + triH / 2 : yLow - 14;
    const yTip = centerY != null ? centerY - triH / 2 : yBase - triH;
    return (
      <>
        <path d={`M${x} ${yLow} V${yBase}`} />
        <path
          d={`M${x - triHalf} ${yBase} L${x} ${yTip} L${x + triHalf} ${yBase} Z`}
          fill={STROKE}
          stroke="none"
        />
        <path d={`M${x - barHalf} ${yTip} H${x + barHalf}`} strokeWidth={SW} />
        <path d={`M${x} ${yTip} V${yHigh}`} />
      </>
    );
  }
  // P-channel: tip + bar toward S (bottom)
  const yBase = centerY != null ? centerY - triH / 2 : yHigh + 14;
  const yTip = centerY != null ? centerY + triH / 2 : yBase + triH;
  return (
    <>
      <path d={`M${x} ${yHigh} V${yBase}`} />
      <path
        d={`M${x - triHalf} ${yBase} L${x} ${yTip} L${x + triHalf} ${yBase} Z`}
        fill={STROKE}
        stroke="none"
      />
      <path d={`M${x - barHalf} ${yTip} H${x + barHalf}`} strokeWidth={SW} />
      <path d={`M${x} ${yTip} V${yLow}`} />
    </>
  );
}

/** Standard textbook MOSFET — uncircled, body diode, enh = dashed channel / dep = solid. */
function StandardMosfetBody({
  kind,
  selected,
  depletion,
  pChannel,
}: SymProps & { kind: ComponentKind; depletion: boolean; pChannel: boolean }) {
  const c = uncircledEnhMosCore(pChannel);
  const o = txOpacity(selected);

  return (
    <SymbolSvg kind={kind} w={TX.w} h={TX.h}>
      <g {...STROKE_BUTT} opacity={o}>
        {depletion ? (
          <>
            {/* Depletion: inverted-L gate — stub at bottom of gate plate. */}
            <path d={`M0 ${c.gateFootY} H${c.gateX}`} />
            <path d={`M${c.gateX} ${c.yTop} V${c.gateFootY}`} strokeWidth={MOS_GATE_SW} />
          </>
        ) : (
          <>
            {/* Enhancement: inverted-L gate — stub at bottom of gate plate. */}
            <path d={`M0 ${c.gateFootY} H${c.gateX}`} />
            <path d={`M${c.gateX} ${c.yTop} V${c.gateFootY}`} strokeWidth={MOS_GATE_SW} />
          </>
        )}

        {depletion ? (
          <path d={`M${c.ch} ${c.yTop - DEP_CH_EXT} V${c.yBot + DEP_CH_EXT}`} strokeWidth={SW} />
        ) : (
          <>
            <path d={`M${c.ch} ${c.yTop} V${c.yTopEnd}`} />
            <path d={`M${c.ch} ${c.yMidLo} V${c.yMidHi}`} />
            <path d={`M${c.ch} ${c.yBotStart} V${c.yBot}`} />
          </>
        )}

        {depletion ? (
          pChannel ? (
            <>
              <path d={`M${TX.cx} 0 V${c.yTop} H${c.ch}`} />
              <path d={`M${c.ch} ${c.yBot} H${c.arr.tipX}`} />
              <path d={`M${c.ch} ${c.yMid} H${c.arr.bx}`} />
              <path d={`M${c.arr.tipX} ${c.yMid} V${TX.h}`} />
            </>
          ) : (
            <>
              <path d={`M${TX.cx} 0 V${c.yTop} H${c.ch}`} />
              <path d={`M${c.ch} ${c.yBot} H${TX.cx}`} />
              <path d={`M${c.ch} ${c.yMid} H${c.arr.bx}`} />
              <path d={`M${c.arr.bx} ${c.yMid} H${TX.cx} V${TX.h}`} />
            </>
          )
        ) : pChannel ? (
          <>
            {/* PMOS enh: full body column at arrow tip (top + bottom). */}
            <path d={`M${TX.cx} 0 V${c.yTopMid} H${c.dioX}`} />
            <path d={`M${c.ch} ${c.yTopMid} H${c.bodyX}`} />
            <path d={`M${c.ch} ${c.yMid} H${c.arr.bx}`} />
            <path d={`M${c.arr.tipX} ${c.yMid} V${TX.h}`} />
            <path d={`M${c.ch} ${c.yBotMid} H${c.arr.tipX}`} />
            <path d={`M${c.arr.tipX} ${c.yBotMid} H${c.dioX}`} />
          </>
        ) : (
          <>
            {/* D rail; S pin + body tie share one vertical at TX.cx (no offset). */}
            <path d={`M${TX.cx} 0 V${c.yTopMid} H${c.dioX}`} />
            <path d={`M${c.ch} ${c.yTopMid} H${c.bodyX}`} />
            <path d={`M${c.ch} ${c.yBotMid} H${TX.cx}`} />
            <path d={`M${c.ch} ${c.yMid} H${c.arr.bx}`} />
            <path d={`M${c.arr.bx} ${c.yMid} H${TX.cx} V${TX.h}`} />
            <path d={`M${TX.cx} ${c.yBotMid} H${c.dioX}`} />
          </>
        )}

        {/* Body diode — enhancement: center on mid-channel arrow; depletion: default span */}
        {depletion ? (
          <>
            <path d={`M${TX.cx} ${c.yTop} H${c.dioX}`} />
            {verticalBodyDiode(c.dioX, c.yTop, c.yBot, !pChannel, c.yMid)}
            <path d={`M${c.dioX} ${c.yBot} H${pChannel ? c.arr.tipX : TX.cx}`} />
          </>
        ) : (
          verticalBodyDiode(c.dioX, c.yTopMid, c.yBotMid, !pChannel, c.yMid)
        )}
      </g>
      <PolarityArrow d={c.arr.d} selected={selected} />
    </SymbolSvg>
  );
}

function NmosSymbol({ selected }: SymProps) {
  return (
    <StandardMosfetBody kind="NMOS" selected={selected} depletion={false} pChannel={false} />
  );
}

function PmosSymbol({ selected }: SymProps) {
  return (
    <StandardMosfetBody kind="PMOS" selected={selected} depletion={false} pChannel={true} />
  );
}

function NmosDepSymbol({ selected }: SymProps) {
  return (
    <StandardMosfetBody kind="NMOS_D" selected={selected} depletion={true} pChannel={false} />
  );
}

function PmosDepSymbol({ selected }: SymProps) {
  return (
    <StandardMosfetBody kind="PMOS_D" selected={selected} depletion={true} pChannel={true} />
  );
}

function NjfetSymbol({ selected }: SymProps) {
  return <JfetBody kind="NJFET" selected={selected} nChannel={true} />;
}

function PjfetSymbol({ selected }: SymProps) {
  return <JfetBody kind="PJFET" selected={selected} nChannel={false} />;
}

/** JFET — same family as BJT: compact channel, filled gate arrow with a gap. */
function JfetBody({
  kind,
  selected,
  nChannel,
}: SymProps & { kind: ComponentKind; nChannel: boolean }) {
  const ch = 38;
  const yTop = 46;
  const yBot = 82;
  const cy = TX.cy;
  const arr = nChannel
    ? filledArrow(ch - 1.5, cy, 0, cy)
    : filledArrow(20, cy, ch, cy);

  return circledTransistor({
    kind,
    selected,
    arrow: arr.d,
    children: (
      <>
        <path d={`M${ch} ${yTop} H${TX.cx} V0`} />
        <path d={`M${ch} ${yBot} H${TX.cx} V${TX.h}`} />
        <path d={`M${ch} ${yTop} V${yBot}`} strokeWidth={TX.gateSw} />
        {nChannel ? (
          <path d={`M0 ${cy} H${arr.bx}`} />
        ) : (
          <path d={`M0 ${cy} H20 M${arr.bx} ${cy} H${ch}`} />
        )}
      </>
    ),
  });
}

function NpnSymbol({ selected }: SymProps) {
  return <BjtBody kind="NPN" selected={selected} npn={true} />;
}

function PnpSymbol({ selected }: SymProps) {
  return <BjtBody kind="PNP" selected={selected} npn={false} />;
}

/** UJT — B2 top, B1 bottom, emitter arrow into channel from left. */
function UjtSymbol({ selected }: SymProps) {
  const ch = 40;
  const yTop = 46;
  const yBot = 82;
  const cy = TX.cy;
  const arr = filledArrow(ch - 1.5, cy, 18, cy);
  return circledTransistor({
    kind: "UJT",
    selected,
    arrow: arr.d,
    children: (
      <>
        <path d={`M${ch} ${yTop} H${TX.cx} V0`} />
        <path d={`M${ch} ${yBot} H${TX.cx} V${TX.h}`} />
        <path d={`M${ch} ${yTop} V${yBot}`} strokeWidth={TX.gateSw} />
        <path d={`M0 ${cy} H${arr.bx}`} />
      </>
    ),
  });
}

/** BJT — compact junction in a large circle; filled emitter arrow on the diagonal. */
function BjtBody({
  kind,
  selected,
  npn,
}: SymProps & { kind: ComponentKind; npn: boolean }) {
  const barX = 36;
  const barTop = 52;
  const barBot = 76;
  const kneeC = { x: TX.cx, y: 40 };
  const kneeE = { x: TX.cx, y: 88 };

  if (npn) {
    // Filled triangle on emitter — tip must sit far enough out that the base
    // stays on the diagonal (not behind the bar corner).
    const dx = kneeE.x - barX;
    const dy = kneeE.y - barBot;
    const diagLen = Math.hypot(dx, dy) || 1;
    const tipT = Math.min(0.58, (ARROW_LEN + 2) / diagLen);
    const mid = lerp(barX, barBot, kneeE.x, kneeE.y, tipT);
    const arr = filledArrow(mid.x, mid.y, barX, barBot);
    return circledTransistor({
      kind,
      selected,
      arrow: arr.d,
      children: (
        <>
          <path d={`M0 ${TX.cy} H${barX}`} />
          <path d={`M${barX} ${barTop} L${kneeC.x} ${kneeC.y} V0`} />
          <path
            d={`M${barX} ${barBot} L${arr.bx} ${arr.by} M${mid.x} ${mid.y} L${kneeE.x} ${kneeE.y} V${TX.h}`}
          />
          <path d={`M${barX} ${barTop} V${barBot}`} strokeWidth={TX.gateSw} />
        </>
      ),
    });
  }

  const emit = (t: number) => lerp(barX, barBot, kneeE.x, kneeE.y, t);
  const arr = filledArrow(emit(0.14).x, emit(0.14).y, kneeE.x, kneeE.y);
  return circledTransistor({
    kind,
    selected,
    arrow: arr.d,
    children: (
      <>
        <path d={`M0 ${TX.cy} H${barX}`} />
        <path d={`M${barX} ${barTop} L${kneeC.x} ${kneeC.y} V0`} />
        <path d={`M${barX} ${barBot} L${kneeE.x} ${kneeE.y} V${TX.h}`} />
        <path d={`M${barX} ${barTop} V${barBot}`} strokeWidth={TX.gateSw} />
      </>
    ),
  });
}

/** Uncircled enhancement MOSFET core — same geometry as circled M-series. */
function uncircledEnhMosCore(pChannel = false) {
  const ch = 30;
  const gateX = 20;
  const yTop = 28;
  const yTopEnd = 34;
  const yTopMid = (yTop + yTopEnd) / 2;
  const yMidLo = 58;
  const yMidHi = 70;
  const yMid = 64;
  const yBotStart = 94;
  const yBot = 100;
  const yBotMid = (yBotStart + yBot) / 2;
  const bodyX = 58;
  /** Gate lead meets bottom of gate plate (textbook L). */
  const gateFootY = yBot;
  /** Horizontal gap between body-tie column and parallel body-diode branch. */
  const dioX = bodyX + 16;
  const arr = pChannel
    ? filledArrow(bodyX - 1.2, yMid, ch, yMid)
    : filledArrow(ch + 1.2, yMid, bodyX, yMid);
  return {
    ch,
    gateX,
    yTop,
    yTopEnd,
    yTopMid,
    yMidLo,
    yMidHi,
    yMid,
    yBotStart,
    yBot,
    yBotMid,
    gateFootY,
    bodyX,
    dioX,
    arr,
  };
}

function IgbtSymbol({ selected }: SymProps) {
  const ch = 40;
  const yBot = 78;
  const kneeE = { x: TX.cx, y: 90 };
  // Tip low on the emitter diagonal (near circle exit).
  const mid = lerp(ch, yBot, kneeE.x, kneeE.y, 0.82);
  const arr = filledArrow(mid.x, mid.y, ch, yBot);
  // Thin insulated-gate L; pin at y=80 (componentSpecs).
  const gateX = 32;
  const gateBot = 80;
  const gateTop = 50;
  return circledTransistor({
    kind: "IGBT",
    selected,
    arrow: arr.d,
    children: (
      <>
        <path d={`M0 ${gateBot} H${gateX}`} />
        <path d={`M${gateX} ${gateBot} V${gateTop}`} />
        <path d={`M${ch} 46 V${yBot}`} />
        <path d={`M${ch} 52 L${TX.cx} 38 V0`} />
        <path
          d={`M${ch} ${yBot} L${arr.bx} ${arr.by} M${mid.x} ${mid.y} L${kneeE.x} ${kneeE.y} V${TX.h}`}
        />
      </>
    ),
  });
}

function IgbtKelvinSymbol({ selected }: SymProps) {
  const ch = 40;
  const yBot = 78;
  const eX = 64;
  const ekX = 32;
  const kneeE = { x: eX, y: 96 };
  const mid = lerp(ch, yBot, kneeE.x, kneeE.y, 0.35);
  const arr = filledArrow(mid.x, mid.y, ch, yBot);
  return circledTransistor({
    kind: "IGBT_K",
    selected,
    arrow: arr.d,
    children: (
      <>
        <path d={`M0 ${TX.cy} H22`} />
        <path d={`M22 48 V${TX.cy}`} strokeWidth={TX.gateSw} />
        <path d={`M${ch} 46 V${yBot}`} />
        <path d={`M${ch} 52 L${TX.cx} 38 V0`} />
        <path
          d={`M${ch} ${yBot} L${arr.bx} ${arr.by} M${mid.x} ${mid.y} L${kneeE.x} ${kneeE.y} V${TX.h}`}
        />
        <path d={`M${ch} ${yBot} L${ekX} 104 V${TX.h}`} strokeWidth={1.3} />
      </>
    ),
  });
}

/** LTspice SCR: anode top, cathode bottom, gate from lower-left into cathode. */
function ScrSymbol({ selected }: SymProps) {
  const cx = 40;
  const yBase = 22;
  const yTip = 50;
  const yGate = 64;
  const half = 16;
  return (
    <SymbolSvg kind="SCR" w={64} h={96}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d={`M${cx} 0 V${yBase}`} />
        <path
          d={`M${cx - half} ${yBase} L${cx + half} ${yBase} L${cx} ${yTip} Z`}
          fill={STROKE}
          stroke="none"
        />
        <path d={`M${cx - half - 2} ${yTip} H${cx + half + 2}`} />
        <path d={`M${cx} ${yTip} V96`} />
        <path d={`M0 ${yGate} H${cx - 12} L${cx} ${yTip + 5}`} />
      </g>
    </SymbolSvg>
  );
}

/** SCS — SCR with cathode gate + anode gate. */
function ScsSymbol({ selected }: SymProps) {
  const cx = 40;
  const yBase = 22;
  const yTip = 50;
  const half = 16;
  return (
    <SymbolSvg kind="SCS" w={64} h={96}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d={`M${cx} 0 V${yBase}`} />
        <path
          d={`M${cx - half} ${yBase} L${cx + half} ${yBase} L${cx} ${yTip} Z`}
          fill={STROKE}
          stroke="none"
        />
        <path d={`M${cx - half - 2} ${yTip} H${cx + half + 2}`} />
        <path d={`M${cx} ${yTip} V96`} />
        <path d={`M0 64 H${cx - 12} L${cx} ${yTip + 5}`} />
        <path d={`M64 28 H${cx + 12} L${cx} ${yBase + 4}`} />
      </g>
    </SymbolSvg>
  );
}

/** TRIAC — antiparallel SCR triangles + gate. */
function TriacSymbol({ selected }: SymProps) {
  const cx = 40;
  return (
    <SymbolSvg kind="TRIAC" w={64} h={96}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d={`M${cx} 0 V18`} />
        <path d={`M${cx - 14} 18 L${cx + 14} 18 L${cx} 42 Z`} fill={STROKE} stroke="none" />
        <path d={`M${cx - 16} 42 H${cx + 16}`} />
        <path d={`M${cx + 14} 78 L${cx - 14} 78 L${cx} 54 Z`} fill={STROKE} stroke="none" />
        <path d={`M${cx - 16} 54 H${cx + 16}`} />
        <path d={`M${cx} 78 V96`} />
        <path d="M0 70 H28 L40 58" />
      </g>
    </SymbolSvg>
  );
}

/** DIAC — two triangles tip-to-tip (no gate). */
function DiacSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="DIAC" w={48} h={24}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H10" />
        <path d="M10 4 L22 12 L10 20 Z" fill={STROKE} stroke="none" />
        <path d="M22 4 V20" />
        <path d="M38 4 L26 12 L38 20 Z" fill={STROKE} stroke="none" />
        <path d="M38 12 H48" />
      </g>
    </SymbolSvg>
  );
}

/** GTO — SCR with gate cross-bar. */
function GtoSymbol({ selected }: SymProps) {
  const cx = 40;
  const yBase = 22;
  const yTip = 50;
  const yGate = 64;
  const half = 16;
  return (
    <SymbolSvg kind="GTO" w={64} h={96}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d={`M${cx} 0 V${yBase}`} />
        <path
          d={`M${cx - half} ${yBase} L${cx + half} ${yBase} L${cx} ${yTip} Z`}
          fill={STROKE}
          stroke="none"
        />
        <path d={`M${cx - half - 2} ${yTip} H${cx + half + 2}`} />
        <path d={`M${cx} ${yTip} V96`} />
        <path d={`M0 ${yGate} H${cx - 12} L${cx} ${yTip + 5}`} />
        <path d={`M4 ${yGate - 5} V${yGate + 5}`} />
      </g>
    </SymbolSvg>
  );
}

/** Photo-thyristor — SCR + light arrows. */
function PhotoScrSymbol({ selected }: SymProps) {
  const cx = 40;
  const yBase = 22;
  const yTip = 50;
  const half = 16;
  return (
    <SymbolSvg kind="SCR_PH" w={64} h={96}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d={`M${cx} 0 V${yBase}`} />
        <path
          d={`M${cx - half} ${yBase} L${cx + half} ${yBase} L${cx} ${yTip} Z`}
          fill={STROKE}
          stroke="none"
        />
        <path d={`M${cx - half - 2} ${yTip} H${cx + half + 2}`} />
        <path d={`M${cx} ${yTip} V96`} />
        <path d={`M0 64 H${cx - 12} L${cx} ${yTip + 5}`} />
        <path d="M8 28 L18 36" />
        <path d="M10 22 L20 30" />
      </g>
      <g fill={STROKE} stroke="none" opacity={selected ? 1 : 0.92}>
        <path d="M18 36 L14.8 33.2 L17.2 31.6 Z" />
        <path d="M20 30 L16.8 27.2 L19.2 25.6 Z" />
      </g>
    </SymbolSvg>
  );
}

/** SIDAC — DIAC-like in a circle with breakover zig. */
function SidacSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="SIDAC" w={48} h={28}>
      <circle cx="24" cy="14" r="12" fill="var(--bg, #0f1419)" stroke="none" />
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 14 H8" />
        <circle cx="24" cy="14" r="12" />
        <path d="M12 14 L18 8 L24 14 L30 20 L36 14" />
        <path d="M40 14 H48" />
      </g>
    </SymbolSvg>
  );
}

/** Differential amplifier — triangle with Δ mark. */
function DiffAmpSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="DIFFAMP" w={56} h={40}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H14" />
        <path d="M0 28 H14" />
        <path d="M14 4 L48 20 L14 36 Z" />
        <path d="M48 20 H56" />
        <text
          x="22"
          y="21"
          fill={STROKE}
          stroke="none"
          fontSize="9"
          fontWeight="700"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          Δ
        </text>
      </g>
    </SymbolSvg>
  );
}

/** Constant — box with value, output on right. */
function MathConstSymbol({ selected, params }: SymProps) {
  const v = (params?.value ?? "1").slice(0, 6);
  return (
    <SymbolSvg kind="MATH_CONST" w={48} h={40}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <rect x="4" y="6" width="32" height="28" />
        <path d="M36 20 H48" />
        <text
          x="20"
          y="21"
          fill={STROKE}
          stroke="none"
          fontSize="11"
          fontWeight="700"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {v || "1"}
        </text>
      </g>
    </SymbolSvg>
  );
}

/** Sum — circle with +/− marks for each input. */
function MathSumSymbol({ selected, params }: SymProps) {
  const signs = parseSumSigns(params?.signs ?? "+-");
  const n = signs.length;
  return (
    <SymbolSvg kind="MATH_SUM" w={48} h={48}>
      <circle cx="22" cy="24" r="14" fill="var(--bg, #0f1419)" stroke="none" />
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <circle cx="22" cy="24" r="14" />
        <path d="M36 24 H48" />
        {signs.map((s, i) => {
          const y = ((i + 1) / (n + 1)) * 48;
          return (
            <g key={i}>
              <path d={`M0 ${y} H8`} />
              <text
                x="14"
                y={y}
                fill={STROKE}
                stroke="none"
                fontSize="10"
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {s}
              </text>
            </g>
          );
        })}
      </g>
    </SymbolSvg>
  );
}

/** Product — tall box with × / ÷ per input. */
function MathProdSymbol({ selected, params }: SymProps) {
  const ops = parseProductOps(params?.ops ?? "**");
  const n = ops.length;
  const h = 64;
  return (
    <SymbolSvg kind="MATH_PROD" w={40} h={h}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <rect x="10" y="4" width="20" height={h - 8} />
        <path d={`M30 ${h / 2} H40`} />
        {ops.map((op, i) => {
          const y = ((i + 1) / (n + 1)) * h;
          return (
            <g key={i}>
              <path d={`M0 ${y} H10`} />
              <text
                x="20"
                y={y}
                fill={STROKE}
                stroke="none"
                fontSize="11"
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {op === "*" ? "×" : "÷"}
              </text>
            </g>
          );
        })}
      </g>
    </SymbolSvg>
  );
}

/** Gain — triangle with gain value. */
function MathGainSymbol({ selected, params }: SymProps) {
  const g = (params?.gain ?? "1").slice(0, 5);
  return (
    <SymbolSvg kind="MATH_GAIN" w={48} h={40}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 20 H8" />
        <path d="M8 4 L40 20 L8 36 Z" />
        <path d="M40 20 H48" />
        <text
          x="20"
          y="21"
          fill={STROKE}
          stroke="none"
          fontSize="10"
          fontWeight="700"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {g || "1"}
        </text>
      </g>
    </SymbolSvg>
  );
}

/** Relational operator block. */
function MathRelSymbol({ selected, params }: SymProps) {
  const op = (params?.op ?? "<=").slice(0, 3);
  return (
    <SymbolSvg kind="MATH_REL" w={56} h={40}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d="M0 12 H10" />
        <path d="M0 28 H10" />
        <rect x="10" y="4" width="32" height="32" />
        <path d="M42 20 H56" />
        <text
          x="26"
          y="21"
          fill={STROKE}
          stroke="none"
          fontSize="11"
          fontWeight="700"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {op}
        </text>
      </g>
    </SymbolSvg>
  );
}

/** Logical operator block — N left inputs from params.inputs (NOT → 1). */
function MathLogicSymbol({ selected, params }: SymProps) {
  const op = (params?.op ?? "AND").toUpperCase();
  const pins = (() => {
    const raw = params?.inputs ?? "2";
    if (op === "NOT") return 1;
    let n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 2) n = 2;
    if (n > 8) n = 8;
    return n;
  })();
  const label = op.slice(0, 4);
  return (
    <SymbolSvg kind="MATH_LOGIC" w={56} h={40}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        {Array.from({ length: pins }, (_, i) => {
          const y = ((i + 1) / (pins + 1)) * 40;
          return <path key={i} d={`M0 ${y} H10`} />;
        })}
        <rect x="10" y="4" width="32" height="32" />
        <path d="M42 20 H56" />
        <text
          x="26"
          y="21"
          fill={STROKE}
          stroke="none"
          fontSize={label.length > 3 ? "8" : "9"}
          fontWeight="700"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {label}
        </text>
      </g>
    </SymbolSvg>
  );
}

/** Uncircled enhancement MOSFET (GaN HEMT) — matches M-series without circle. */
function MosfetBody({ selected, kind }: SymProps & { kind: ComponentKind }) {
  const c = uncircledEnhMosCore();
  const o = txOpacity(selected);
  return (
    <SymbolSvg kind={kind} w={TX.w} h={TX.h}>
      <g {...STROKE_BUTT} opacity={o}>
        <path d={`M0 ${c.gateFootY} H${c.gateX}`} />
        <path d={`M${c.gateX} ${c.yTop} V${c.gateFootY}`} strokeWidth={MOS_GATE_SW} />
        <path d={`M${c.ch} ${c.yTop} V${c.yTopEnd}`} />
        <path d={`M${c.ch} ${c.yMidLo} V${c.yMidHi}`} />
        <path d={`M${c.ch} ${c.yBotStart} V${c.yBot}`} />
        <path d={`M${TX.cx} 0 V${c.yTop} H${c.ch}`} />
        <path d={`M${TX.cx} ${TX.h} V${c.yBot} H${c.ch}`} />
        <path d={`M${c.arr.bx} ${c.yMid} H${c.bodyX} V${c.yBot} H${TX.cx}`} />
      </g>
      <PolarityArrow d={c.arr.d} selected={selected} />
    </SymbolSvg>
  );
}

function SicMosSymbol({ selected }: SymProps) {
  const c = uncircledEnhMosCore();
  const dioX = 66;
  const o = txOpacity(selected);
  return (
    <SymbolSvg kind="SICMOS" w={TX.w} h={TX.h}>
      <g {...STROKE_BUTT} opacity={o}>
        <path d={`M0 ${c.gateFootY} H${c.gateX}`} />
        <path d={`M${c.gateX} ${c.yTop} V${c.gateFootY}`} strokeWidth={MOS_GATE_SW} />
        <path d={`M${c.ch} ${c.yTop} V${c.yTopEnd}`} />
        <path d={`M${c.ch} ${c.yMidLo} V${c.yMidHi}`} />
        <path d={`M${c.ch} ${c.yBotStart} V${c.yBot}`} />
        <path d={`M${TX.cx} 0 V${c.yTop} H${c.ch}`} />
        <path d={`M${TX.cx} ${TX.h} V${c.yBot} H${c.ch}`} />
        <path d={`M${c.arr.bx} ${c.yMid} H${c.bodyX} V${c.yBot} H${TX.cx}`} />
        <path d={`M${dioX} ${c.yTop + 8} V${c.yBot - 8}`} />
        <path d={`M${dioX} ${c.yMid - 5} L${dioX + 7} ${c.yMid} L${dioX} ${c.yMid + 5} Z`} fill={STROKE} />
        <path d={`M${dioX + 7} ${c.yMid} H${dioX + 12}`} />
      </g>
      <PolarityArrow d={c.arr.d} selected={selected} />
    </SymbolSvg>
  );
}

function SicMosKelvinSymbol({ selected }: SymProps) {
  const c = uncircledEnhMosCore();
  const dioX = 66;
  const splitY = 104;
  const sX = 64;
  const skX = 32;
  const o = txOpacity(selected);
  return (
    <SymbolSvg kind="SICMOS_K" w={TX.w} h={TX.h}>
      <g {...STROKE_BUTT} opacity={o}>
        <path d={`M0 ${TX.cy} H${c.gateX - 6}`} />
        <path d={`M${c.gateX} ${c.yTop} V${c.yBot}`} strokeWidth={MOS_GATE_SW} />
        <path d={`M${c.ch} ${c.yTop} V${c.yTopEnd}`} />
        <path d={`M${c.ch} ${c.yMidLo} V${c.yMidHi}`} />
        <path d={`M${c.ch} ${c.yBotStart} V${c.yBot}`} />
        <path d={`M${TX.cx} 0 V${c.yTop} H${c.ch}`} />
        <path d={`M${c.arr.bx} ${c.yMid} H${c.bodyX} V${c.yBot} H${TX.cx}`} />
        <path d={`M${TX.cx} ${c.yBot} V${splitY} H${sX} V${TX.h}`} />
        <path d={`M${TX.cx} ${splitY} H${skX} V${TX.h}`} strokeWidth={1.3} />
        <path d={`M${dioX} ${c.yTop + 8} V${c.yBot - 8}`} />
        <path d={`M${dioX} ${c.yMid - 5} L${dioX + 7} ${c.yMid} L${dioX} ${c.yMid + 5} Z`} fill={STROKE} />
        <path d={`M${dioX + 7} ${c.yMid} H${dioX + 12}`} />
      </g>
      <PolarityArrow d={c.arr.d} selected={selected} />
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
        strokeLinecap="butt"
        strokeLinejoin="miter"
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
        strokeLinecap="butt"
        strokeLinejoin="miter"
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
        strokeLinecap="butt"
        strokeLinejoin="miter"
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
        strokeLinecap="butt"
        strokeLinejoin="miter"
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
        strokeLinecap="butt"
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
        strokeLinecap="butt"
        strokeLinejoin="miter"
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
        strokeLinecap="butt"
        strokeLinejoin="miter"
        opacity={selected ? 1 : 0.92}
      >
        <path d="M0 12 H8" />
        <circle cx="8" cy="12" r="2.2" fill={STROKE} stroke="none" />
        <path d="M10 6 H28 L34 12 L28 18 H10 Z" />
      </g>
    </SymbolSvg>
  );
}

/**
 * LTspice Label Net body: no lead stub — the React Flow pin square IS the
 * join mark; the net name is drawn as text beside/above it.
 */
function WireLabelSymbol({ selected }: SymProps) {
  void selected;
  return (
    <SymbolSvg kind="WIRELABEL" w={16} h={16}>
      <g />
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
        strokeLinecap="butt"
        strokeLinejoin="miter"
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
        strokeLinecap="butt"
        strokeLinejoin="miter"
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
        strokeLinecap="butt"
        strokeLinejoin="miter"
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
  XFMR: TransformerSymbol,
  V: VoltageSymbol,
  BATTERY: BatterySymbol,
  VAC: AcSourceSymbol,
  I: CurrentSymbol,
  IAC: AcCurrentSymbol,
  VPULSE: PulseGenSymbol,
  GND: GroundSymbol,
  GND_SIG: GroundSigSymbol,
  GND_CH: GroundChassisSymbol,
  D: DiodeSymbol,
  DZ: ZenerDiodeSymbol,
  DS: SchottkyDiodeSymbol,
  LED: LedSymbol,
  DTVS: TvsUniSymbol,
  DTVSBI: TvsBiSymbol,
  THERM: ThermistorSymbol,
  LDR: LdrSymbol,
  XTAL: CrystalSymbol,
  CMMC: CmmcSymbol,
  FBEAD: FerriteBeadSymbol,
  ANT: AntennaSymbol,
  SPST: SpstSymbol,
  SPDT: SpdtSymbol,
  PB: PushButtonSymbol,
  AND: AndGateSymbol,
  OR: OrGateSymbol,
  NAND: NandGateSymbol,
  NOR: NorGateSymbol,
  XOR: XorGateSymbol,
  XNOR: XnorGateSymbol,
  NOT: NotGateSymbol,
  SRFF: SrFfSymbol,
  JKFF: JkFfSymbol,
  TFF: TFfSymbol,
  DFF: DFfSymbol,
  NMOS: NmosSymbol,
  PMOS: PmosSymbol,
  NMOS_D: NmosDepSymbol,
  PMOS_D: PmosDepSymbol,
  NJFET: NjfetSymbol,
  PJFET: PjfetSymbol,
  NPN: NpnSymbol,
  PNP: PnpSymbol,
  UJT: UjtSymbol,
  SICMOS: SicMosSymbol,
  SICMOS_K: SicMosKelvinSymbol,
  GANHEMT: GanHemtSymbol,
  IGBT: IgbtSymbol,
  IGBT_K: IgbtKelvinSymbol,
  SCR: ScrSymbol,
  SCS: ScsSymbol,
  TRIAC: TriacSymbol,
  DIAC: DiacSymbol,
  GTO: GtoSymbol,
  SCR_PH: PhotoScrSymbol,
  SIDAC: SidacSymbol,
  GATEDRV: GateDrvSymbol,
  COMP: CompSymbol,
  EAMP: OpAmpSymbol,
  OPAMP: BasicOpampSymbol,
  OPAMP5: GeneralOpampSymbol,
  DIFFAMP: DiffAmpSymbol,
  MATH_CONST: MathConstSymbol,
  MATH_SUM: MathSumSymbol,
  MATH_PROD: MathProdSymbol,
  MATH_GAIN: MathGainSymbol,
  MATH_REL: MathRelSymbol,
  MATH_LOGIC: MathLogicSymbol,
  CSENSE: CsenseSymbol,
  VSENSE: VsenseSymbol,
  IPROBE: IprobeSymbol,
  VPROBE: VprobeSymbol,
  NODE: NodeSymbol,
  WIRELABEL: WireLabelSymbol,
};

export function SchematicSymbol({
  kind,
  selected,
  rotation = 0,
  preview = false,
  params,
}: {
  kind: ComponentKind;
  selected?: boolean;
  rotation?: number;
  /** Palette miniature — keep aspect ratio, ignore layout stretch. */
  preview?: boolean;
  params?: Record<string, string>;
}) {
  const Comp = MAP[kind];
  if (!Comp) return null;
  return (
    <SymbolPreviewCtx.Provider value={preview}>
      <Comp selected={selected} rotation={rotation} params={params} />
    </SymbolPreviewCtx.Provider>
  );
}
