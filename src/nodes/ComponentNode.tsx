import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { ComponentData, PinSpec } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";

// ---------------------------------------------------------------------------
// One generic node component renders EVERY component family by reading its
// spec. Pins become React Flow Handles positioned from the spec's side/offset.
// Handles are the wiring anchors; their `id` is the pin id, which is what the
// net extractor keys on.
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

export function ComponentNode({ data, selected }: NodeProps<Node<ComponentData>>) {
  const spec = COMPONENT_SPECS[data.kind];
  // Show one concise value under the refdes: value, else model, else name.
  const paramText = data.params.value ?? data.params.model ?? data.params.name ?? "";

  return (
    <div className={`component-node kind-${data.kind}${selected ? " selected" : ""}`}>
      <div className="component-glyph">{spec.glyph}</div>
      <div className="component-refdes">{data.refdes || spec.label}</div>
      {paramText && <div className="component-params">{paramText}</div>}

      {spec.pins.map((pin) => (
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
