import { createContext, useContext, type ReactNode } from "react";
import type { ComponentKind } from "../../model/types";
import { getSymbolLayout } from "./layout";

const STROKE = "var(--symbol-stroke, #5eb0ff)";
const SW = 1.6;
/** LTspice-like strokes: butt caps + miter joins — no gaps at vertices or past pins. */
const STROKE_BUTT = {
  fill: "none" as const,
  stroke: STROKE,
  strokeWidth: SW,
  strokeLinecap: "butt" as const,
  strokeLinejoin: "miter" as const,
};

const SymbolPreviewCtx = createContext(false);

type SymProps = { selected?: boolean; rotation?: number };

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

function ScrSymbol({ selected }: SymProps) {
  const cy = 32;
  const bx = 28;
  const ax = 54;
  return (
    <SymbolSvg kind="SCR" w={96} h={64}>
      <g {...STROKE_BUTT} opacity={selected ? 1 : 0.92}>
        <path d={`M0 ${cy} H${bx}`} />
        <path d={`M${bx} ${cy - 14} L${ax} ${cy} L${bx} ${cy + 14} Z`} />
        <path d={`M${ax} ${cy - 14} V${cy + 14}`} />
        <path d={`M${ax} ${cy} H96`} />
        <path d={`M${ax} ${cy + 5} L64 ${cy + 22} V64`} />
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
  V: VoltageSymbol,
  GND: GroundSymbol,
  D: DiodeSymbol,
  DZ: ZenerDiodeSymbol,
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
  WIRELABEL: WireLabelSymbol,
};

export function SchematicSymbol({
  kind,
  selected,
  rotation = 0,
  preview = false,
}: {
  kind: ComponentKind;
  selected?: boolean;
  rotation?: number;
  /** Palette miniature — keep aspect ratio, ignore layout stretch. */
  preview?: boolean;
}) {
  const Comp = MAP[kind];
  if (!Comp) return null;
  return (
    <SymbolPreviewCtx.Provider value={preview}>
      <Comp selected={selected} rotation={rotation} />
    </SymbolPreviewCtx.Provider>
  );
}
