import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  ReactFlow,
  Background,
  ConnectionMode,
  useViewport,
  ViewportPortal,
  type Node,
  type Edge,
  type EdgeProps,
  type OnNodesChange,
  type OnEdgesChange,
  type ReactFlowInstance,
  type NodeProps,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ComponentNode } from "../nodes/ComponentNode";
import type { ComponentData, ComponentKind, ComponentRotation } from "../model/types";
import { isPaletteDrag, PALETTE_DND_MIME } from "../dnd";
import { COMPONENT_SPECS, getComponentPins } from "../model/componentSpecs";
import { extractNets } from "../netlist/nets";
import {
  currentThrough,
  formatProbeValue,
  voltageAtNet,
} from "../sim/probeHover";
import { useSimResult } from "../sim/SimResultContext";
import {
  SchematicWireEdge,
  type SchematicWireData,
  type SchematicWireEdgeType,
} from "../edges/SchematicWireEdge";
import {
  dist,
  isAxisAligned,
  pointsEqual,
  polylinePath,
  previewCornerToPin,
  projectOrthogonalDraw,
  segmentAxis,
  snapPoint,
  waypointsClosingTo,
  WIRE_DRAW_GRID,
  WIRE_GRID,
  WIRE_MIN_SEGMENT,
  type Point,
} from "../wiring/orthogonal";
import { findNearestPin, findNearestPinOnNode, PIN_SNAP_RADIUS, pinWorldPoint, pinWorldSide, stampPositionFromCursor } from "../wiring/pinGeometry";
import {
  computeEdgePolyline,
  closestPointOnPolyline,
  distToPolyline,
  findNearestWireHit,
  hitTestWirePolyline,
  dragWireSegment,
  dragWireCorner,
  polylineToStoredWaypoints,
} from "../wiring/wireGeometry";
import { isShortDanglingStub, isFullyDanglingLeftover } from "../wiring/normalizeWires";
import { resolveBranchOnEdge } from "../wiring/busBranch";
import {
  normalizeRect,
  rectMeaningful,
  type FlowRect,
} from "../wiring/cutMove";
import { translatePoints } from "../wiring/wireMove";
import { SchematicSymbol } from "../nodes/symbols/SchematicSymbols";
import { getSymbolLayout, hasSymbol } from "../nodes/symbols/layout";
import { findWireJunctions, hitTestWireMark, wireMarkKey } from "../wiring/junctions";
import { normalizeRotation, nextLabelRotation, nextRotation } from "../model/rotation";
import {
  clipGroupOrigin,
  type CircuitClipboard,
} from "../model/circuitClipboard";

/** Match Background gap — snap placement and wire corners to this grid. */
export const SCHEMATIC_GRID = WIRE_GRID;

/** Pointer travel (px) before a Move-mode press becomes a drag (vs. a click). */
const MOVE_DRAG_THRESHOLD = 4;

/** Hit radius for ending a draft on an existing wire (incl. under parts). */
const WIRE_JOIN_RADIUS = 16;

/** Ctrl+click (Win/Linux) or ⌘+click (Mac) — toggle item in the selection. */
function isMultiSelectModifier(e: { ctrlKey?: boolean; metaKey?: boolean }): boolean {
  return Boolean(e.ctrlKey || e.metaKey);
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return Boolean(el?.closest?.('input, textarea, select, [contenteditable="true"], .monaco-editor'));
}

function isModV(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && (e.key.toLowerCase() === "v" || e.code === "KeyV");
}

function edgeDeselectChanges(edges: Edge[]) {
  return edges
    .filter((ed) => ed.selected)
    .map((ed) => ({ type: "select" as const, id: ed.id, selected: false }));
}

/** Part click selection — graph-owned, not React Flow's built-in single-select. */
function applyPartSelectClick(
  nodes: Node<ComponentData>[],
  nodeId: string,
  multi: boolean,
  onNodesChange: OnNodesChange<Node<ComponentData>>,
  onEdgesChange: OnEdgesChange,
  edges: Edge[],
) {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node || node.data.kind === "TIP") return;

  if (multi) {
    onNodesChange([{ type: "select", id: nodeId, selected: !node.selected }]);
  } else {
    // Clicking one member of a multi-select keeps the group (for dragging).
    if (node.selected && nodes.some((n) => n.selected && n.id !== nodeId)) return;
    const changes = nodes.flatMap((n) => {
      if (n.id === nodeId) {
        return n.selected ? [] : [{ type: "select" as const, id: n.id, selected: true }];
      }
      return n.selected ? [{ type: "select" as const, id: n.id, selected: false }] : [];
    });
    if (changes.length) onNodesChange(changes);
  }
  const edgeClears = edgeDeselectChanges(edges);
  if (edgeClears.length) onEdgesChange(edgeClears);
}

/** Click/tap tolerance for selecting or deleting thin / short wire segments. */
const WIRE_HIT_RADIUS = 36;

/** Axes (pin / wire columns & rows) to magnetically align a free wire end. */
function collectWireAlignAxes(
  nodes: Node<ComponentData>[],
  edges: Edge[],
): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const n of nodes) {
    if (n.data.kind === "TIP") {
      const p = pinWorldPoint(n, "t");
      if (p) {
        xs.push(p.x);
        ys.push(p.y);
      }
      continue;
    }
    for (const pin of getComponentPins(n.data.kind, n.data.params)) {
      const p = pinWorldPoint(n, pin.id);
      if (!p) continue;
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  for (const e of edges) {
    const poly = computeEdgePolyline(nodes, e);
    for (const p of poly) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  return { xs, ys };
}

/**
 * Free tip squares sit on top of micro stubs and steal pointer events.
 * Prefer the short dangling stub attached to that tip (else any attached edge).
 */
function preferredEdgeForTip(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  tipId: string,
): Edge | null {
  const attached = edges.filter((e) => e.source === tipId || e.target === tipId);
  if (!attached.length) return null;
  const leftover = attached.find(
    (e) =>
      isFullyDanglingLeftover(nodes, edges, e) ||
      isShortDanglingStub(nodes, edges, e, 96),
  );
  return leftover ?? attached[0]!;
}

/** Nearest wire under the cursor (stub-preferred). */
function wireHitAtCursor(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  cursor: Point,
): { edgeId: string; point: Point; dist: number } | null {
  return preferShortStubHit(
    nodes,
    edges,
    cursor,
    findNearestWireHit(nodes, edges, cursor, WIRE_HIT_RADIUS, SCHEMATIC_GRID),
  );
}

/** True when `edge` touches `nodeId` at either end. */
function edgeTouchesNode(edge: Edge, nodeId: string): boolean {
  return edge.source === nodeId || edge.target === nodeId;
}

/** Prefer a dangling leftover / short stub under the cursor when it overlaps a longer rail. */
function preferShortStubHit(
  nodes: Node<ComponentData>[],
  edges: Edge[],
  cursor: Point,
  base: { edgeId: string; point: Point; dist: number } | null,
): { edgeId: string; point: Point; dist: number } | null {
  let bestStub: { edgeId: string; dist: number } | null = null;
  for (const edge of edges) {
    const leftover =
      isFullyDanglingLeftover(nodes, edges, edge) ||
      isShortDanglingStub(nodes, edges, edge, 96);
    if (!leftover) continue;
    const poly = computeEdgePolyline(nodes, edge);
    if (poly.length < 2) continue;
    const d = distToPolyline(poly, cursor);
    if (d > WIRE_HIT_RADIUS + 4) continue;
    if (!bestStub || d < bestStub.dist) bestStub = { edgeId: edge.id, dist: d };
  }
  if (bestStub) {
    return { edgeId: bestStub.edgeId, point: cursor, dist: bestStub.dist };
  }
  return base;
}

/**
 * Must be this close to commit to another pin on the *same* part you started
 * from — otherwise body-hover wrongly snaps V+ → V− while aiming at a rail.
 */
const SAME_PART_PIN_COMMIT = 14;

/** LTspice-style canvas tools. */
export type CanvasMode = "explore" | "wire" | "move" | "drag" | "delete";

/** Zoom / fit / lock API for the top ModeToolbar (replaces bottom-left Controls). */
export type CanvasViewApi = {
  zoomIn: () => void;
  zoomOut: () => void;
  fitView: () => void;
  /** Toggle pan/zoom lock; returns the new locked state. */
  toggleLock: () => boolean;
  isLocked: () => boolean;
};

export type WireCompletePayload = Connection & {
  waypoints: Point[];
  /** Start in empty space (no source pin yet). */
  freeStart?: Point;
};

/** Esc with locked bends — keep the drawn segments ending at `end`. */
export type WirePartialPayload = {
  source?: string;
  sourceHandle?: string;
  freeStart?: Point;
  waypoints: Point[];
  end: Point;
};

type WiringDraft = {
  sourceNodeId: string | null;
  sourceHandle: string | null;
  /** Temporary split inserted when this draft started from an existing wire. */
  branchOriginTipId?: string;
  start: Point;
  waypoints: Point[];
  preview: Point | null;
  /**
   * First-segment preference before any bend is locked.
   * Branch off H bus → "v"; off V bus → "h"; leave a pin along its side.
   */
  axisHint?: "h" | "v" | null;
};

function handleCenter(
  rf: ReactFlowInstance<Node<ComponentData>>,
  nodeId: string,
  handleId: string,
): Point | null {
  const node = rf.getNode(nodeId) as Node<ComponentData> | undefined;
  if (!node) return null;
  // Prefer layout+rotation math so click-wiring matches drawn wires after R.
  const fromLayout = pinWorldPoint(node, handleId);
  if (fromLayout) return fromLayout;

  const internal = rf.getInternalNode(nodeId);
  if (!internal) return null;
  const bounds =
    internal.internals.handleBounds?.source?.find((h) => h.id === handleId) ??
    internal.internals.handleBounds?.target?.find((h) => h.id === handleId);
  if (!bounds) return null;
  const origin = internal.internals.positionAbsolute;
  return {
    x: origin.x + bounds.x + bounds.width / 2,
    y: origin.y + bounds.y + bounds.height / 2,
  };
}

function lastLocked(draft: WiringDraft): Point {
  return draft.waypoints.length
    ? draft.waypoints[draft.waypoints.length - 1]!
    : draft.start;
}

/**
 * First segment only: honor leave-bus / leave-pin axisHint (strong sticky).
 * After a bend is locked, return null so the mouse picks H vs V freely —
 * sticking to the last axis made corners feel stuck (couldn't turn).
 */
function draftPreferAxis(draft: WiringDraft): "h" | "v" | null {
  if (!draft.waypoints.length) return draft.axisHint ?? null;
  return null;
}

/** Axis of the last locked run, if any (for collinear bend extension). */
function draftLastAxis(draft: WiringDraft): "h" | "v" | null {
  if (!draft.waypoints.length) return null;
  const to = draft.waypoints[draft.waypoints.length - 1]!;
  const from =
    draft.waypoints.length >= 2
      ? draft.waypoints[draft.waypoints.length - 2]!
      : draft.start;
  return segmentAxis(from, to);
}

/** Axis of the segment currently being extended (for pin snap preview). */
function draftIncomingAxis(draft: WiringDraft): "h" | "v" | null {
  return draftLastAxis(draft) ?? draft.axisHint ?? null;
}

function sourceExclude(
  draft: WiringDraft,
): { nodeId: string; pinId: string } | undefined {
  if (!draft.sourceNodeId || !draft.sourceHandle) return undefined;
  return { nodeId: draft.sourceNodeId, pinId: draft.sourceHandle };
}

type MarqueeDraft = {
  start: Point;
  end: Point;
};

/** Snipping-tool rectangle in flow coords. */
function CutMarqueeOverlay({ rect }: { rect: FlowRect | null }) {
  const { x, y, zoom } = useViewport();
  if (!rect || !rectMeaningful(rect, 1)) return null;
  return (
    <svg
      className="cut-marquee-overlay"
      width="100%"
      height="100%"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "visible",
        pointerEvents: "none",
        zIndex: 4,
        transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        transformOrigin: "0 0",
      }}
    >
      <rect
        className="cut-marquee-rect"
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
      />
    </svg>
  );
}

/** Ghost part that follows the cursor while the stamp tool is active. */
function PlaceGhostOverlay({
  kind,
  position,
  rotation,
  ghostName,
}: {
  kind: ComponentKind;
  position: Point | null;
  rotation: number;
  ghostName?: string;
}) {
  if (!position) return null;
  const layout = getSymbolLayout(kind, rotation) ?? { w: 92, h: 54 };
  const label = COMPONENT_SPECS[kind]?.label ?? kind;
  const wireName = kind === "WIRELABEL" ? (ghostName || "") : null;
  return (
    <ViewportPortal>
      <div
        className={`place-ghost${wireName !== null ? " place-ghost-wirelabel" : ""}`}
        style={{
          position: "absolute",
          left: position.x,
          top: position.y,
          width: layout.w,
          height: layout.h,
          pointerEvents: "none",
          zIndex: 8,
        }}
        aria-hidden
      >
        {wireName !== null ? (
          <div
            className="wire-label-spin"
            style={{ transform: `rotate(${rotation}deg)` }}
          >
            <div className="wire-label-text">{wireName || "…"}</div>
          </div>
        ) : hasSymbol(kind) ? (
          <div
            className="symbol-body"
            style={{
              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            }}
          >
            <SchematicSymbol kind={kind} selected={false} rotation={rotation} />
          </div>
        ) : (
          <div className="place-ghost-card">{label}</div>
        )}
      </div>
    </ViewportPortal>
  );
}

/** Ghost of a copied selection — follows the cursor until click-to-stamp. */
function PasteGhostOverlay({
  clip,
  origin,
}: {
  clip: CircuitClipboard;
  origin: Point | null;
}) {
  if (!origin) return null;
  const base = clipGroupOrigin(clip.nodes);
  const dx = origin.x - base.x;
  const dy = origin.y - base.y;
  const ghostNodes = clip.nodes.map((n) => ({
    ...n,
    position: { x: n.position.x + dx, y: n.position.y + dy },
  }));
  const wirePaths = clip.edges
    .map((e) => computeEdgePolyline(ghostNodes, e))
    .filter((pts) => pts.length >= 2)
    .map((pts) => polylinePath(pts));
  return (
    <ViewportPortal>
      <div className="place-ghost paste-ghost" aria-hidden>
        <svg
          className="paste-ghost-wires"
          width={1}
          height={1}
          overflow="visible"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            overflow: "visible",
            pointerEvents: "none",
          }}
        >
          {wirePaths.map((d, i) => (
            <path key={i} d={d} fill="none" />
          ))}
        </svg>
        {ghostNodes.map((n) => {
          if (n.data.kind === "TIP") {
            return (
              <div
                key={n.id}
                className="paste-ghost-tip"
                style={{ left: n.position.x, top: n.position.y }}
              />
            );
          }
          const rot = normalizeRotation(n.data.rotation);
          const layout = getSymbolLayout(n.data.kind, rot) ?? { w: 92, h: 54 };
          const label = COMPONENT_SPECS[n.data.kind]?.label ?? n.data.kind;
          return (
            <div
              key={n.id}
              className="paste-ghost-part"
              style={{
                left: n.position.x,
                top: n.position.y,
                width: layout.w,
                height: layout.h,
              }}
            >
              {hasSymbol(n.data.kind) ? (
                <div
                  className="symbol-body"
                  style={{
                    transform: `translate(-50%, -50%) rotate(${rot}deg)`,
                  }}
                >
                  <SchematicSymbol kind={n.data.kind} selected={false} rotation={rot} />
                </div>
              ) : (
                <div className="place-ghost-card">{label}</div>
              )}
            </div>
          );
        })}
      </div>
    </ViewportPortal>
  );
}
/** Draft polyline lives in flow coords; transform with the viewport.
 * Rubber band is updated via DOM (no React re-render per mousemove). */
function WireDraftOverlay({
  lockedPath,
  rubberRef,
  snapDotRef,
  anchor,
}: {
  lockedPath: string;
  rubberRef: { current: SVGPathElement | null };
  snapDotRef: { current: SVGCircleElement | null };
  anchor: Point | null;
}) {
  return (
    <ViewportPortal>
      <svg
        className="wire-draft-overlay"
        width={1}
        height={1}
        overflow="visible"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          overflow: "visible",
          pointerEvents: "none",
          zIndex: 6,
        }}
      >
        {lockedPath ? (
          <path className="wire-draft-locked" d={lockedPath} fill="none" />
        ) : null}
        <path
          ref={(el) => {
            rubberRef.current = el;
          }}
          className="wire-draft-rubber"
          d=""
          fill="none"
        />
        {anchor ? (
          <circle className="wire-draft-anchor" r={4} cx={anchor.x} cy={anchor.y} />
        ) : null}
        <circle
          ref={(el) => {
            snapDotRef.current = el;
          }}
          className="wire-draft-snap-dot"
          r={4}
          cx={0}
          cy={0}
          visibility="hidden"
        />
      </svg>
    </ViewportPortal>
  );
}

function JunctionOverlay({
  junctions,
  crossings,
  interactive,
}: {
  junctions: { x: number; y: number }[];
  crossings: { x: number; y: number; hop?: "h" | "v" }[];
  /** Delete mode: marks receive hits (junction / hop). */
  interactive?: boolean;
}) {
  if (!junctions.length && !crossings.length) return null;
  const hopR = 5.5;
  return (
    <ViewportPortal>
      <svg
        className={`junction-overlay${interactive ? " junction-overlay-interactive" : ""}`}
        width={1}
        height={1}
        overflow="visible"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          overflow: "visible",
          pointerEvents: interactive ? "auto" : "none",
          zIndex: 5,
        }}
      >
        {junctions.map((p) => (
          <rect
            key={`j-${p.x},${p.y}`}
            className="wire-junction"
            data-wire-mark="junction"
            x={p.x - 4.5}
            y={p.y - 4.5}
            width={9}
            height={9}
            style={interactive ? { pointerEvents: "all", cursor: "inherit" } : undefined}
          />
        ))}
        {crossings.map((p) => {
          const hop = p.hop ?? "h";
          const r = hopR;
          // Closed semicircle (fill masks the +); open arc is the hop stroke.
          const bump =
            hop === "h"
              ? `M ${p.x - r} ${p.y} A ${r} ${r} 0 0 1 ${p.x + r} ${p.y}`
              : `M ${p.x} ${p.y - r} A ${r} ${r} 0 0 1 ${p.x} ${p.y + r}`;
          const erase =
            hop === "h"
              ? `M ${p.x - r} ${p.y} A ${r} ${r} 0 0 1 ${p.x + r} ${p.y} Z`
              : `M ${p.x} ${p.y - r} A ${r} ${r} 0 0 1 ${p.x} ${p.y + r} Z`;
          const gap =
            hop === "h"
              ? {
                  x: p.x - r,
                  y: p.y - 2.2,
                  width: r * 2,
                  height: 4.4,
                }
              : {
                  x: p.x - 2.2,
                  y: p.y - r,
                  width: 4.4,
                  height: r * 2,
                };
          return (
            <g key={`c-${p.x},${p.y}`} data-wire-mark="crossing">
              {/* Hide straight wire through the hop region */}
              <rect className="wire-crossing-gap" {...gap} />
              <path className="wire-crossing-gap" d={erase} />
              <path
                className="wire-crossing"
                d={bump}
                fill="none"
                style={interactive ? { pointerEvents: "stroke", cursor: "inherit" } : undefined}
              />
              {interactive && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r + 3}
                  fill="transparent"
                  style={{ pointerEvents: "all", cursor: "inherit" }}
                />
              )}
            </g>
          );
        })}
      </svg>
    </ViewportPortal>
  );
}

/** Public Canvas props (named so JSX typings stay in sync with App). */
export type CanvasProps = {
  nodes: Node<ComponentData>[];
  edges: Edge[];
  mode: CanvasMode;
  onModeChange: (mode: CanvasMode) => void;
  /** Active palette stamp tool (null = not placing). */
  placeKind: ComponentKind | null;
  /** Net name shown on the Wire label ghost while stamping. */
  placeGhostName?: string;
  /** Copied selection waiting to be stamped with a ghost (null = not pasting). */
  pasteClip: CircuitClipboard | null;
  /** Ctrl+C copy-marquee tool active. */
  copyMarquee?: boolean;
  /** Finish copy-marquee drag: highlight nodes/wires ≥70% inside (Ctrl = additive). */
  onCopyRegion?: (rect: FlowRect, additive: boolean) => void;
  onCancelCopyMarquee?: () => void;
  /** Copy-mode wire click — exclusive or Ctrl-toggle. */
  onToggleSelectEdge?: (edgeId: string, multi: boolean) => void;
  /** Copy-mode: plain click a part → copy + paste ghost immediately. */
  onCopyPartImmediate?: (nodeId: string) => void;
  /** Copy-mode: plain click a wire → copy + paste ghost immediately. */
  onCopyEdgeImmediate?: (edgeId: string) => void;
  onPlaceAt: (kind: ComponentKind, x: number, y: number, rotation?: ComponentRotation) => void;
  onPasteAt: (origin: Point) => void;
  /** Ctrl+V — origin is the ghost/cursor, or null to only re-enter paste mode. */
  onPasteShortcut: (origin: Point | null) => void;
  onRotatePasteClip: () => void;
  onCancelPlace: () => void;
  onNodesChange: OnNodesChange<Node<ComponentData>>;
  onEdgesChange: OnEdgesChange;
  onWire: (payload: WireCompletePayload) => void;
  onWirePartial: (payload: WirePartialPayload) => void;
  onTrimWire: () => boolean;
  onWirePathUpdate: (edgeId: string, waypoints: Point[]) => void;
  onMoveWireDisconnect: (
    edgeId: string,
    opts?: { fromIndex: number; toIndex: number },
  ) => {
    moveIds: string[];
    origins: { id: string; x: number; y: number }[];
    edgeId: string;
    baseWaypoints: Point[];
    cutCount: number;
  } | null;
  /** One undo checkpoint before a live wire-geometry edit. */
  onPushHistory: () => void;
  onReplace: (nodeId: string, kind: ComponentKind) => void;
  onAddAt: (kind: ComponentKind, x: number, y: number) => void;
  onCutMoveRegion: (rect: FlowRect) => void;
  /** Box-select parts in a rectangle; additive when Ctrl/⌘ is held. */
  onSelectRegion: (rect: FlowRect, additive: boolean) => void;
  /** Split edge at point; returns new TIP id. Optional pre-extended graph. */
  onWireBranch: (
    edgeId: string,
    branchPoint: Point,
    graph?: { nodes: Node<ComponentData>[]; edges: Edge[] },
  ) => string | null;
  /** Undo a temporary edge split when its branch draft is cancelled. */
  onCancelWireBranch: (tipId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string, clickPoint?: Point) => void;
  /** Delete-mode: break a filled junction square or remove a crossing ring's wire. */
  onDeleteWireMark: (
    kind: "junction" | "crossing",
    point: Point,
    meta?: { tipId?: string; edgeIds?: [string, string] },
  ) => void;
  /** Crossing rings the user hid in Delete mode (wires unchanged). */
  hiddenCrossingKeys?: readonly string[];
  onStraightenEdge: (edgeId: string, clickPoint?: Point) => void;
  /** Select exactly one edge; clear all node selection. */
  onSelectEdge: (edgeId: string) => void;
  /** Right-click a real part → open LTspice-style properties dialog. */
  onOpenComponentProps: (nodeId: string, clientX: number, clientY: number) => void;
  onMoveDisconnect: (
    nodeId: string,
    grabPoint?: { x: number; y: number },
    opts?: { additive?: boolean; /** true = Move tool: sever wires, move part alone */ detach?: boolean },
  ) => {
    moveIds: string[];
    origins: { id: string; x: number; y: number }[];
    cutCount: number;
  } | null;
  /** Filled by Canvas so the top toolbar can zoom / fit / lock. */
  viewApiRef?: MutableRefObject<CanvasViewApi | null>;
  /** Light/dark — drives grid dot contrast on the schematic canvas. */
  uiTheme?: "dark" | "light";
};

// The schematic canvas. Custom click wiring (LTspice-style), not drag-auto-route.
export function Canvas({
  nodes,
  edges,
  mode,
  onModeChange,
  placeKind,
  placeGhostName,
  pasteClip,
  copyMarquee = false,
  onCopyRegion,
  onCancelCopyMarquee,
  onToggleSelectEdge,
  onCopyPartImmediate,
  onCopyEdgeImmediate,
  onPlaceAt,
  onPasteAt,
  onPasteShortcut,
  onRotatePasteClip,
  onCancelPlace,
  onNodesChange,
  onEdgesChange,
  onWire,
  onWirePartial,
  onTrimWire,
  onWirePathUpdate,
  onMoveWireDisconnect,
  onPushHistory,
  onReplace,
  onAddAt,
  onCutMoveRegion,
  onSelectRegion,
  onMoveDisconnect,
  onWireBranch,
  onCancelWireBranch,
  onDeleteNode,
  onDeleteEdge,
  onDeleteWireMark,
  hiddenCrossingKeys = [],
  onStraightenEdge,
  onSelectEdge,
  onOpenComponentProps,
  viewApiRef,
  uiTheme = "dark",
}: CanvasProps) {
  const simResult = useSimResult();
  const canvasElRef = useRef<HTMLDivElement | null>(null);
  const rfRef = useRef<ReactFlowInstance<Node<ComponentData>> | null>(null);
  const [viewLocked, setViewLocked] = useState(false);
  const viewLockedRef = useRef(false);
  viewLockedRef.current = viewLocked;
  const replaceHandledRef = useRef(false);
  const wiringRef = useRef<WiringDraft | null>(null);
  const [wiring, setWiring] = useState<WiringDraft | null>(null);
  const rubberPathElRef = useRef<SVGPathElement | null>(null);
  const snapDotElRef = useRef<SVGCircleElement | null>(null);
  const rubberRafRef = useRef<number | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const marqueeRef = useRef<MarqueeDraft | null>(null);
  const [marquee, setMarquee] = useState<MarqueeDraft | null>(null);
  /** Ignore the pane click that follows a box-select mouseup. */
  const skipPaneClickRef = useRef(false);
  const [, setMoveHint] = useState<string | null>(null);
  const [probeTip, setProbeTip] = useState<{
    x: number;
    y: number;
    lines: string[];
  } | null>(null);
  const probesLive =
    Boolean(simResult?.ok && simResult.series.length) &&
    !placeKind &&
    !pasteClip &&
    !wiring;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const placeKindRef = useRef(placeKind);
  placeKindRef.current = placeKind;
  const pasteClipRef = useRef(pasteClip);
  pasteClipRef.current = pasteClip;
  const copyMarqueeRef = useRef(copyMarquee);
  copyMarqueeRef.current = copyMarquee;
  const placingRef = useRef(false);
  placingRef.current = Boolean(placeKind || pasteClip);
  const [placeGhost, setPlaceGhost] = useState<Point | null>(null);
  const placeGhostRef = useRef<Point | null>(null);
  placeGhostRef.current = placeGhost;
  const lastFlowRef = useRef<Point | null>(null);
  const [ghostRotation, setGhostRotation] = useState<ComponentRotation>(0);
  const ghostRotationRef = useRef<ComponentRotation>(0);
  ghostRotationRef.current = ghostRotation;

  useEffect(() => {
    if (!viewApiRef) return;
    viewApiRef.current = {
      zoomIn: () => {
        void rfRef.current?.zoomIn?.({ duration: 200 });
      },
      zoomOut: () => {
        void rfRef.current?.zoomOut?.({ duration: 200 });
      },
      fitView: () => {
        void rfRef.current?.fitView({ padding: 0.2, duration: 200 });
      },
      toggleLock: () => {
        const next = !viewLockedRef.current;
        viewLockedRef.current = next;
        setViewLocked(next);
        return next;
      },
      isLocked: () => viewLockedRef.current,
    };
    return () => {
      viewApiRef.current = null;
    };
  }, [viewApiRef]);

  type MoveDrag = {
    startFlow: Point;
    origins: { id: string; x: number; y: number }[];
    /** When set, this is a whole-wire cut/move (translate tips + waypoints). */
    wirePath?: { edgeId: string; baseWaypoints: Point[] };
    /** Move tool: part was severed — don't magnet-snap mid-wire while dragging. */
    detach?: boolean;
  };
  const moveDragRef = useRef<MoveDrag | null>(null);

  const onReplaceRef = useRef(onReplace);
  const onWireRef = useRef(onWire);
  const onWirePartialRef = useRef(onWirePartial);
  const onTrimWireRef = useRef(onTrimWire);
  const onWirePathUpdateRef = useRef(onWirePathUpdate);
  const onMoveWireDisconnectRef = useRef(onMoveWireDisconnect);
  const onPushHistoryRef = useRef(onPushHistory);
  const onModeChangeRef = useRef(onModeChange);
  const onCutMoveRef = useRef(onCutMoveRegion);
  const onSelectRegionRef = useRef(onSelectRegion);
  const onCopyRegionRef = useRef(onCopyRegion);
  onCopyRegionRef.current = onCopyRegion;
  const onCancelCopyMarqueeRef = useRef(onCancelCopyMarquee);
  onCancelCopyMarqueeRef.current = onCancelCopyMarquee;
  const onToggleSelectEdgeRef = useRef(onToggleSelectEdge);
  onToggleSelectEdgeRef.current = onToggleSelectEdge;
  const onCopyPartImmediateRef = useRef(onCopyPartImmediate);
  onCopyPartImmediateRef.current = onCopyPartImmediate;
  const onCopyEdgeImmediateRef = useRef(onCopyEdgeImmediate);
  onCopyEdgeImmediateRef.current = onCopyEdgeImmediate;
  const onMoveDisconnectRef = useRef(onMoveDisconnect);
  const onNodesChangeRef = useRef(onNodesChange);
  const onEdgesChangeRef = useRef(onEdgesChange);
  const onWireBranchRef = useRef(onWireBranch);
  onWireBranchRef.current = onWireBranch;
  const onCancelWireBranchRef = useRef(onCancelWireBranch);
  onCancelWireBranchRef.current = onCancelWireBranch;
  const onDeleteNodeRef = useRef(onDeleteNode);
  onDeleteNodeRef.current = onDeleteNode;
  const onDeleteEdgeRef = useRef(onDeleteEdge);
  onDeleteEdgeRef.current = onDeleteEdge;
  const onDeleteWireMarkRef = useRef(onDeleteWireMark);
  onDeleteWireMarkRef.current = onDeleteWireMark;
  const hiddenCrossingRef = useRef(hiddenCrossingKeys);
  hiddenCrossingRef.current = hiddenCrossingKeys;
  const onStraightenEdgeRef = useRef(onStraightenEdge);
  onStraightenEdgeRef.current = onStraightenEdge;
  const onSelectEdgeRef = useRef(onSelectEdge);
  onSelectEdgeRef.current = onSelectEdge;
  const onPlaceAtRef = useRef(onPlaceAt);
  onPlaceAtRef.current = onPlaceAt;
  const onPasteAtRef = useRef(onPasteAt);
  onPasteAtRef.current = onPasteAt;
  const onPasteShortcutRef = useRef(onPasteShortcut);
  onPasteShortcutRef.current = onPasteShortcut;
  const onRotatePasteClipRef = useRef(onRotatePasteClip);
  onRotatePasteClipRef.current = onRotatePasteClip;
  const onCancelPlaceRef = useRef(onCancelPlace);
  onCancelPlaceRef.current = onCancelPlace;
  const onOpenComponentPropsRef = useRef(onOpenComponentProps);
  onOpenComponentPropsRef.current = onOpenComponentProps;
  onReplaceRef.current = onReplace;
  onWireRef.current = onWire;
  onWirePartialRef.current = onWirePartial;
  onTrimWireRef.current = onTrimWire;
  onWirePathUpdateRef.current = onWirePathUpdate;
  onMoveWireDisconnectRef.current = onMoveWireDisconnect;
  onPushHistoryRef.current = onPushHistory;
  onModeChangeRef.current = onModeChange;
  onCutMoveRef.current = onCutMoveRegion;
  onSelectRegionRef.current = onSelectRegion;
  onMoveDisconnectRef.current = onMoveDisconnect;
  onNodesChangeRef.current = onNodesChange;
  onEdgesChangeRef.current = onEdgesChange;

  const clearRubberDom = useCallback(() => {
    if (rubberRafRef.current != null) {
      cancelAnimationFrame(rubberRafRef.current);
      rubberRafRef.current = null;
    }
    const path = rubberPathElRef.current;
    if (path) {
      path.setAttribute("d", "");
      path.classList.remove("snapping");
    }
    const dot = snapDotElRef.current;
    if (dot) dot.setAttribute("visibility", "hidden");
    const root = canvasElRef.current;
    if (root) {
      root.querySelectorAll(".pin-snap-hot").forEach((el) => el.classList.remove("pin-snap-hot"));
    }
  }, []);

  const paintRubber = useCallback((from: Point, to: Point, snapping: boolean) => {
    const path = rubberPathElRef.current;
    if (!path) return;
    if (pointsEqual(from, to)) {
      path.setAttribute("d", "");
      path.classList.remove("snapping");
    } else {
      path.setAttribute("d", polylinePath([from, to]));
      path.classList.toggle("snapping", snapping);
    }
    const dot = snapDotElRef.current;
    if (dot) {
      if (snapping) {
        dot.setAttribute("cx", String(to.x));
        dot.setAttribute("cy", String(to.y));
        dot.setAttribute("visibility", "visible");
      } else {
        dot.setAttribute("visibility", "hidden");
      }
    }
  }, []);

  const finishOrKeepPartial = useCallback(() => {
    const draft = wiringRef.current;
    if (!draft) return;
    // Left clicks are the committed anchors. The mouse-following preview is
    // deliberately excluded: right-click stops drawing and discards only that
    // current blue segment.
    const pts = draft.waypoints;
    if (pts.length > 0) {
      onWirePartialRef.current({
        source: draft.sourceNodeId ?? undefined,
        sourceHandle: draft.sourceHandle ?? undefined,
        freeStart: draft.sourceNodeId ? undefined : draft.start,
        waypoints: pts.slice(0, -1),
        end: pts[pts.length - 1]!,
      });
    } else if (draft.branchOriginTipId) {
      // A click on a wire splits it immediately so the rubber-band has a real
      // source. If no segment was drawn, put the original wire back.
      onCancelWireBranchRef.current(draft.branchOriginTipId);
    }
    wiringRef.current = null;
    setWiring(null);
    clearRubberDom();
  }, [clearRubberDom]);

  const cancelWiringDraft = useCallback(() => {
    const draft = wiringRef.current;
    if (draft?.branchOriginTipId) {
      onCancelWireBranchRef.current(draft.branchOriginTipId);
    }
    wiringRef.current = null;
    setWiring(null);
    clearRubberDom();
  }, [clearRubberDom]);

  /** Complete or cancel draft against a pin (Handle click or magnetic snap). */
  const applyPinHit = useCallback(
    (nodeId: string, pinId: string) => {
      if (modeRef.current !== "wire") return;
      const rf = rfRef.current;
      if (!rf) return;

      let hitNodeId = nodeId;
      let hitPinId = pinId;

      // While finishing a draft: tip parked on a real pin steals the click —
      // connect to that pin. When starting (no draft), keep the tip so we extend.
      const draft = wiringRef.current;
      if (draft) {
        const hitNode = nodesRef.current.find((n) => n.id === hitNodeId);
        if (hitNode?.data.kind === "TIP") {
          const tipPt =
            pinWorldPoint(hitNode, "t") ??
            handleCenter(rf, hitNodeId, hitPinId);
          if (tipPt) {
            const under = findNearestPin(nodesRef.current, tipPt, {
              maxDist: PIN_SNAP_RADIUS,
              exclude: { nodeId: hitNodeId, pinId: "t" },
            });
            const underNode = under
              ? nodesRef.current.find((n) => n.id === under.nodeId)
              : null;
            if (
              under &&
              underNode &&
              underNode.data.kind !== "TIP" &&
              !(
                draft.sourceNodeId === under.nodeId &&
                draft.sourceHandle === under.pinId
              )
            ) {
              hitNodeId = under.nodeId;
              hitPinId = under.pinId;
            }
          }
        }
      }

      const center = handleCenter(rf, hitNodeId, hitPinId);
      if (!center) return;

      if (!draft) {
        const node = nodesRef.current.find((n) => n.id === hitNodeId);
        const side =
          node && node.data.kind !== "TIP"
            ? pinWorldSide(node, hitPinId)
            : null;
        // Leave a pin along its outward axis first (LTspice-like).
        const axisHint =
          side === "top" || side === "bottom"
            ? ("v" as const)
            : side === "left" || side === "right"
              ? ("h" as const)
              : null;
        wiringRef.current = {
          sourceNodeId: hitNodeId,
          sourceHandle: hitPinId,
          start: center,
          waypoints: [],
          preview: null,
          axisHint,
        };
        setWiring(wiringRef.current);
        clearRubberDom();
        return;
      }

      if (draft.sourceNodeId === hitNodeId && draft.sourceHandle === hitPinId) {
        if (draft.waypoints.length > 0) {
          onWirePartialRef.current({
            source: draft.sourceNodeId ?? undefined,
            sourceHandle: draft.sourceHandle ?? undefined,
            freeStart: draft.sourceNodeId ? undefined : draft.start,
            waypoints: draft.waypoints.slice(0, -1),
            end: draft.waypoints[draft.waypoints.length - 1]!,
          });
        }
        wiringRef.current = null;
        setWiring(null);
        clearRubberDom();
        return;
      }

      onWireRef.current({
        source: draft.sourceNodeId ?? "",
        sourceHandle: draft.sourceHandle ?? "",
        target: hitNodeId,
        targetHandle: hitPinId,
        waypoints: waypointsClosingTo(
          lastLocked(draft),
          center,
          draft.waypoints,
          draftIncomingAxis(draft),
        ),
        freeStart: draft.sourceNodeId ? undefined : draft.start,
      });
      wiringRef.current = null;
      setWiring(null);
      clearRubberDom();
    },
    [clearRubberDom],
  );

  /** Split `edgeId` at branch point and complete the current draft onto that tip. */
  const finishDraftOnWire = useCallback(
    (edgeId: string, branchPt: Point): boolean => {
      const draft = wiringRef.current;
      if (!draft) return false;

      // Prefer column/row attach on the target bus (clean ladder end).
      const resolved = resolveBranchOnEdge(
        nodesRef.current,
        edgesRef.current,
        edgeId,
        branchPt,
        SCHEMATIC_GRID,
      );
      const tipId = resolved
        ? onWireBranchRef.current(resolved.edgeId, resolved.point, {
            nodes: resolved.nodes,
            edges: resolved.edges,
          })
        : onWireBranchRef.current(edgeId, branchPt);
      if (!tipId) return false;
      const endPt = resolved?.point ?? branchPt;
      onWireRef.current({
        source: draft.sourceNodeId ?? "",
        sourceHandle: draft.sourceHandle ?? "",
        target: tipId,
        targetHandle: "t",
        waypoints: waypointsClosingTo(
          lastLocked(draft),
          endPt,
          draft.waypoints,
          draftIncomingAxis(draft),
        ),
        freeStart: draft.sourceNodeId ? undefined : draft.start,
      });
      wiringRef.current = null;
      setWiring(null);
      clearRubberDom();
      return true;
    },
    [clearRubberDom],
  );

  /** If cursor is near a pin or wire, finish the draft there. */
  const tryMagneticComplete = useCallback(
    (cursor: Point, hoverNode?: Node<ComponentData> | null): boolean => {
      const draft = wiringRef.current;
      if (!draft) return false;
      const exclude = sourceExclude(draft);
      const from = lastLocked(draft);
      // WYSIWYG: never finish off-axis from a body hover — that made the
      // rubber-band miss the pin while the click still snapped a connection.
      // Explicit pin-handle clicks still go through applyPinHit directly.

      // Prefer joining an existing wire when it's as close as any pin — rails
      // under parts would otherwise never receive the click (node steals it).
      const wireHit = findNearestWireHit(
        nodesRef.current,
        edgesRef.current,
        cursor,
        WIRE_JOIN_RADIUS,
        SCHEMATIC_GRID,
      );
      let pinHit =
        hoverNode && hoverNode.data.kind !== "TIP"
          ? findNearestPinOnNode(hoverNode, cursor, { exclude })
          : findNearestPin(nodesRef.current, cursor, {
              maxDist: PIN_SNAP_RADIUS,
              exclude,
            });

      // Same-part other pin (V+ → V−): only if cursor is right on it.
      if (
        pinHit &&
        draft.sourceNodeId &&
        pinHit.nodeId === draft.sourceNodeId &&
        pinHit.pinId !== draft.sourceHandle
      ) {
        if (dist(cursor, pinHit.point) > SAME_PART_PIN_COMMIT) pinHit = null;
      }

      if (wireHit && (!pinHit || wireHit.dist <= dist(cursor, pinHit.point) - 2)) {
        if (!isAxisAligned(from, wireHit.point)) return false;
        return finishDraftOnWire(wireHit.edgeId, cursor);
      }

      // Tip nodes sit on pins and steal clicks — prefer a real pin nearby.
      if (hoverNode?.data.kind === "TIP") {
        const tipPt = pinWorldPoint(hoverNode, "t") ?? cursor;
        const under = findNearestPin(nodesRef.current, tipPt, {
          maxDist: PIN_SNAP_RADIUS,
          exclude: { nodeId: hoverNode.id, pinId: "t" },
        });
        const underOk =
          under &&
          !(
            exclude &&
            under.nodeId === exclude.nodeId &&
            under.pinId === exclude.pinId
          ) &&
          nodesRef.current.find((n) => n.id === under.nodeId)?.data.kind !== "TIP";
        if (underOk && under) {
          if (!isAxisAligned(from, under.point)) return false;
          applyPinHit(under.nodeId, under.pinId);
          return true;
        }
        if (!isAxisAligned(from, tipPt)) return false;
        applyPinHit(hoverNode.id, "t");
        return true;
      }

      if (!pinHit) return false;
      if (!isAxisAligned(from, pinHit.point)) return false;
      applyPinHit(pinHit.nodeId, pinHit.pinId);
      return true;
    },
    [applyPinHit, finishDraftOnWire],
  );

  const setSnapHotPin = useCallback((hit: { nodeId: string; pinId: string } | null) => {
    const root = canvasElRef.current;
    if (!root) return;
    root.querySelectorAll(".pin-snap-hot").forEach((el) => el.classList.remove("pin-snap-hot"));
    if (!hit) return;
    const nodeEl = root.querySelector(`.react-flow__node[data-id="${CSS.escape(hit.nodeId)}"]`);
    const pin = nodeEl?.querySelector(`[data-handleid="${CSS.escape(hit.pinId)}"]`);
    pin?.classList.add("pin-snap-hot");
  }, []);

  const updateDraftPreview = useCallback(
    (clientX: number, clientY: number, hoverNode?: Node<ComponentData> | null) => {
      const draft = wiringRef.current;
      const rf = rfRef.current;
      if (!draft || !rf) return;
      const cursor = rf.screenToFlowPosition({ x: clientX, y: clientY });
      const from = lastLocked(draft);
      const prefer = draftPreferAxis(draft);
      const exclude = sourceExclude(draft);
      const alignAxes = collectWireAlignAxes(nodesRef.current, edgesRef.current);

      const wireHit = findNearestWireHit(
        nodesRef.current,
        edgesRef.current,
        cursor,
        WIRE_JOIN_RADIUS,
        WIRE_DRAW_GRID,
        draft.branchOriginTipId && draft.waypoints.length === 0
          ? new Set(
              edgesRef.current
                .filter(
                  (e) =>
                    e.source === draft.branchOriginTipId ||
                    e.target === draft.branchOriginTipId,
                )
                .map((e) => e.id),
            )
          : undefined,
      );

      let hit =
        hoverNode && hoverNode.data.kind !== "TIP"
          ? findNearestPinOnNode(hoverNode, cursor, { exclude })
          : findNearestPin(nodesRef.current, cursor, {
              maxDist: PIN_SNAP_RADIUS,
              exclude,
            });

      // Don't advertise V− while drawing from V+ across the body toward a rail.
      if (
        hit &&
        draft.sourceNodeId &&
        hit.nodeId === draft.sourceNodeId &&
        hit.pinId !== draft.sourceHandle
      ) {
        if (dist(cursor, hit.point) > SAME_PART_PIN_COMMIT) hit = null;
      }

      const preferWire =
        wireHit && (!hit || wireHit.dist <= dist(cursor, hit.point) - 2);

      if (rubberRafRef.current != null) cancelAnimationFrame(rubberRafRef.current);

      // Step-draw WYSIWYG: same fine-grid + axis align as a lock click.
      if (preferWire && wireHit && isAxisAligned(from, wireHit.point)) {
        setSnapHotPin(null);
        const target = wireHit.point;
        draft.preview = target;
        wiringRef.current = draft;
        rubberRafRef.current = requestAnimationFrame(() => {
          rubberRafRef.current = null;
          paintRubber(from, target, true);
        });
        return;
      }

      if (hit && isAxisAligned(from, hit.point)) {
        setSnapHotPin(hit);
        draft.preview = hit.point;
        wiringRef.current = draft;
        rubberRafRef.current = requestAnimationFrame(() => {
          rubberRafRef.current = null;
          paintRubber(from, hit.point, true);
        });
        return;
      }

      if (hit) setSnapHotPin(hit);
      else setSnapHotPin(null);

      const preview = projectOrthogonalDraw(from, cursor, prefer, alignAxes);
      draft.preview = preview;
      wiringRef.current = draft;
      rubberRafRef.current = requestAnimationFrame(() => {
        rubberRafRef.current = null;
        paintRubber(from, preview, false);
      });
    },
    [paintRubber, setSnapHotPin],
  );

  // Leaving wire mode cancels an in-progress wire (no partial kept).
  useEffect(() => {
    if (mode === "wire") return;
    cancelWiringDraft();
    marqueeRef.current = null;
    setMarquee(null);
  }, [mode, cancelWiringDraft]);

  // Entering stamp / paste / copy-marquee: drop any wire draft; leaving clears the ghost.
  useEffect(() => {
    if (!placeKind && !pasteClip) {
      setPlaceGhost(null);
      return;
    }
    cancelWiringDraft();
    if (pasteClip && !placeGhostRef.current) {
      setPlaceGhost(lastFlowRef.current ?? clipGroupOrigin(pasteClip.nodes));
    }
  }, [placeKind, pasteClip, cancelWiringDraft]);

  useEffect(() => {
    if (copyMarquee) cancelWiringDraft();
  }, [copyMarquee, cancelWiringDraft]);

  useEffect(() => {
    setGhostRotation(0);
  }, [placeKind]);

  const stampAtClient = useCallback((clientX: number, clientY: number) => {
    const kind = placeKindRef.current;
    const rf = rfRef.current;
    if (!kind || !rf || kind === "TIP") return;
    const cursor = rf.screenToFlowPosition({ x: clientX, y: clientY });
    const pos = stampPositionFromCursor(
      kind,
      cursor,
      SCHEMATIC_GRID,
      ghostRotationRef.current,
    );
    onPlaceAtRef.current(kind, pos.x, pos.y, ghostRotationRef.current);
    setPlaceGhost(pos);
  }, []);

  const pasteAtClient = useCallback((clientX: number, clientY: number) => {
    if (!pasteClipRef.current) return;
    const rf = rfRef.current;
    if (!rf) return;
    const cursor = rf.screenToFlowPosition({ x: clientX, y: clientY });
    const origin = snapPoint(cursor, SCHEMATIC_GRID);
    onPasteAtRef.current(origin);
    setPlaceGhost(origin);
  }, []);

  // Stamp / paste: ghost follows cursor; left-click places; right-click cancels.
  useEffect(() => {
    if (!placeKind && !pasteClip) return;
    const root = canvasElRef.current;
    if (!root) return;

    const onMove = (e: PointerEvent) => {
      const rf = rfRef.current;
      if (!rf) return;
      const cursor = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const kind = placeKindRef.current;
      if (kind) {
        setPlaceGhost(
          stampPositionFromCursor(kind, cursor, SCHEMATIC_GRID, ghostRotationRef.current),
        );
        return;
      }
      if (pasteClipRef.current) {
        const origin = snapPoint(cursor, SCHEMATIC_GRID);
        lastFlowRef.current = origin;
        setPlaceGhost(origin);
      }
    };

    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".react-flow__controls, .react-flow__minimap")) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (placeKindRef.current) stampAtClient(e.clientX, e.clientY);
      else pasteAtClient(e.clientX, e.clientY);
    };

    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      onCancelPlaceRef.current();
    };

    root.addEventListener("pointermove", onMove);
    root.addEventListener("click", onClick, true);
    root.addEventListener("contextmenu", onContext, true);
    return () => {
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("contextmenu", onContext, true);
    };
  }, [placeKind, pasteClip, stampAtClient, pasteAtClient]);

  // Keep a flow-space cursor so Ctrl+V can paste even after Esc cleared the ghost.
  useEffect(() => {
    const root = canvasElRef.current;
    if (!root) return;
    const onMove = (e: PointerEvent) => {
      const rf = rfRef.current;
      if (!rf) return;
      lastFlowRef.current = snapPoint(
        rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
        SCHEMATIC_GRID,
      );
    };
    root.addEventListener("pointermove", onMove);
    return () => root.removeEventListener("pointermove", onMove);
  }, []);

  const beginMoveDrag = useCallback(
    (nodeId: string, clientX: number, clientY: number, multiToggle = false) => {
    const modeNow = modeRef.current;
    if (modeNow !== "move" && modeNow !== "drag") return;
    if (moveDragRef.current) return;
    const rf = rfRef.current;
    if (!rf) return;
    const detach =
      modeNow === "move" ||
      nodesRef.current.find((n) => n.id === nodeId)?.data.kind === "WIRELABEL";
    const movingLabel =
      nodesRef.current.find((n) => n.id === nodeId)?.data.kind === "WIRELABEL";

    const grabPoint = rf.screenToFlowPosition({ x: clientX, y: clientY });
    const startClient = { x: clientX, y: clientY };

    // Keep an existing multi-selection when dragging one of its members, or
    // when Ctrl/⌘+click will toggle — don't wipe before the click handler runs.
    const selectedParts = nodesRef.current.filter(
      (n) => n.selected && n.data.kind !== "TIP",
    );
    const keepGroup =
      multiToggle ||
      (selectedParts.length > 1 && selectedParts.some((n) => n.id === nodeId));
    if (!keepGroup) {
      onNodesChangeRef.current(
        nodesRef.current.map((n) => ({
          type: "select" as const,
          id: n.id,
          selected: n.id === nodeId,
        })),
      );
    }

    let armed = false;

    // Move: sever first, then translate alone. Drag: wires stay attached.
    const arm = () => {
      const pickup = onMoveDisconnectRef.current(nodeId, grabPoint, {
        additive: multiToggle,
        detach,
      });
      if (!pickup || !pickup.origins.length) return false;
      setMoveHint(
        movingLabel
          ? "Moving label…"
          : detach
            ? "Moving (wires disconnected)…"
            : "Dragging with connected wires…",
      );
      moveDragRef.current = {
        startFlow: grabPoint,
        origins: pickup.origins,
        detach,
      };
      armed = true;
      return true;
    };

    const onMove = (ev: PointerEvent) => {
      if (!armed) {
        const moved = Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y);
        if (moved < MOVE_DRAG_THRESHOLD) return;
        if (!arm()) {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          return;
        }
      }
      const drag = moveDragRef.current;
      const inst = rfRef.current;
      if (!drag || !inst || !drag.origins.length) return;
      const cur = inst.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const dx = cur.x - drag.startFlow.x;
      const dy = cur.y - drag.startFlow.y;
      // One snapped delta for the whole group (rigid — no sticky end).
      const o0 = drag.origins[0]!;
      const snapped = snapPoint({ x: o0.x + dx, y: o0.y + dy }, SCHEMATIC_GRID);
      // Grid only — wire/peer magnets were stealing the drop position.
      // Attach/splice still runs after drop from the user's snapped point.
      const sdx = snapped.x - o0.x;
      const sdy = snapped.y - o0.y;
      onNodesChangeRef.current(
        drag.origins.map((o) => ({
          type: "position" as const,
          id: o.id,
          position: { x: o.x + sdx, y: o.y + sdy },
          dragging: true,
        })),
      );
      if (drag.wirePath) {
        onWirePathUpdateRef.current(
          drag.wirePath.edgeId,
          translatePoints(drag.wirePath.baseWaypoints, sdx, sdy),
        );
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setMoveHint(null);
      const drag = moveDragRef.current;
      moveDragRef.current = null;
      // Pure click (never armed): selection already applied, wires untouched.
      if (!armed || !drag) return;
      onNodesChangeRef.current(
        drag.origins.map((o) => {
          const n = rfRef.current?.getNode(o.id);
          return {
            type: "position" as const,
            id: o.id,
            position: n?.position ?? { x: o.x, y: o.y },
            dragging: false,
          };
        }),
      );
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  },
  [],
  );

  /**
   * Move: slide one H/V segment or bend (pins stay attached).
   * Drag: cut that section free (tip↔tip) and translate it alone.
   */
  const beginWireSegmentDrag = useCallback((edgeId: string, clientX: number, clientY: number) => {
    const modeNow = modeRef.current;
    if (modeNow !== "move" && modeNow !== "drag") return;
    if (moveDragRef.current) return;
    const rf = rfRef.current;
    if (!rf) return;

    const edge = edgesRef.current.find((e) => e.id === edgeId);
    if (!edge) return;
    const grabPoint = rf.screenToFlowPosition({ x: clientX, y: clientY });
    const startClient = { x: clientX, y: clientY };
    const basePoly = computeEdgePolyline(nodesRef.current, edge);
    if (basePoly.length < 2) return;

    const src = nodesRef.current.find((n) => n.id === edge.source);
    const tgt = nodesRef.current.find((n) => n.id === edge.target);
    const tipWire =
      src?.data.kind === "TIP" || tgt?.data.kind === "TIP";
    const hit = hitTestWirePolyline(basePoly, grabPoint, { tipWire });
    if (!hit) {
      const onUpSelect = () => {
        window.removeEventListener("pointermove", onMoveProbe);
        window.removeEventListener("pointerup", onUpSelect);
        onSelectEdgeRef.current(edgeId);
      };
      const onMoveProbe = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y) >= MOVE_DRAG_THRESHOLD) {
          window.removeEventListener("pointermove", onMoveProbe);
          window.removeEventListener("pointerup", onUpSelect);
        }
      };
      window.addEventListener("pointermove", onMoveProbe);
      window.addEventListener("pointerup", onUpSelect);
      return;
    }

    const fromIndex =
      hit.kind === "segment" ? hit.segIndex : Math.max(0, hit.polyIndex - 1);
    const toIndex =
      hit.kind === "segment"
        ? hit.segIndex + 1
        : Math.min(basePoly.length - 1, hit.polyIndex + 1);

    // --- Move tool: cut the section free, then translate the free piece ------
    if (modeNow === "move") {
      let armed = false;

      const arm = () => {
        const pickup = onMoveWireDisconnectRef.current(edgeId, {
          fromIndex,
          toIndex,
        });
        if (!pickup || !pickup.origins.length) return false;
        setMoveHint("Moving disconnected wire section…");
        moveDragRef.current = {
          startFlow: grabPoint,
          origins: pickup.origins,
          detach: true,
          wirePath: {
            edgeId: pickup.edgeId,
            baseWaypoints: pickup.baseWaypoints,
          },
        };
        armed = true;
        return true;
      };

      const onMove = (ev: PointerEvent) => {
        if (!armed) {
          const moved = Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y);
          if (moved < MOVE_DRAG_THRESHOLD) return;
          if (!arm()) {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            return;
          }
        }
        const drag = moveDragRef.current;
        const inst = rfRef.current;
        if (!drag || !inst || !drag.origins.length) return;
        const cur = inst.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
        const dx = cur.x - drag.startFlow.x;
        const dy = cur.y - drag.startFlow.y;
        const o0 = drag.origins[0]!;
        const snapped = snapPoint({ x: o0.x + dx, y: o0.y + dy }, SCHEMATIC_GRID);
        const sdx = snapped.x - o0.x;
        const sdy = snapped.y - o0.y;
        onNodesChangeRef.current(
          drag.origins.map((o) => ({
            type: "position" as const,
            id: o.id,
            position: { x: o.x + sdx, y: o.y + sdy },
            dragging: true,
          })),
        );
        if (drag.wirePath) {
          onWirePathUpdateRef.current(
            drag.wirePath.edgeId,
            translatePoints(drag.wirePath.baseWaypoints, sdx, sdy),
          );
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setMoveHint(null);
        const drag = moveDragRef.current;
        moveDragRef.current = null;
        if (!armed || !drag) {
          onSelectEdgeRef.current(edgeId);
          return;
        }
        onNodesChangeRef.current(
          drag.origins.map((o) => {
            const n = rfRef.current?.getNode(o.id);
            return {
              type: "position" as const,
              id: o.id,
              position: n?.position ?? { x: o.x, y: o.y },
              dragging: false,
            };
          }),
        );
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      return;
    }

    // --- Drag tool: reshape in place (connected) ----------------------------
    const dragKind = hit.kind;
    const dragIndex = hit.kind === "segment" ? hit.segIndex : hit.polyIndex;
    let armed = false;
    let historyPushed = false;

    const arm = () => {
      if (!historyPushed) {
        onPushHistoryRef.current();
        historyPushed = true;
      }
      onSelectEdgeRef.current(edgeId);
      setMoveHint(
        dragKind === "corner" ? "Dragging wire bend…" : "Sliding wire segment…",
      );
      armed = true;
      return true;
    };

    const onMove = (ev: PointerEvent) => {
      if (!armed) {
        const moved = Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y);
        if (moved < MOVE_DRAG_THRESHOLD) return;
        if (!arm()) {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          return;
        }
      }
      const inst = rfRef.current;
      if (!inst) return;
      const cur = inst.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const nextPoly =
        dragKind === "corner"
          ? dragWireCorner(basePoly, dragIndex, cur, SCHEMATIC_GRID)
          : dragWireSegment(basePoly, dragIndex, cur, SCHEMATIC_GRID);
      const liveEdge = edgesRef.current.find((e) => e.id === edgeId) ?? edge;
      const waypoints = polylineToStoredWaypoints(
        nodesRef.current,
        liveEdge,
        nextPoly,
      );
      onWirePathUpdateRef.current(edgeId, waypoints);

      const first = nextPoly[0]!;
      const last = nextPoly[nextPoly.length - 1]!;
      const tipMoves: { id: string; x: number; y: number }[] = [];
      if (src?.data.kind === "TIP") {
        tipMoves.push({
          id: src.id,
          x: first.x,
          y: first.y - ((src.style?.height as number | undefined) ?? 8) / 2,
        });
      }
      if (tgt?.data.kind === "TIP") {
        tipMoves.push({
          id: tgt.id,
          x: last.x,
          y: last.y - ((tgt.style?.height as number | undefined) ?? 8) / 2,
        });
      }
      if (tipMoves.length) {
        onNodesChangeRef.current(
          tipMoves.map((o) => ({
            type: "position" as const,
            id: o.id,
            position: { x: o.x, y: o.y },
            dragging: true,
          })),
        );
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setMoveHint(null);
      if (!armed) {
        onSelectEdgeRef.current(edgeId);
        return;
      }
      const tipIds = [src, tgt]
        .filter((n) => n?.data.kind === "TIP")
        .map((n) => n!.id);
      if (tipIds.length) {
        onNodesChangeRef.current(
          tipIds.map((id) => {
            const n = rfRef.current?.getNode(id);
            return {
              type: "position" as const,
              id,
              position: n?.position ?? { x: 0, y: 0 },
              dragging: false,
            };
          }),
        );
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  // Move / Drag: capture pointer on parts (more reliable than RF node drag).
  useEffect(() => {
    if (mode !== "move" && mode !== "drag") return;
    const root = canvasElRef.current;
    if (!root) return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (placingRef.current || copyMarqueeRef.current) return;
      if (moveDragRef.current) return;
      const t = e.target as HTMLElement | null;
      const nodeEl = t?.closest?.(".react-flow__node") as HTMLElement | null;
      if (!nodeEl) return;
      const id = nodeEl.getAttribute("data-id");
      if (!id) return;
      // Never start Move/Drag from a dangling wire tip.
      if (nodeEl.querySelector(".component-node.tip-node")) return;

      e.preventDefault();
      e.stopPropagation();
      beginMoveDrag(id, e.clientX, e.clientY, isMultiSelectModifier(e));
    };

    root.addEventListener("pointerdown", onDown, true);
    return () => root.removeEventListener("pointerdown", onDown, true);
  }, [mode, beginMoveDrag]);

  // Move / Drag: slide one wire segment or bend (ends stay attached).
  useEffect(() => {
    if (mode !== "move" && mode !== "drag") return;
    const root = canvasElRef.current;
    if (!root) return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (placingRef.current || copyMarqueeRef.current) return;
      if (wiringRef.current) return;
      if (moveDragRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".wire-bend-handle, .wire-add-handle")) return;
      if (t?.closest?.(".react-flow__node, .component-pin, .react-flow__handle")) return;
      const edgeEl = t?.closest?.(".react-flow__edge") as HTMLElement | null;
      if (!edgeEl) return;

      const edgeId = edgeEl.getAttribute("data-id");
      if (!edgeId) return;

      e.preventDefault();
      e.stopPropagation();
      beginWireSegmentDrag(edgeId, e.clientX, e.clientY);
    };

    root.addEventListener("pointerdown", onDown, true);
    return () => root.removeEventListener("pointerdown", onDown, true);
  }, [mode, beginWireSegmentDrag]);

  // Box-select marquee on empty canvas (Move + Drag — Explore is pan/zoom only).
  // Move + Shift: keep the older cut-move (sever wires in the box).
  // Skipped while Ctrl+C copy-marquee is active (that tool owns the drag).
  useEffect(() => {
    if (copyMarquee) return;
    if (mode !== "move" && mode !== "drag") return;
    const root = canvasElRef.current;
    if (!root) return;

    const finishMarquee = (additive: boolean, cutMove: boolean) => {
      const draft = marqueeRef.current;
      marqueeRef.current = null;
      setMarquee(null);
      if (!draft) return;
      const rect = normalizeRect(draft.start, draft.end);
      if (!rectMeaningful(rect)) {
        // Plain click on empty canvas — deselect (Ctrl/⌘ plain click leaves selection).
        if (!cutMove && !additive) onSelectEdgeRef.current("");
        return;
      }
      // mouseup is followed by a click on the pane — don't clear the new selection.
      skipPaneClickRef.current = true;
      if (cutMove) onCutMoveRef.current(rect);
      else onSelectRegionRef.current(rect, additive);
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (placingRef.current || copyMarqueeRef.current) return;
      if (moveDragRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".react-flow__node, .react-flow__controls, .react-flow__minimap, .wire-draft-hint")) {
        return;
      }
      if (!t?.closest?.(".react-flow__pane, .react-flow__viewport")) return;

      const rf = rfRef.current;
      if (!rf) return;
      e.preventDefault();
      e.stopPropagation();

      // Cut-move remains Drag-only; Move marquee is select-only.
      const cutMove = mode === "drag" && e.shiftKey;
      const selectAdditive = isMultiSelectModifier(e);

      const start = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      marqueeRef.current = { start, end: start };
      setMarquee(marqueeRef.current);

      const onMove = (moveEvent: MouseEvent) => {
        const inst = rfRef.current;
        const draft = marqueeRef.current;
        if (!inst || !draft) return;
        const end = inst.screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        if (pointsEqual(draft.end, end)) return;
        const next = { ...draft, end };
        marqueeRef.current = next;
        setMarquee(next);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        finishMarquee(selectAdditive, cutMove);
        // RF Pane.onClick always calls resetSelectedElements() after onPaneClick.
        // A trailing click on the empty pane would wipe the selection we just set.
        const swallowClick = (ev: MouseEvent) => {
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation();
          window.removeEventListener("click", swallowClick, true);
        };
        window.addEventListener("click", swallowClick, true);
        window.setTimeout(() => {
          window.removeEventListener("click", swallowClick, true);
        }, 0);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

    root.addEventListener("mousedown", onDown, true);
    return () => root.removeEventListener("mousedown", onDown, true);
  }, [mode, copyMarquee]);

  // Ctrl+C copy mode: drag a dotted box on empty canvas → highlight ≥70% parts/wires.
  // Clicks on parts/wires are handled by the select effects below (not swallowed here).
  useEffect(() => {
    if (!copyMarquee) {
      // Leaving the tool mid-drag should not leave a stale overlay.
      if (marqueeRef.current) {
        marqueeRef.current = null;
        setMarquee(null);
      }
      return;
    }
    const root = canvasElRef.current;
    if (!root) return;

    const finishSelect = (additive: boolean) => {
      const draft = marqueeRef.current;
      marqueeRef.current = null;
      setMarquee(null);
      if (!draft) return;
      const rect = normalizeRect(draft.start, draft.end);
      if (!rectMeaningful(rect)) {
        // Plain click on empty — clear highlight (stay in copy mode).
        if (!additive) onSelectEdgeRef.current("");
        return;
      }
      skipPaneClickRef.current = true;
      onCopyRegionRef.current?.(rect, additive);
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (placingRef.current) return;
      if (moveDragRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".react-flow__controls, .react-flow__minimap, .wire-draft-hint")) {
        return;
      }
      // Only start the box on empty pane so part/wire clicks still select.
      if (t?.closest?.(".react-flow__node, .react-flow__edge, .component-pin, .react-flow__handle")) {
        return;
      }
      if (!t?.closest?.(".react-flow__pane, .react-flow__viewport")) return;

      const rf = rfRef.current;
      if (!rf) return;
      e.preventDefault();
      e.stopPropagation();

      const additive = isMultiSelectModifier(e);
      const start = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      marqueeRef.current = { start, end: start };
      setMarquee(marqueeRef.current);

      const onMove = (moveEvent: MouseEvent) => {
        const inst = rfRef.current;
        const draft = marqueeRef.current;
        if (!inst || !draft) return;
        const end = inst.screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        if (pointsEqual(draft.end, end)) return;
        const next = { ...draft, end };
        marqueeRef.current = next;
        setMarquee(next);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        finishSelect(additive);
        const swallowClick = (ev: MouseEvent) => {
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation();
          window.removeEventListener("click", swallowClick, true);
        };
        window.addEventListener("click", swallowClick, true);
        window.setTimeout(() => {
          window.removeEventListener("click", swallowClick, true);
        }, 0);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      marqueeRef.current = null;
      setMarquee(null);
      onCancelCopyMarqueeRef.current?.();
    };

    root.addEventListener("mousedown", onDown, true);
    root.addEventListener("contextmenu", onContext, true);
    return () => {
      root.removeEventListener("mousedown", onDown, true);
      root.removeEventListener("contextmenu", onContext, true);
    };
  }, [copyMarquee]);

  // Copy mode: click part → copy immediately; Ctrl+click → add to highlight only.
  useEffect(() => {
    if (!copyMarquee) return;
    const root = canvasElRef.current;
    if (!root) return;

    const onClick = (event: MouseEvent) => {
      if (placingRef.current) return;
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(".react-flow__controls, .react-flow__minimap")) return;
      if (target?.closest?.(".component-pin, .react-flow__handle")) return;

      const nodeEl = target?.closest?.(".react-flow__node") as HTMLElement | null;
      if (!nodeEl) return;
      const nodeId = nodeEl.getAttribute("data-id");
      if (!nodeId) return;
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node || node.data.kind === "TIP") return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const multi = isMultiSelectModifier(event);
      if (multi) {
        onNodesChangeRef.current([
          { type: "select", id: nodeId, selected: !node.selected },
        ]);
        return;
      }
      onCopyPartImmediateRef.current?.(nodeId);
    };

    root.addEventListener("click", onClick, true);
    return () => root.removeEventListener("click", onClick, true);
  }, [copyMarquee]);

  // Copy mode: click wire → copy immediately; Ctrl+click → add to highlight only.
  useEffect(() => {
    if (!copyMarquee) return;
    const root = canvasElRef.current;
    if (!root) return;

    const onClick = (event: MouseEvent) => {
      if (placingRef.current) return;
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(".react-flow__controls, .react-flow__minimap")) return;
      const rf = rfRef.current;
      if (!rf) return;
      const cursor = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const multi = isMultiSelectModifier(event);

      const nodeEl = target?.closest?.(".react-flow__node") as HTMLElement | null;
      if (nodeEl) {
        const nodeId = nodeEl.getAttribute("data-id");
        const node = nodeId ? nodes.find((n) => n.id === nodeId) : null;
        if (node?.data.kind === "TIP") {
          const edge = preferredEdgeForTip(nodes, edges, node.id);
          if (!edge) return;
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          if (multi) onToggleSelectEdgeRef.current?.(edge.id, true);
          else onCopyEdgeImmediateRef.current?.(edge.id);
          return;
        }
        return;
      }

      let edgeId: string | null = null;
      const edgeEl = target?.closest?.(".react-flow__edge") as HTMLElement | null;
      if (edgeEl) edgeId = edgeEl.getAttribute("data-id");
      if (!edgeId) {
        const hit = wireHitAtCursor(nodes, edges, cursor);
        edgeId = hit?.edgeId ?? null;
      }
      if (!edgeId) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (multi) onToggleSelectEdgeRef.current?.(edgeId, true);
      else onCopyEdgeImmediateRef.current?.(edgeId);
    };

    root.addEventListener("click", onClick, true);
    return () => root.removeEventListener("click", onClick, true);
  }, [copyMarquee]);

  // Scissors hit-test in capture phase so small wire tails remain deletable.
  // Free tip squares cover micro stubs — treat tip clicks as wire deletes.
  // Junction squares / crossing rings are deletable marks (before wire hit).
  // Real component artwork stays with the node handler (pin stems ≠ wires).
  useEffect(() => {
    if (mode !== "delete") return;
    const root = canvasElRef.current;
    if (!root) return;

    const onClick = (event: MouseEvent) => {
      if (placingRef.current || copyMarqueeRef.current) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(".react-flow__controls, .react-flow__minimap")) return;
      const rf = rfRef.current;
      if (!rf) return;
      const cursor = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const nodes = nodesRef.current;
      const edges = edgesRef.current;

      // Wire under cursor always wins — including near pins / corners (red-mark
      // clicks). Junction marks only when no wire is in range.
      {
        const wireHit = wireHitAtCursor(nodes, edges, cursor);
        if (wireHit) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          onDeleteEdgeRef.current(wireHit.edgeId, cursor);
          return;
        }
      }

      // Filled junction / hollow crossing — scissors remove the mark's meaning.
      const marks = findWireJunctions(nodes, edges);
      const hidden = new Set(hiddenCrossingRef.current);
      if (hidden.size) {
        marks.crossings = marks.crossings.filter((c) => !hidden.has(wireMarkKey(c)));
      }
      const markHit = hitTestWireMark(marks, cursor);
      if (markHit) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (markHit.kind === "junction") {
          onDeleteWireMarkRef.current("junction", markHit.mark, {
            tipId: markHit.mark.tipId,
          });
        } else {
          onDeleteWireMarkRef.current("crossing", markHit.mark, {
            edgeIds: markHit.mark.edgeIds,
          });
        }
        return;
      }

      const nodeEl = target?.closest?.(".react-flow__node") as HTMLElement | null;
      if (nodeEl) {
        const nodeId = nodeEl.getAttribute("data-id");
        const node = nodeId ? nodes.find((n) => n.id === nodeId) : null;
        if (node?.data.kind === "TIP") {
          const edge = preferredEdgeForTip(nodes, edges, node.id);
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          if (edge) onDeleteEdgeRef.current(edge.id, cursor);
          else onDeleteNodeRef.current(node.id);
          return;
        }
        // Part body stole the click but a connected wire is nearby — delete wire.
        if (nodeId) {
          const near = findNearestWireHit(
            nodes,
            edges,
            cursor,
            WIRE_HIT_RADIUS + 16,
            SCHEMATIC_GRID,
          );
          const edge = near ? edges.find((e) => e.id === near.edgeId) : null;
          if (near && edge && edgeTouchesNode(edge, nodeId)) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            onDeleteEdgeRef.current(near.edgeId, cursor);
            return;
          }
        }
        // Real parts (no wire under cursor): leave click to onNodeClick.
        return;
      }

      const edgeEl = target?.closest?.(".react-flow__edge") as HTMLElement | null;
      const directEdgeId = edgeEl?.getAttribute("data-id");
      if (directEdgeId) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        onDeleteEdgeRef.current(directEdgeId, cursor);
        return;
      }

      let hit = wireHitAtCursor(nodes, edges, cursor);
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onDeleteEdgeRef.current(hit.edgeId, cursor);
    };

    root.addEventListener("click", onClick, true);
    return () => root.removeEventListener("click", onClick, true);
  }, [mode]);

  // Explore / Move / Drag: generous hit-test so tiny wire stubs still select (then Delete removes them).
  // Free tip squares cover stubs — clicking a tip selects its attached wire.
  useEffect(() => {
    if (mode !== "move" && mode !== "drag" && mode !== "explore") return;
    const root = canvasElRef.current;
    if (!root) return;

    const onClick = (event: MouseEvent) => {
      if (placingRef.current || copyMarqueeRef.current) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(".react-flow__controls, .react-flow__minimap")) return;
      const rf = rfRef.current;
      if (!rf) return;
      const cursor = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const nodes = nodesRef.current;
      const edges = edgesRef.current;

      const nodeEl = target?.closest?.(".react-flow__node") as HTMLElement | null;
      if (nodeEl) {
        const nodeId = nodeEl.getAttribute("data-id");
        const node = nodeId ? nodes.find((n) => n.id === nodeId) : null;
        if (node?.data.kind === "TIP") {
          const edge = preferredEdgeForTip(nodes, edges, node.id);
          if (!edge) return;
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          onSelectEdgeRef.current(edge.id);
          return;
        }
        return;
      }
      if (target?.closest?.(".react-flow__edge")) return;

      let hit = wireHitAtCursor(nodes, edges, cursor);
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onSelectEdgeRef.current(hit.edgeId);
    };

    root.addEventListener("click", onClick, true);
    return () => root.removeEventListener("click", onClick, true);
  }, [mode]);

  // Explore / Move / Drag: capture part clicks before React Flow can single-select.
  useEffect(() => {
    if (mode !== "move" && mode !== "drag" && mode !== "explore") return;
    const root = canvasElRef.current;
    if (!root) return;

    const onClick = (event: MouseEvent) => {
      if (placingRef.current || copyMarqueeRef.current) return;
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(".react-flow__controls, .react-flow__minimap")) return;
      if (target?.closest?.(".component-pin, .react-flow__handle")) return;

      const nodeEl = target?.closest?.(".react-flow__node") as HTMLElement | null;
      if (!nodeEl) return;
      const nodeId = nodeEl.getAttribute("data-id");
      if (!nodeId) return;
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node || node.data.kind === "TIP") return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      applyPartSelectClick(
        nodesRef.current,
        nodeId,
        isMultiSelectModifier(event),
        onNodesChangeRef.current,
        onEdgesChangeRef.current,
        edgesRef.current,
      );
    };

    root.addEventListener("click", onClick, true);
    return () => root.removeEventListener("click", onClick, true);
  }, [mode]);

  // Explore: block React Flow mousedown selection (Move uses beginMoveDrag below).
  useEffect(() => {
    if (mode !== "explore") return;
    const root = canvasElRef.current;
    if (!root) return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const nodeEl = (e.target as HTMLElement | null)?.closest?.(
        ".react-flow__node",
      ) as HTMLElement | null;
      if (!nodeEl) return;
      if (nodeEl.querySelector(".component-node.tip-node")) return;
      e.stopPropagation();
    };

    root.addEventListener("pointerdown", onDown, true);
    return () => root.removeEventListener("pointerdown", onDown, true);
  }, [mode]);

  // Double-click hit-test so thin post-move wires still straighten even when
  // the pointer is slightly off the SVG stroke (React Flow dblclick misses).
  useEffect(() => {
    if (mode === "delete") return;
    const root = canvasElRef.current;
    if (!root) return;

    const onDblClick = (event: MouseEvent) => {
      if (wiringRef.current) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(".react-flow__controls, .react-flow__minimap")) return;
      if (target?.closest?.(".react-flow__node")) return;
      const rf = rfRef.current;
      if (!rf) return;
      const cursor = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const hit = findNearestWireHit(
        nodesRef.current,
        edgesRef.current,
        cursor,
        WIRE_HIT_RADIUS,
        SCHEMATIC_GRID,
      );
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onStraightenEdgeRef.current(hit.edgeId, cursor);
    };

    root.addEventListener("dblclick", onDblClick, true);
    return () => root.removeEventListener("dblclick", onDblClick, true);
  }, [mode]);

  const applyPinHitRef = useRef(applyPinHit);
  applyPinHitRef.current = applyPinHit;

  // Stable forever — prevents remounting every node while the rubber-band moves.
  const nodeTypes = useMemo(
    () => ({
      component: (props: NodeProps<Node<ComponentData>>) => (
        <ComponentNode
          {...props}
          onReplace={(nodeId, kind) => {
            replaceHandledRef.current = true;
            onReplaceRef.current(nodeId, kind);
          }}
          onPinClick={(nodeId, pinId) => {
            const modeNow = modeRef.current;
            const node = nodesRef.current.find((n) => n.id === nodeId);
            // Tip handles are large and sit on micro stubs — pin clicks must
            // still cut / select the wire outside wire mode.
            if (node?.data.kind === "TIP" && modeNow === "delete") {
              const edge = preferredEdgeForTip(
                nodesRef.current,
                edgesRef.current,
                nodeId,
              );
              if (edge) onDeleteEdgeRef.current(edge.id);
              else onDeleteNodeRef.current(nodeId);
              return;
            }
            if (
              node?.data.kind === "TIP" &&
              (modeNow === "move" || modeNow === "drag" || modeNow === "explore")
            ) {
              const edge = preferredEdgeForTip(
                nodesRef.current,
                edgesRef.current,
                nodeId,
              );
              if (edge) onSelectEdgeRef.current(edge.id);
              return;
            }
            // Scissors on a pin: cut the wire attached here (e.g. C↔GND).
            if (modeNow === "delete" && node && node.data.kind !== "TIP") {
              const onPin = edgesRef.current.filter(
                (e) =>
                  (e.source === nodeId && e.sourceHandle === pinId) ||
                  (e.target === nodeId && e.targetHandle === pinId),
              );
              if (onPin.length >= 1) {
                onDeleteEdgeRef.current(onPin[0]!.id);
                return;
              }
            }
            applyPinHitRef.current(nodeId, pinId);
          }}
        />
      ),
    }),
    [],
  );

  const edgeTypes = useMemo(
    () => ({
      schematic: (props: EdgeProps<SchematicWireEdgeType>) => (
        <SchematicWireEdge {...props} />
      ),
    }),
    [],
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      type: "schematic" as const,
      data: { waypoints: [] } satisfies SchematicWireData,
    }),
    [],
  );

  const routedEdges = useMemo(
    () =>
      edges.map((e) =>
        e.type === "schematic" ? e : { ...e, type: "schematic" as const },
      ),
    [edges],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (isTypingTarget(t)) {
        return;
      }
      if (isModV(e)) {
        e.preventDefault();
        e.stopPropagation();
        const origin = placeGhostRef.current ?? lastFlowRef.current;
        onPasteShortcutRef.current(origin);
        if (origin) setPlaceGhost(origin);
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "r") {
          if (placingRef.current) {
            e.preventDefault();
            e.stopPropagation();
            if (placeKindRef.current) {
              const next =
                placeKindRef.current === "WIRELABEL"
                  ? nextLabelRotation(ghostRotationRef.current)
                  : nextRotation(ghostRotationRef.current);
              setGhostRotation(next);
              ghostRotationRef.current = next;
              const rf = rfRef.current;
              const flow = lastFlowRef.current;
              if (rf && flow) {
                setPlaceGhost(
                  stampPositionFromCursor(
                    placeKindRef.current,
                    flow,
                    SCHEMATIC_GRID,
                    next,
                  ),
                );
              }
            } else {
              onRotatePasteClipRef.current();
            }
            return;
          }
        }
        if (k === "e" || k === "w" || k === "m" || k === "d") {
          if (placingRef.current || wiringRef.current || copyMarqueeRef.current) return;
          e.preventDefault();
          const next =
            k === "e" ? "explore" : k === "w" ? "wire" : k === "m" ? "move" : "drag";
          onModeChangeRef.current(next);
          return;
        }
      }
      // Same as the Controls “fit view” button (corner brackets).
      if (e.key === " " || e.code === "Space") {
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        void rfRef.current?.fitView({ padding: 0.2, duration: 200 });
        return;
      }
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();

      // One Esc → idle Explore: clear stamp/copy/wire draft, then leave the tool.
      if (placingRef.current) {
        onCancelPlaceRef.current();
      }
      if (copyMarqueeRef.current) {
        marqueeRef.current = null;
        setMarquee(null);
        onCancelCopyMarqueeRef.current?.();
      }
      if (wiringRef.current) {
        // Keep any locked bends; drop the live rubber band.
        finishOrKeepPartial();
      }

      if (modeRef.current !== "explore") {
        onModeChangeRef.current("explore");
        return;
      }

      // Already Explore: Esc clears selection (if any).
      const selNodes = nodes.filter((n) => n.selected);
      const selEdges = edges.filter((ed) => ed.selected);
      if (selNodes.length || selEdges.length) {
        if (selNodes.length) {
          onNodesChange(
            selNodes.map((n) => ({ type: "select" as const, id: n.id, selected: false })),
          );
        }
        if (selEdges.length) {
          onEdgesChange(
            selEdges.map((ed) => ({ type: "select" as const, id: ed.id, selected: false })),
          );
        }
      }
    };
    // Capture so React Flow cannot clear selection before we peel.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [nodes, edges, onNodesChange, onEdgesChange, finishOrKeepPartial]);

  // While drawing: track the cursor everywhere (pane, parts, UI) and paint the rubber-band.
  useEffect(() => {
    if (!wiring) return;
    const onMove = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      const nodeEl = t?.closest?.(".react-flow__node") as HTMLElement | null;
      const nodeId = nodeEl?.getAttribute("data-id");
      const node = nodeId
        ? nodesRef.current.find((n) => n.id === nodeId) ?? null
        : null;
      updateDraftPreview(e.clientX, e.clientY, node);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [wiring, updateDraftPreview]);

  // Right-click finishes the wire (LTspice) — never the browser menu.
  useEffect(() => {
    const root = canvasElRef.current;
    if (!root) return;
    const onContextMenu = (e: MouseEvent) => {
      if (modeRef.current !== "wire") return;
      e.preventDefault();
      e.stopPropagation();
      if (wiringRef.current) finishOrKeepPartial();
    };
    root.addEventListener("contextmenu", onContextMenu, true);
    return () => root.removeEventListener("contextmenu", onContextMenu, true);
  }, [finishOrKeepPartial]);

  const onPaneMouseMove = useCallback((e: React.MouseEvent) => {
    if (!wiringRef.current) return;
    updateDraftPreview(e.clientX, e.clientY, null);
  }, [updateDraftPreview]);

  const onNodeMouseMove = useCallback(
    (e: React.MouseEvent, node: Node<ComponentData>) => {
      if (wiringRef.current) {
        updateDraftPreview(e.clientX, e.clientY, node);
        return;
      }
      if (!probesLive || !simResult?.series.length) {
        setProbeTip(null);
        return;
      }
      if (node.data.kind === "TIP") {
        setProbeTip(null);
        return;
      }
      const nets = extractNets(nodesRef.current, edgesRef.current);
      const lines: string[] = [];
      const seen = new Set<string>();
      for (const pin of getComponentPins(node.data.kind, node.data.params)) {
        const net = nets.netOf(node.id, pin.id);
        if (seen.has(net)) continue;
        seen.add(net);
        const v = voltageAtNet(simResult.series, net);
        if (v) {
          lines.push(`${v.name} = ${formatProbeValue(v.value, "V")}`);
        } else {
          lines.push(`V(${net}) — not in results`);
        }
      }
      if (node.data.refdes) {
        const i = currentThrough(simResult.series, node.data.refdes);
        if (i) lines.push(`${i.name} = ${formatProbeValue(i.value, "A")}`);
      }
      setProbeTip(
        lines.length
          ? { x: e.clientX + 14, y: e.clientY + 14, lines }
          : null,
      );
    },
    [updateDraftPreview, probesLive, simResult],
  );

  const onNodeMouseLeave = useCallback(() => {
    if (!wiringRef.current) setProbeTip(null);
  }, []);

  const onEdgeMouseMove = useCallback(
    (e: React.MouseEvent, edge: Edge) => {
      if (!probesLive || !simResult?.series.length) {
        setProbeTip(null);
        return;
      }
      const ns = nodesRef.current;
      const lines: string[] = [];
      for (const end of [edge.source, edge.target]) {
        const n = ns.find((x) => x.id === end);
        if (!n || n.data.kind === "TIP" || !n.data.refdes) continue;
        const i = currentThrough(simResult.series, n.data.refdes);
        if (i) lines.push(`${i.name} = ${formatProbeValue(i.value, "A")}`);
      }
      const nets = extractNets(ns, edgesRef.current);
      if (edge.sourceHandle) {
        const net = nets.netOf(edge.source, edge.sourceHandle);
        const v = voltageAtNet(simResult.series, net);
        if (v) lines.push(`${v.name} = ${formatProbeValue(v.value, "V")}`);
      }
      setProbeTip(
        lines.length
          ? { x: e.clientX + 14, y: e.clientY + 14, lines: [...new Set(lines)] }
          : {
              x: e.clientX + 14,
              y: e.clientY + 14,
              lines: ["Branch — no I() in results"],
            },
      );
    },
    [probesLive, simResult],
  );

  const onEdgeMouseLeave = useCallback(() => {
    setProbeTip(null);
  }, []);

  const selectOnlyEdge = useCallback((edgeId: string) => {
    // Direct setState — RF applyEdgeChanges batches can leave extra edges selected.
    onSelectEdgeRef.current(edgeId);
  }, []);

  const beginBranchFromEdge = useCallback(
    (edge: Edge, clientX: number, clientY: number) => {
      const rf = rfRef.current;
      if (!rf) return;
      const cursor = rf.screenToFlowPosition({ x: clientX, y: clientY });

      // Attach at cursor column on H bus (or row on V) — not nearest junction.
      const resolved = resolveBranchOnEdge(
        nodesRef.current,
        edgesRef.current,
        edge.id,
        cursor,
        SCHEMATIC_GRID,
      );

      let tipId: string | null;
      let start: Point;
      let axisHint: "h" | "v" | null = null;

      if (resolved) {
        tipId = onWireBranchRef.current(resolved.edgeId, resolved.point, {
          nodes: resolved.nodes,
          edges: resolved.edges,
        });
        start = resolved.point;
        axisHint = resolved.busAxis === "h" ? "v" : "h";
      } else {
        const poly = computeEdgePolyline(nodesRef.current, edge);
        if (poly.length < 2) return;
        const branchPt = closestPointOnPolyline(poly, cursor, SCHEMATIC_GRID);
        tipId = onWireBranchRef.current(edge.id, branchPt);
        start = branchPt;
      }
      if (!tipId) return;

      // Draft must start at the real TIP (projected split), not the pre-split
      // resolve point — otherwise the rubber band sits beside the junction.
      const tipNode = nodesRef.current.find((n) => n.id === tipId);
      if (tipNode) {
        // TIP node top-left; pin/"t" is at y + TIP_SIZE/2 (see busBranch tipPos).
        start = { x: tipNode.position.x, y: tipNode.position.y + 4 };
      }

      onSelectEdgeRef.current("");
      const next: WiringDraft = {
        sourceNodeId: tipId,
        sourceHandle: "t",
        branchOriginTipId: tipId,
        start,
        waypoints: [],
        preview: null,
        axisHint,
      };
      wiringRef.current = next;
      setWiring(next);
      updateDraftPreview(clientX, clientY, null);
    },
    [updateDraftPreview],
  );

  const onEdgeClick = useCallback(
    (e: React.MouseEvent, edge: Edge) => {
      if (modeRef.current === "delete") {
        e.stopPropagation();
        e.preventDefault();
        const point = rfRef.current?.screenToFlowPosition({
          x: e.clientX,
          y: e.clientY,
        });
        onDeleteEdgeRef.current(edge.id, point);
        return;
      }
      if (modeRef.current !== "wire") {
        if (modeRef.current === "move" || modeRef.current === "drag" || modeRef.current === "explore") {
          e.stopPropagation();
          selectOnlyEdge(edge.id);
        }
        return;
      }
      const rf = rfRef.current;
      if (!rf) return;
      e.stopPropagation();
      e.preventDefault();

      const draft = wiringRef.current;
      if (draft) {
        // Pass raw cursor so column/row attach matches the mouse, not the
        // Euclidean closest point on the polyline.
        const cursor = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        finishDraftOnWire(edge.id, cursor);
        return;
      }

      // Idle: Alt+click = select. Plain click = branch from that point on this wire.
      if (e.altKey) {
        selectOnlyEdge(edge.id);
        return;
      }
      beginBranchFromEdge(edge, e.clientX, e.clientY);
    },
    [selectOnlyEdge, beginBranchFromEdge, finishDraftOnWire],
  );

  const onEdgeDoubleClick = useCallback(
    (e: React.MouseEvent, edge: Edge) => {
      // Straighten in any mode except delete; wire-mode single-click already
      // branches, so double-click is free for path cleanup.
      if (modeRef.current === "delete") return;
      if (modeRef.current === "wire" && wiringRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      const point = rfRef.current?.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });
      onStraightenEdgeRef.current(edge.id, point);
    },
    [],
  );

  const onPaneClick = useCallback((e: React.MouseEvent) => {
    if (skipPaneClickRef.current) {
      skipPaneClickRef.current = false;
      e.stopPropagation();
      return;
    }
    // Explore / Move / Delete: empty-pane click clears selection (Move also
    // handles this via the marquee mouseup path; Explore uses this handler).
    if (
      modeRef.current === "explore" ||
      modeRef.current === "move" ||
      modeRef.current === "drag" ||
      modeRef.current === "delete"
    ) {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".react-flow__node, .react-flow__edge, .component-pin, .react-flow__handle, .tip-node")) {
        return;
      }
      onSelectEdgeRef.current("");
      return;
    }
    const rf = rfRef.current;
    if (!rf) return;
    const t = e.target as HTMLElement | null;
    // Handle / tip / part-body clicks are owned by pin + node handlers.
    if (t?.closest?.(".component-pin, .react-flow__handle, .tip-node, .react-flow__node")) return;

    const cursor = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const draft = wiringRef.current;

    if (!draft) {
      const nearPin = findNearestPin(nodesRef.current, cursor, {
        maxDist: PIN_SNAP_RADIUS,
      });
      if (nearPin) {
        applyPinHit(nearPin.nodeId, nearPin.pinId);
        return;
      }
      // Free pane click starts a free wire.
      const start = snapPoint(cursor, WIRE_DRAW_GRID);
      const next: WiringDraft = {
        sourceNodeId: null,
        sourceHandle: null,
        start,
        waypoints: [],
        preview: null,
        axisHint: null,
      };
      wiringRef.current = next;
      setWiring(next);
      updateDraftPreview(e.clientX, e.clientY, null);
      return;
    }

    if (tryMagneticComplete(cursor)) return;

    // Click near a rail (even with no edge event): join it only when coplanar.
    {
      const wireHit = findNearestWireHit(
        nodesRef.current,
        edgesRef.current,
        cursor,
        WIRE_JOIN_RADIUS,
        SCHEMATIC_GRID,
      );
      if (
        wireHit &&
        isAxisAligned(lastLocked(draft), wireHit.point) &&
        finishDraftOnWire(wireHit.edgeId, cursor)
      ) {
        return;
      }
    }

    const from = lastLocked(draft);
    const prefer = draftPreferAxis(draft);
    const alignAxes = collectWireAlignAxes(nodesRef.current, edgesRef.current);
    let corner = projectOrthogonalDraw(from, cursor, prefer, alignAxes);
    const nearPin = findNearestPin(nodesRef.current, cursor, {
      maxDist: PIN_SNAP_RADIUS,
      exclude: sourceExclude(draft),
    });
    // Lock a bend onto the pin's row/col without finishing (step-draw).
    if (nearPin && !isAxisAligned(from, nearPin.point)) {
      corner = previewCornerToPin(from, nearPin.point, draftIncomingAxis(draft));
    }
    if (dist(from, corner) < WIRE_MIN_SEGMENT) return;
    if (draft.waypoints.some((p) => pointsEqual(p, corner))) return;

    // Same-axis extension: stretch the last locked point instead of stacking
    // collinear waypoints (keeps consecutive verticals as one clean run).
    const lastAxis = draftLastAxis(draft);
    const cornerAxis = segmentAxis(from, corner);
    let waypoints: Point[];
    if (
      draft.waypoints.length > 0 &&
      lastAxis &&
      cornerAxis === lastAxis
    ) {
      waypoints = [...draft.waypoints.slice(0, -1), corner];
    } else {
      waypoints = [...draft.waypoints, corner];
    }

    const next = {
      ...draft,
      waypoints,
      preview: null as Point | null,
    };
    wiringRef.current = next;
    setWiring(next);
    clearRubberDom();
  }, [tryMagneticComplete, applyPinHit, updateDraftPreview, finishDraftOnWire, beginBranchFromEdge]);

  const onNodeClick = useCallback(
    (e: React.MouseEvent, node: Node<ComponentData>) => {
      if (modeRef.current === "delete") {
        e.stopPropagation();
        e.preventDefault();
        onDeleteNodeRef.current(node.id);
        return;
      }
      if (modeRef.current === "wire") {
        // Never let React Flow select a part while wiring — that looks like
        // "click deleted my wire / selected the part".
        e.stopPropagation();
        e.preventDefault();
        const rf = rfRef.current;
        if (!rf) return;
        const cursor = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        if (wiringRef.current) {
          if (tryMagneticComplete(cursor, node)) return;
          // Body click: finish only when the rubber already reaches that pin
          // (same row/col). Off-axis → lock a bend toward the pin (step-draw),
          // never surprise-connect with a path the preview did not show.
          if (node.data.kind !== "TIP") {
            const draft = wiringRef.current;
            const hit = findNearestPinOnNode(node, cursor);
            if (!hit) return;
            const from = lastLocked(draft);
            if (isAxisAligned(from, hit.point)) {
              applyPinHit(hit.nodeId, hit.pinId);
              return;
            }
            const corner = previewCornerToPin(
              from,
              hit.point,
              draftIncomingAxis(draft),
            );
            if (dist(from, corner) < WIRE_MIN_SEGMENT) return;
            if (draft.waypoints.some((p) => pointsEqual(p, corner))) return;
            const lastAxis = draftLastAxis(draft);
            const cornerAxis = segmentAxis(from, corner);
            const waypoints =
              draft.waypoints.length > 0 &&
              lastAxis &&
              cornerAxis === lastAxis
                ? [...draft.waypoints.slice(0, -1), corner]
                : [...draft.waypoints, corner];
            const next = { ...draft, waypoints, preview: null as Point | null };
            wiringRef.current = next;
            setWiring(next);
            clearRubberDom();
          }
          return;
        }
        if (node.data.kind === "TIP") {
          // Junction tips are click-through; free tips extend the wire.
          const deg = edgesRef.current.filter(
            (e) => e.source === node.id || e.target === node.id,
          ).length;
          if (deg >= 2) return;
          applyPinHit(node.id, "t");
          return;
        }
        const hit = findNearestPinOnNode(node, cursor);
        if (hit) applyPinHit(hit.nodeId, hit.pinId);
        return;
      }
    },
    [tryMagneticComplete, applyPinHit, clearRubberDom],
  );

  const lockedPath = useMemo(() => {
    if (!wiring || wiring.waypoints.length === 0) return "";
    return polylinePath([wiring.start, ...wiring.waypoints]);
  }, [wiring]);

  const marqueeRect = useMemo(
    () => (marquee ? normalizeRect(marquee.start, marquee.end) : null),
    [marquee],
  );

  const wireMarks = useMemo(() => {
    const marks = findWireJunctions(nodes, edges);
    if (!hiddenCrossingKeys.length) return marks;
    const hidden = new Set(hiddenCrossingKeys);
    return {
      ...marks,
      crossings: marks.crossings.filter((c) => !hidden.has(wireMarkKey(c))),
    };
  }, [nodes, edges, hiddenCrossingKeys]);

  return (
    <div
      ref={canvasElRef}
      className={`canvas${mode === "explore" ? " canvas-explore" : ""}${mode === "wire" ? " canvas-wire" : ""}${wiring ? " canvas-wiring" : ""}${mode === "move" ? " canvas-move" : ""}${mode === "drag" ? " canvas-drag" : ""}${mode === "delete" ? " canvas-delete" : ""}${marquee ? " canvas-marquee" : ""}${placeKind || pasteClip ? " canvas-placing" : ""}${copyMarquee ? " canvas-copy-marquee" : ""}`}
    >
      <ReactFlow
        nodes={nodes}
        edges={routedEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeMouseMove={onNodeMouseMove}
        onNodeMouseLeave={onNodeMouseLeave}
        onEdgeMouseMove={onEdgeMouseMove}
        onEdgeMouseLeave={onEdgeMouseLeave}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        nodesDraggable={false}
        nodesConnectable={false}
        multiSelectionKeyCode={null}
        selectionKeyCode={null}
        selectionOnDrag={false}
        disableKeyboardA11y
        panOnDrag={
          viewLocked || placeKind || pasteClip || copyMarquee
            ? false
            : mode === "explore"
              ? true
              : mode === "wire"
                ? [1]
                : false
        }
        zoomOnScroll={!viewLocked}
        zoomOnPinch={!viewLocked}
        zoomOnDoubleClick={false}
        preventScrolling={!viewLocked}
        deleteKeyCode={null}
        connectionMode={ConnectionMode.Loose}
        defaultEdgeOptions={defaultEdgeOptions}
        snapToGrid
        snapGrid={[SCHEMATIC_GRID, SCHEMATIC_GRID]}
        fitView
        proOptions={{ hideAttribution: true }}
        onInit={(instance) => {
          rfRef.current = instance;
        }}
        onEdgeClick={onEdgeClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onPaneClick={onPaneClick}
        onPaneMouseMove={onPaneMouseMove}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          if (placingRef.current) {
            onCancelPlaceRef.current();
            return;
          }
          if (copyMarqueeRef.current) {
            marqueeRef.current = null;
            setMarquee(null);
            onCancelCopyMarqueeRef.current?.();
            return;
          }
          if (wiringRef.current) finishOrKeepPartial();
        }}
        onNodeContextMenu={(e, node) => {
          e.preventDefault();
          if (placingRef.current) {
            onCancelPlaceRef.current();
            return;
          }
          if (copyMarqueeRef.current) {
            marqueeRef.current = null;
            setMarquee(null);
            onCancelCopyMarqueeRef.current?.();
            return;
          }
          if (wiringRef.current) {
            finishOrKeepPartial();
            return;
          }
          if (node.data.kind === "TIP") return;
          onOpenComponentPropsRef.current(node.id, e.clientX, e.clientY);
        }}
        onEdgeContextMenu={(e) => {
          e.preventDefault();
          if (placingRef.current) {
            onCancelPlaceRef.current();
            return;
          }
          if (copyMarqueeRef.current) {
            marqueeRef.current = null;
            setMarquee(null);
            onCancelCopyMarqueeRef.current?.();
            return;
          }
          if (wiringRef.current) finishOrKeepPartial();
        }}
        onDragOver={(e) => {
          if (!isPaletteDrag(e.dataTransfer)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (replaceHandledRef.current) {
            replaceHandledRef.current = false;
            return;
          }
          if (wiringRef.current) return;
          const kind = e.dataTransfer.getData(PALETTE_DND_MIME) as ComponentKind;
          if (!kind || !COMPONENT_SPECS[kind] || kind === "TIP" || !rfRef.current) return;
          const cursor = rfRef.current.screenToFlowPosition({
            x: e.clientX,
            y: e.clientY,
          });
          const pos = stampPositionFromCursor(kind, cursor, SCHEMATIC_GRID);
          onAddAt(kind, pos.x, pos.y);
          onCancelPlaceRef.current();
        }}
      >
        <Background
          gap={SCHEMATIC_GRID}
          color={uiTheme === "light" ? "#b0bcc9" : "#2a3544"}
          style={{ backgroundColor: uiTheme === "light" ? "#e8ecf1" : "#0f1419" }}
        />
        <WireDraftOverlay
          lockedPath={lockedPath}
          rubberRef={rubberPathElRef}
          snapDotRef={snapDotElRef}
          anchor={wiring ? lastLocked(wiring) : null}
        />
        <CutMarqueeOverlay rect={marqueeRect} />
        <JunctionOverlay
          junctions={wireMarks.junctions}
          crossings={wireMarks.crossings}
          interactive={mode === "delete"}
        />
        {placeKind ? (
          <PlaceGhostOverlay
            kind={placeKind}
            position={placeGhost}
            rotation={ghostRotation}
            ghostName={placeGhostName}
          />
        ) : null}
        {pasteClip ? <PasteGhostOverlay clip={pasteClip} origin={placeGhost} /> : null}
      </ReactFlow>
      {probeTip && (
        <div
          className="sim-probe-tip"
          style={{ left: probeTip.x, top: probeTip.y }}
          role="status"
        >
          {probeTip.lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
