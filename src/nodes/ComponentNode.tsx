import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { ComponentData, ComponentKind, PinSpec } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import { isPaletteDrag, PALETTE_DND_MIME } from "../dnd";
import { normalizeRotation, rotatePinSpec } from "../model/rotation";

// ---------------------------------------------------------------------------
// One generic node component renders EVERY component family by reading its
// spec. Pins become React Flow Handles positioned from the spec's side/offset
// (remapped by optional node.data.rotation). Handle `id` stays the pin id —
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
}: NodeProps<Node<ComponentData>> & {
  onReplace?: (nodeId: string, kind: ComponentKind) => void;
}) {
  const spec = COMPONENT_SPECS[data.kind];
  // Show one concise value under the refdes: value, else model, else name.
  const paramText = data.params.value ?? data.params.model ?? data.params.name ?? "";
  const unplaced = Boolean(data.unplaced);
  const rotation = normalizeRotation(data.rotation);
  const pins = spec.pins.map((p) => rotatePinSpec(p, rotation));

  return (
    <div
      className={`component-node kind-${data.kind}${selected ? " selected" : ""}${unplaced ? " unplaced" : ""}`}
      title={unplaced ? "Unplaced — drag to set position" : undefined}
      onDragOver={(e) => {
        if (!isPaletteDrag(e.dataTransfer) || !onReplace) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        if (!onReplace) return;
        e.preventDefault();
        e.stopPropagation();
        const kind = e.dataTransfer.getData(PALETTE_DND_MIME) as ComponentKind;
        if (!kind || !COMPONENT_SPECS[kind]) return;
        onReplace(id, kind);
      }}
    >
      <div
        className="component-glyph"
        style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
      >
        {spec.glyph}
      </div>
      <div className="component-refdes">{data.refdes || spec.label}</div>
      {paramText && <div className="component-params">{paramText}</div>}
      {unplaced && <div className="component-unplaced">unplaced</div>}

      {pins.map((pin) => (
        <Handle
          key={pin.id}
          id={pin.id}
          type="source" // xyflow: a single "source" handle can both start and receive wires
          position={sideToPosition[pin.side]}
          style={handleStyle(pin)}
          className="component-pin"
        >
          {pin.label && <span className="pin-label">{pin.label}</span>}
        </Handle>
      ))}
    </div>
  );
}
