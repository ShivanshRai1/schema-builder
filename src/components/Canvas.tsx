import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
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
import type { ComponentData, ComponentKind } from "../model/types";
import { isPaletteDrag, PALETTE_DND_MIME } from "../dnd";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import {
  SchematicWireEdge,
  type SchematicWireData,
  type SchematicWireEdgeType,
} from "../edges/SchematicWireEdge";
import {
  dist,
  pointsEqual,
  polylinePath,
  projectOrthogonal,
  projectOrthogonalLive,
  segmentAxis,
  snapPoint,
  WIRE_GRID,
  type Point,
} from "../wiring/orthogonal";
import { findNearestPin, findNearestPinOnNode, PIN_SNAP_RADIUS, pinWorldPoint, snapPositionToPeerPins } from "../wiring/pinGeometry";
import {
  computeEdgePolyline,
  closestPointOnPolyline,
  findNearestWireHit,
} from "../wiring/wireGeometry";
import {
  normalizeRect,
  rectMeaningful,
  type FlowRect,
} from "../wiring/cutMove";
import { translatePoints } from "../wiring/wireMove";
import { findWireJunctions } from "../wiring/junctions";

/** Match Background gap — snap placement and wire corners to this grid. */
export const SCHEMATIC_GRID = WIRE_GRID;

/** Pointer travel (px) before a Move-mode press becomes a drag (vs. a click). */
const MOVE_DRAG_THRESHOLD = 4;

/** Hit radius for ending a draft on an existing wire (incl. under parts). */
const WIRE_JOIN_RADIUS = 16;

/**
 * Must be this close to commit to another pin on the *same* part you started
 * from — otherwise body-hover wrongly snaps V+ → V− while aiming at a rail.
 */
const SAME_PART_PIN_COMMIT = 14;

/** LTspice-style canvas tool: wire (click pins) or move (drag parts). */
export type CanvasMode = "explore" | "wire" | "move";

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
  start: Point;
  waypoints: Point[];
  preview: Point | null;
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

/** Prefer continuing the last locked segment's axis (V→V / H→H). */
function draftPreferAxis(draft: WiringDraft): "h" | "v" | null {
  if (!draft.waypoints.length) return null;
  const to = draft.waypoints[draft.waypoints.length - 1]!;
  const from =
    draft.waypoints.length >= 2
      ? draft.waypoints[draft.waypoints.length - 2]!
      : draft.start;
  return segmentAxis(from, to);
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
}: {
  junctions: Point[];
  crossings: Point[];
}) {
  if (!junctions.length && !crossings.length) return null;
  return (
    <ViewportPortal>
      <svg
        className="junction-overlay"
        width={1}
        height={1}
        overflow="visible"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          overflow: "visible",
          pointerEvents: "none",
          zIndex: 5,
        }}
      >
        {junctions.map((p) => (
          <rect
            key={`j-${p.x},${p.y}`}
            className="wire-junction"
            x={p.x - 4.5}
            y={p.y - 4.5}
            width={9}
            height={9}
          />
        ))}
        {crossings.map((p) => (
          <circle
            key={`c-${p.x},${p.y}`}
            className="wire-crossing"
            cx={p.x}
            cy={p.y}
            r={6}
          />
        ))}
      </svg>
    </ViewportPortal>
  );
}

// The schematic canvas. Custom click wiring (LTspice-style), not drag-auto-route.
export function Canvas({
  nodes,
  edges,
  mode,
  onModeChange,
  onNodesChange,
  onEdgesChange,
  onWire,
  onWirePartial,
  onTrimWire,
  onWirePathUpdate,
  onMoveWireDisconnect,
  onReplace,
  onAddAt,
  onCutMoveRegion,
  onMoveDisconnect,
  onWireBranch,
  onSelectEdge,
}: {
  nodes: Node<ComponentData>[];
  edges: Edge[];
  mode: CanvasMode;
  onModeChange: (mode: CanvasMode) => void;
  onNodesChange: OnNodesChange<Node<ComponentData>>;
  onEdgesChange: OnEdgesChange;
  onWire: (payload: WireCompletePayload) => void;
  onWirePartial: (payload: WirePartialPayload) => void;
  onTrimWire: () => boolean;
  onWirePathUpdate: (edgeId: string, waypoints: Point[]) => void;
  onMoveWireDisconnect: (edgeId: string) => {
    moveIds: string[];
    origins: { id: string; x: number; y: number }[];
    edgeId: string;
    baseWaypoints: Point[];
    cutCount: number;
  } | null;
  onReplace: (nodeId: string, kind: ComponentKind) => void;
  onAddAt: (kind: ComponentKind, x: number, y: number) => void;
  onCutMoveRegion: (rect: FlowRect) => void;
  /** Split edge at point; returns new TIP id. */
  onWireBranch: (edgeId: string, branchPoint: Point) => string | null;
  /** Select exactly one edge; clear all node selection. */
  onSelectEdge: (edgeId: string) => void;
  onMoveDisconnect: (
    nodeId: string,
    grabPoint?: { x: number; y: number },
  ) => {
    moveIds: string[];
    origins: { id: string; x: number; y: number }[];
    cutCount: number;
  } | null;
}) {
  const canvasElRef = useRef<HTMLDivElement | null>(null);
  const rfRef = useRef<ReactFlowInstance<Node<ComponentData>> | null>(null);
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
  const [, setMoveHint] = useState<string | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  type MoveDrag = {
    startFlow: Point;
    origins: { id: string; x: number; y: number }[];
    /** When set, this is a whole-wire cut/move (translate tips + waypoints). */
    wirePath?: { edgeId: string; baseWaypoints: Point[] };
  };
  const moveDragRef = useRef<MoveDrag | null>(null);

  const onReplaceRef = useRef(onReplace);
  const onWireRef = useRef(onWire);
  const onWirePartialRef = useRef(onWirePartial);
  const onTrimWireRef = useRef(onTrimWire);
  const onWirePathUpdateRef = useRef(onWirePathUpdate);
  const onMoveWireDisconnectRef = useRef(onMoveWireDisconnect);
  const onModeChangeRef = useRef(onModeChange);
  const onCutMoveRef = useRef(onCutMoveRegion);
  const onMoveDisconnectRef = useRef(onMoveDisconnect);
  const onNodesChangeRef = useRef(onNodesChange);
  const onEdgesChangeRef = useRef(onEdgesChange);
  const onWireBranchRef = useRef(onWireBranch);
  onWireBranchRef.current = onWireBranch;
  const onSelectEdgeRef = useRef(onSelectEdge);
  onSelectEdgeRef.current = onSelectEdge;
  onReplaceRef.current = onReplace;
  onWireRef.current = onWire;
  onWirePartialRef.current = onWirePartial;
  onTrimWireRef.current = onTrimWire;
  onWirePathUpdateRef.current = onWirePathUpdate;
  onMoveWireDisconnectRef.current = onMoveWireDisconnect;
  onModeChangeRef.current = onModeChange;
  onCutMoveRef.current = onCutMoveRegion;
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
    const pts = [...draft.waypoints];
    if (draft.preview) {
      const from = lastLocked(draft);
      const end = projectOrthogonal(
        from,
        draft.preview,
        SCHEMATIC_GRID,
        draftPreferAxis(draft),
      );
      if (dist(from, end) >= SCHEMATIC_GRID * 0.4) pts.push(end);
    }
    if (pts.length > 0) {
      onWirePartialRef.current({
        source: draft.sourceNodeId ?? undefined,
        sourceHandle: draft.sourceHandle ?? undefined,
        freeStart: draft.sourceNodeId ? undefined : draft.start,
        waypoints: pts.slice(0, -1),
        end: pts[pts.length - 1]!,
      });
    }
    wiringRef.current = null;
    setWiring(null);
    clearRubberDom();
  }, [clearRubberDom]);

  const cancelWiringDraft = useCallback(() => {
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
        wiringRef.current = {
          sourceNodeId: hitNodeId,
          sourceHandle: hitPinId,
          start: center,
          waypoints: [],
          preview: null,
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
        waypoints: draft.waypoints,
        freeStart: draft.sourceNodeId ? undefined : draft.start,
      });
      wiringRef.current = null;
      setWiring(null);
      clearRubberDom();
    },
    [clearRubberDom],
  );

  /** Split `edgeId` at `branchPt` and complete the current draft onto that tip. */
  const finishDraftOnWire = useCallback(
    (edgeId: string, branchPt: Point): boolean => {
      const draft = wiringRef.current;
      if (!draft) return false;
      const tipId = onWireBranchRef.current(edgeId, branchPt);
      if (!tipId) return false;
      onWireRef.current({
        source: draft.sourceNodeId ?? "",
        sourceHandle: draft.sourceHandle ?? "",
        target: tipId,
        targetHandle: "t",
        waypoints: draft.waypoints,
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
        return finishDraftOnWire(wireHit.edgeId, wireHit.point);
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
          applyPinHit(under.nodeId, under.pinId);
          return true;
        }
        applyPinHit(hoverNode.id, "t");
        return true;
      }

      if (!pinHit) return false;
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

      const wireHit = findNearestWireHit(
        nodesRef.current,
        edgesRef.current,
        cursor,
        WIRE_JOIN_RADIUS,
        SCHEMATIC_GRID,
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

      if (preferWire && wireHit) {
        setSnapHotPin(null);
        const target = wireHit.point;
        const corner = projectOrthogonalLive(from, target, prefer);
        draft.preview = target;
        wiringRef.current = draft;
        rubberRafRef.current = requestAnimationFrame(() => {
          rubberRafRef.current = null;
          const path = rubberPathElRef.current;
          if (!path) return;
          const pts = pointsEqual(corner, target)
            ? [from, target]
            : [from, corner, target];
          path.setAttribute("d", polylinePath(pts));
          path.classList.add("snapping");
          const dot = snapDotElRef.current;
          if (dot) {
            dot.setAttribute("cx", String(target.x));
            dot.setAttribute("cy", String(target.y));
            dot.setAttribute("visibility", "visible");
          }
        });
        return;
      }

      if (hit) {
        setSnapHotPin(hit);
        const corner = projectOrthogonalLive(from, hit.point, prefer);
        draft.preview = hit.point;
        wiringRef.current = draft;
        rubberRafRef.current = requestAnimationFrame(() => {
          rubberRafRef.current = null;
          const path = rubberPathElRef.current;
          if (!path) return;
          const pts = pointsEqual(corner, hit.point)
            ? [from, hit.point]
            : [from, corner, hit.point];
          path.setAttribute("d", polylinePath(pts));
          path.classList.add("snapping");
          const dot = snapDotElRef.current;
          if (dot) {
            dot.setAttribute("cx", String(hit.point.x));
            dot.setAttribute("cy", String(hit.point.y));
            dot.setAttribute("visibility", "visible");
          }
        });
        return;
      }

      setSnapHotPin(null);
      const preview = projectOrthogonalLive(from, cursor, prefer);
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

  const beginMoveDrag = useCallback((nodeId: string, clientX: number, clientY: number) => {
    if (modeRef.current !== "move") return;
    if (moveDragRef.current) return;
    const rf = rfRef.current;
    if (!rf) return;

    const grabPoint = rf.screenToFlowPosition({ x: clientX, y: clientY });
    const startClient = { x: clientX, y: clientY };

    // Select the part immediately. The wire cut is deferred until the pointer
    // actually moves (see arm() below), so a plain click only selects — it never
    // reroutes or mangles the part's wires.
    onNodesChangeRef.current(
      nodesRef.current.map((n) => ({
        type: "select" as const,
        id: n.id,
        selected: n.id === nodeId,
      })),
    );

    let armed = false;

    // Perform the actual wire cut + start the drag once movement is confirmed.
    const arm = () => {
      const pickup = onMoveDisconnectRef.current(nodeId, grabPoint);
      if (!pickup || !pickup.origins.length) return false;
      setMoveHint(
        pickup.cutCount > 0
          ? `Disconnected ${pickup.cutCount} wire(s) — drag to place`
          : "Moving…",
      );
      moveDragRef.current = { startFlow: grabPoint, origins: pickup.origins };
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
      // Magnetic align to nearby part pins (V2 ↔ V1 column/row).
      const aligned =
        drag.wirePath
          ? snapped
          : snapPositionToPeerPins(
              nodesRef.current,
              o0.id,
              snapped,
              SCHEMATIC_GRID * 0.65,
            );
      const sdx = aligned.x - o0.x;
      const sdy = aligned.y - o0.y;
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
  }, []);

  /** Whole-wire cut + translate (tips + path move together). */
  const beginWireMoveDrag = useCallback((edgeId: string, clientX: number, clientY: number) => {
    if (modeRef.current !== "move") return;
    if (moveDragRef.current) return;
    const rf = rfRef.current;
    if (!rf) return;

    const grabPoint = rf.screenToFlowPosition({ x: clientX, y: clientY });
    const startClient = { x: clientX, y: clientY };
    let armed = false;

    // Cut the wire from its pins only once real dragging starts, so clicking a
    // wire in Move mode selects it without severing it into stubs.
    const arm = () => {
      const pickup = onMoveWireDisconnectRef.current(edgeId);
      if (!pickup || !pickup.origins.length) return false;
      setMoveHint(
        pickup.cutCount > 0
          ? "Wire cut — drag to place, then Wire-mode reconnect to pins"
          : "Moving wire…",
      );
      moveDragRef.current = {
        startFlow: grabPoint,
        origins: pickup.origins,
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
      // One snapped delta for the whole group (rigid — no sticky end).
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
  }, []);

  // Move mode: capture pointer on parts (more reliable than RF node drag).
  useEffect(() => {
    if (mode !== "move") return;
    const root = canvasElRef.current;
    if (!root) return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (moveDragRef.current) return;
      const t = e.target as HTMLElement | null;
      const nodeEl = t?.closest?.(".react-flow__node") as HTMLElement | null;
      if (!nodeEl) return;
      const id = nodeEl.getAttribute("data-id");
      if (!id) return;
      // Never start Move from a dangling wire tip.
      if (nodeEl.querySelector(".component-node.tip-node")) return;

      e.preventDefault();
      e.stopPropagation();
      beginMoveDrag(id, e.clientX, e.clientY);
    };

    root.addEventListener("pointerdown", onDown, true);
    return () => root.removeEventListener("pointerdown", onDown, true);
  }, [mode, beginMoveDrag]);

  // Drag whole wire in Move mode (cut from pins, translate as one object).
  // Bend-handle clicks are ignored here (handled by SchematicWireEdge).
  useEffect(() => {
    if (mode !== "move") return;
    const root = canvasElRef.current;
    if (!root) return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
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
      beginWireMoveDrag(edgeId, e.clientX, e.clientY);
    };

    root.addEventListener("pointerdown", onDown, true);
    return () => root.removeEventListener("pointerdown", onDown, true);
  }, [mode, beginWireMoveDrag]);


  // Cut-move marquee on empty canvas.
  useEffect(() => {
    if (mode !== "move") return;
    const root = canvasElRef.current;
    if (!root) return;

    const finishMarquee = () => {
      const draft = marqueeRef.current;
      marqueeRef.current = null;
      setMarquee(null);
      if (!draft) return;
      const rect = normalizeRect(draft.start, draft.end);
      if (rectMeaningful(rect)) onCutMoveRef.current(rect);
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
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
        finishMarquee();
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

    root.addEventListener("mousedown", onDown, true);
    return () => root.removeEventListener("mousedown", onDown, true);
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
      if (t && t.closest('input, textarea, select, [contenteditable="true"], .monaco-editor')) {
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        onModeChangeRef.current(modeRef.current === "move" ? "wire" : "move");
        return;
      }
      if (e.key !== "Escape") return;
      // While drawing: Esc keeps/cancels the draft — never peels an existing wire.
      if (wiringRef.current) {
        e.preventDefault();
        e.stopPropagation();
        finishOrKeepPartial();
        return;
      }
      // Move mode: Esc clears selection before wire peel.
      if (modeRef.current === "move") {
        const hasSel = nodes.some((n) => n.selected);
        if (hasSel) {
          e.preventDefault();
          e.stopPropagation();
          onNodesChange(
            nodes
              .filter((n) => n.selected)
              .map((n) => ({ type: "select" as const, id: n.id, selected: false })),
          );
          return;
        }
      }
      // Idle wire mode: Esc peels a selected wire one bend at a time.
      if (onTrimWireRef.current()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Capture so React Flow cannot clear selection before we peel.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [nodes, onNodesChange, finishOrKeepPartial]);

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
      if (!wiringRef.current) return;
      updateDraftPreview(e.clientX, e.clientY, node);
    },
    [updateDraftPreview],
  );

  const selectOnlyEdge = useCallback((edgeId: string) => {
    // Direct setState — RF applyEdgeChanges batches can leave extra edges selected.
    onSelectEdgeRef.current(edgeId);
  }, []);

  const beginBranchFromEdge = useCallback(
    (edge: Edge, clientX: number, clientY: number) => {
      const rf = rfRef.current;
      if (!rf) return;
      const cursor = rf.screenToFlowPosition({ x: clientX, y: clientY });
      const poly = computeEdgePolyline(nodesRef.current, edge);
      if (poly.length < 2) return;
      // Classic mid-wire branch: split THIS edge at the nearest point on it.
      const branchPt = closestPointOnPolyline(poly, cursor, SCHEMATIC_GRID);
      const tipId = onWireBranchRef.current(edge.id, branchPt);
      if (!tipId) return;
      onSelectEdgeRef.current("");
      const next: WiringDraft = {
        sourceNodeId: tipId,
        sourceHandle: "t",
        start: branchPt,
        waypoints: [],
        preview: null,
      };
      wiringRef.current = next;
      setWiring(next);
      updateDraftPreview(clientX, clientY, null);
    },
    [updateDraftPreview],
  );

  const onEdgeClick = useCallback(
    (e: React.MouseEvent, edge: Edge) => {
      if (modeRef.current !== "wire") {
        if (modeRef.current === "explore" || modeRef.current === "move") {
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
        const cursor = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const poly = computeEdgePolyline(nodesRef.current, edge);
        if (poly.length < 2) return;
        const branchPt = closestPointOnPolyline(poly, cursor, SCHEMATIC_GRID);
        finishDraftOnWire(edge.id, branchPt);
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
      if (modeRef.current !== "wire") return;
      if (wiringRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      beginBranchFromEdge(edge, e.clientX, e.clientY);
    },
    [beginBranchFromEdge],
  );

  const onPaneClick = useCallback((e: React.MouseEvent) => {
    // Explore: a pane click just clears selection — never draws a wire.
    if (modeRef.current === "explore") {
      const sel = nodesRef.current.filter((n) => n.selected);
      if (sel.length) {
        onNodesChangeRef.current(
          sel.map((n) => ({ type: "select" as const, id: n.id, selected: false })),
        );
      }
      return;
    }
    if (modeRef.current === "move") return;
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
      // Free pane click starts a free wire (no auto bus-branch).
      const start = snapPoint(cursor, SCHEMATIC_GRID);
      const next: WiringDraft = {
        sourceNodeId: null,
        sourceHandle: null,
        start,
        waypoints: [],
        preview: null,
      };
      wiringRef.current = next;
      setWiring(next);
      updateDraftPreview(e.clientX, e.clientY, null);
      return;
    }

    if (tryMagneticComplete(cursor)) return;

    // Click near a rail (even with no edge event): join it.
    {
      const wireHit = findNearestWireHit(
        nodesRef.current,
        edgesRef.current,
        cursor,
        WIRE_JOIN_RADIUS,
        SCHEMATIC_GRID,
      );
      if (wireHit && finishDraftOnWire(wireHit.edgeId, wireHit.point)) return;
    }

    const from = lastLocked(draft);
    const prefer = draftPreferAxis(draft);
    const corner = projectOrthogonal(from, cursor, SCHEMATIC_GRID, prefer);
    if (dist(from, corner) < SCHEMATIC_GRID * 0.4) return;
    if (draft.waypoints.some((p) => pointsEqual(p, corner))) return;

    // Same-axis extension: stretch the last locked point instead of inserting
    // a zero-length bend (keeps consecutive verticals as one clean run).
    let waypoints: Point[];
    if (
      prefer &&
      draft.waypoints.length > 0 &&
      segmentAxis(from, corner) === prefer
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
          // Body click on a real part: always attach to nearest pin of that part.
          if (node.data.kind !== "TIP") {
            const hit = findNearestPinOnNode(node, cursor);
            if (hit) applyPinHit(hit.nodeId, hit.pinId);
          }
          return;
        }
        if (node.data.kind === "TIP") {
          applyPinHit(node.id, "t");
          return;
        }
        const hit = findNearestPinOnNode(node, cursor);
        if (hit) applyPinHit(hit.nodeId, hit.pinId);
        return;
      }

      // Explore: single-select a part so it shows in Properties. No move/wire.
      if (modeRef.current === "explore") {
        if (node.data.kind === "TIP") return;
        const changes = nodes.flatMap((n) => {
          if (n.id === node.id) {
            return n.selected ? [] : [{ type: "select" as const, id: n.id, selected: true }];
          }
          return n.selected ? [{ type: "select" as const, id: n.id, selected: false }] : [];
        });
        if (changes.length) onNodesChange(changes);
        return;
      }

      if (modeRef.current !== "move") return;
      if (node.data.kind === "TIP") return;
      // Keep cut-move group (part + tips) selected when clicking a member to drag.
      if (node.selected && nodes.some((n) => n.selected && n.id !== node.id)) {
        return;
      }
      const changes = nodes.flatMap((n) => {
        if (n.id === node.id) {
          return n.selected ? [] : [{ type: "select" as const, id: n.id, selected: true }];
        }
        return n.selected ? [{ type: "select" as const, id: n.id, selected: false }] : [];
      });
      if (changes.length) onNodesChange(changes);
    },
    [nodes, onNodesChange, tryMagneticComplete, applyPinHit],
  );

  const lockedPath = useMemo(() => {
    if (!wiring || wiring.waypoints.length === 0) return "";
    return polylinePath([wiring.start, ...wiring.waypoints]);
  }, [wiring]);

  const marqueeRect = useMemo(
    () => (marquee ? normalizeRect(marquee.start, marquee.end) : null),
    [marquee],
  );

  const wireMarks = useMemo(() => findWireJunctions(nodes, edges), [nodes, edges]);

  return (
    <div
      ref={canvasElRef}
      className={`canvas${mode === "explore" ? " canvas-explore" : ""}${mode === "wire" ? " canvas-wire" : ""}${wiring ? " canvas-wiring" : ""}${mode === "move" ? " canvas-move" : ""}${marquee ? " canvas-marquee" : ""}`}
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
        elementsSelectable={mode !== "wire"}
        nodesFocusable={mode !== "wire"}
        edgesFocusable={mode !== "wire"}
        nodesDraggable={false}
        nodesConnectable={false}
        multiSelectionKeyCode={null}
        selectionOnDrag={false}
        panOnDrag={mode === "explore" ? true : mode === "wire" ? [1] : false}
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
          if (wiringRef.current) finishOrKeepPartial();
        }}
        onNodeContextMenu={(e) => {
          e.preventDefault();
          if (wiringRef.current) finishOrKeepPartial();
        }}
        onEdgeContextMenu={(e) => {
          e.preventDefault();
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
          const pos = snapPoint(
            rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
            SCHEMATIC_GRID,
          );
          onAddAt(kind, pos.x, pos.y);
        }}
      >
        <Background gap={SCHEMATIC_GRID} />
        <Controls />
        <WireDraftOverlay
          lockedPath={lockedPath}
          rubberRef={rubberPathElRef}
          snapDotRef={snapDotElRef}
          anchor={wiring ? lastLocked(wiring) : null}
        />
        <CutMarqueeOverlay rect={marqueeRect} />
        <JunctionOverlay junctions={wireMarks.junctions} crossings={wireMarks.crossings} />
      </ReactFlow>
    </div>
  );
}
