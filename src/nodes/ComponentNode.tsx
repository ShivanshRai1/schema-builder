import { useEffect, useMemo } from "react";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
  type Node,
} from "@xyflow/react";
import type { ComponentData, ComponentKind, PinSpec } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import { isPaletteDrag, PALETTE_DND_MIME } from "../dnd";
import { normalizeRotation, rotatePinSpec } from "../model/rotation";

// ---------------------------------------------------------------------------
// Pins are invisible hit-targets (LTspice-like). Handle `id` is the pin id —
// netlist/wiring never depend on geometry.
// ---------------------------------------------------------------------------

const sideToPosition: Record<PinSpec["side"], Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

function handleStyle(pin: PinSpec): React.CSSProperties {
  const pct = `${pin.offset * 100}%`;
  switch (pin.side) {
    case "left":
    case "right":
      return { top: pct };
    case "top":
    case "bottom":
      return { left: pct };
  }
}

export function ComponentNode({
  id,
  data,
  selected,
  onReplace,
  onPinClick,
}: NodeProps<Node<ComponentData>> & {
  onReplace?: (nodeId: string, kind: ComponentKind) => void;
  onPinClick?: (nodeId: string, pinId: string) => void;
}) {
  const spec = COMPONENT_SPECS[data.kind];
  const updateNodeInternals = useUpdateNodeInternals();
  const paramText = data.params.value ?? data.params.model ?? data.params.name ?? "";
  const unplaced = Boolean(data.unplaced);
  const rotation = normalizeRotation(data.rotation);
  const pins = useMemo(
    () => spec.pins.map((p) => rotatePinSpec(p, rotation)),
    [spec.pins, rotation],
  );
  const isTip = data.kind === "TIP";
  // Include side/offset so RF re-registers handles when rotation remaps geometry.
  const pinLayoutKey = pins.map((p) => `${p.id}:${p.side}:${p.offset}`).join("|");

  // Remeasure handle bounds after orientation changes (labels can move before RF bounds do).
  useEffect(() => {
    updateNodeInternals(id);
    const raf = window.requestAnimationFrame(() => updateNodeInternals(id));
    const t0 = window.setTimeout(() => updateNodeInternals(id), 0);
    const t1 = window.setTimeout(() => updateNodeInternals(id), 32);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t0);
      window.clearTimeout(t1);
    };
  }, [id, rotation, pinLayoutKey, updateNodeInternals]);

  return (
    <div
      className={`component-node kind-${data.kind}${selected ? " selected" : ""}${unplaced ? " unplaced" : ""}${isTip ? " tip-node" : ""}`}
      title={
        isTip
          ? "Wire end — click to continue wiring"
          : unplaced
            ? "Unplaced — drag to set position"
            : undefined
      }
      onDragOver={(e) => {
        if (isTip || !isPaletteDrag(e.dataTransfer) || !onReplace) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        if (isTip || !onReplace) return;
        e.preventDefault();
        e.stopPropagation();
        const kind = e.dataTransfer.getData(PALETTE_DND_MIME) as ComponentKind;
        if (!kind || !COMPONENT_SPECS[kind] || kind === "TIP") return;
        onReplace(id, kind);
      }}
    >
      {!isTip && (
        <>
          <div
            className="component-glyph"
            style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined }
          >
            {spec.glyph}
          </div>
          <div className="component-refdes">{data.refdes || spec.label}</div>
          {paramText && <div className="component-params">{paramText}</div>}
          {unplaced && <div className="component-unplaced">unplaced</div>}
        </>
      )}

      {pins.map((pin) => (
        <Handle
          key={`${pin.id}-${pin.side}-${pin.offset}-${rotation}`}
          id={pin.id}
          type="source"
          position={sideToPosition[pin.side]}
          style={handleStyle(pin)}
          className={`component-pin${isTip ? " tip-pin" : ""}`}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            if (!onPinClick) return;
            e.stopPropagation();
            e.preventDefault();
            onPinClick(id, pin.id);
          }}
        >
          {!isTip && pin.label ? (
            <span className="pin-label">{pin.label}</span>
          ) : null}
        </Handle>
      ))}
    </div>
  );
}
