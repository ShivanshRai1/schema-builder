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

function CapacitorSymbol({ selected }: SymProps) {
  return (
    <SymbolSvg kind="C" w={48} h={24}>
      <g
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
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
        <path d="M20 0 V16" />
        <path d="M20 16 V40" />
        <path d="M20 40 V56" />
        <path d="M0 28 H12" />
        <path d="M12 16 V40" />
        <path d="M16 16 H20" />
        <path d="M16 28 H20" />
        <path d="M16 40 H20" />
        <path d="M20 40 L16 34 M20 40 L24 34" />
      </g>
    </SymbolSvg>
  );
}

function PmosSymbol({ selected }: SymProps) {
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
        <path d="M20 0 V16" />
        <path d="M20 16 V40" />
        <path d="M20 40 V56" />
        <path d="M0 28 H8" />
        <circle cx="10" cy="28" r="3.5" />
        <path d="M13.5 28 H12" />
        <path d="M12 16 V40" />
        <path d="M16 16 H20" />
        <path d="M16 28 H20" />
        <path d="M16 40 H20" />
        <path d="M20 16 L16 10 M20 16 L24 10" />
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

const MAP: Partial<Record<ComponentKind, (p: SymProps) => JSX.Element>> = {
  R: ResistorSymbol,
  C: CapacitorSymbol,
  L: InductorSymbol,
  V: VoltageSymbol,
  GND: GroundSymbol,
  D: DiodeSymbol,
  I: CurrentSymbol,
  NMOS: NmosSymbol,
  PMOS: PmosSymbol,
  NPN: NpnSymbol,
  PNP: PnpSymbol,
  EAMP: OpAmpSymbol,
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
