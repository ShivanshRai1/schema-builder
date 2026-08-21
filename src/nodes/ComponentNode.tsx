import { useEffect, useLayoutEffect, useMemo } from "react";
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
import { getSymbolLayout, hasSymbol } from "./symbols/layout";
import { SchematicSymbol } from "./symbols/SchematicSymbols";

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

/** Put refdes/value on the side that has no pin — so wires don't run through text. */
function labelAnchor(pins: PinSpec[]): "above" | "right" {
  const sides = new Set(pins.map((p) => p.side));
  if (sides.has("left") && sides.has("right")) return "above";
  return "right";
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
  const isSymbol = hasSymbol(data.kind);
  const symLayout = isSymbol ? getSymbolLayout(data.kind, rotation) : null;
  const pinLayoutKey = pins.map((p) => `${p.id}:${p.side}:${p.offset}`).join("|");
  const labelsClass = isSymbol ? `symbol-labels labels-${labelAnchor(pins)}` : "symbol-labels";

  useLayoutEffect(() => {
    updateNodeInternals(id);
  }, [id, rotation, pinLayoutKey, updateNodeInternals]);

  useEffect(() => {
    const t = window.setTimeout(() => updateNodeInternals(id), 0);
    return () => window.clearTimeout(t);
  }, [id, rotation, pinLayoutKey, updateNodeInternals]);

  return (
    <div
      className={`component-node${isSymbol ? " symbol-node" : ""}${isSymbol ? ` sym-labels-${labelAnchor(pins)}` : ""} kind-${data.kind}${selected ? " selected" : ""}${unplaced ? " unplaced" : ""}${isTip ? " tip-node" : ""}`}
      style={
        symLayout
          ? { width: symLayout.w, height: symLayout.h, minHeight: symLayout.h }
          : undefined
      }
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
      {!isTip && isSymbol && (
        <>
          <div
            className="symbol-body"
            style={{
              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            }}
          >
            <SchematicSymbol kind={data.kind} selected={selected} rotation={rotation} />
          </div>
          <div className={labelsClass}>
            <div className="component-refdes">{data.refdes || spec.label}</div>
            {paramText && <div className="component-params">{paramText}</div>}
            {unplaced && <div className="component-unplaced">unplaced</div>}
          </div>
        </>
      )}
      {!isTip && !isSymbol && (
        <>
          <div
            className="component-glyph"
            style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
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
          className={`component-pin pin-side-${pin.side}${isTip ? " tip-pin" : ""}`}
          onClick={(e) => {
            if (!onPinClick) return;
            e.stopPropagation();
            e.preventDefault();
            onPinClick(id, pin.id);
          }}
        >
          {!isTip && !isSymbol && pin.label ? (
            <span className="pin-label">{pin.label}</span>
          ) : null}
        </Handle>
      ))}
    </div>
  );
}
