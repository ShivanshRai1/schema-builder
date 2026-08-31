import { useEffect, useLayoutEffect, useMemo } from "react";
import {
  Handle,
  Position,
  useStore,
  useUpdateNodeInternals,
  type NodeProps,
  type Node,
} from "@xyflow/react";
import type { ComponentData, ComponentKind, PinSpec } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import { isPaletteDrag, PALETTE_DND_MIME } from "../dnd";
import { normalizeRotation, rotatePinSpec } from "../model/rotation";
import { getSymbolLayout, getLabelInkAnchorX, hasSymbol } from "./symbols/layout";
import { SchematicSymbol } from "./symbols/SchematicSymbols";
import { resolveLabelLayout } from "./labelPosition";

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
  /** Values on canvas; model names live in Properties / tooltip only. */
  const isNetLabel = data.kind === "NODE";
  /** Net labels show the net name only — never the generic "Net label" title on the flag. */
  const displayRefdes = isNetLabel
    ? (data.params.name || "net")
    : data.refdes || spec.label;
  const symbolSecondary = isNetLabel
    ? ""
    : data.params.value ?? data.params.name ?? "";
  const symbolTooltip = [data.refdes || spec.label, paramText].filter(Boolean).join(" · ");
  const unplaced = Boolean(data.unplaced);
  const rotation = normalizeRotation(data.rotation);
  const pins = useMemo(
    () => spec.pins.map((p) => rotatePinSpec(p, rotation)),
    [spec.pins, rotation],
  );
  const isTip = data.kind === "TIP";
  const tipDegree = useStore((s) => {
    if (!isTip) return 0;
    let n = 0;
    for (const e of s.edges) {
      if (e.source === id || e.target === id) n++;
    }
    return n;
  });
  const tipJunction = isTip && tipDegree >= 2;
  const tipFree = isTip && tipDegree <= 1;
  const isSymbol = hasSymbol(data.kind);
  const symLayout = isSymbol ? getSymbolLayout(data.kind, rotation) : null;
  const pinLayoutKey = pins.map((p) => `${p.id}:${p.side}:${p.offset}`).join("|");
  const labelLayout = resolveLabelLayout(pins, data.labelPos);
  const symLabelsClass =
    labelLayout.mode === "split"
      ? `symbol-labels-split labels-split-${labelLayout.side}`
      : labelLayout.mode === "block"
        ? `symbol-labels labels-${labelLayout.side}`
        : "symbol-labels labels-hidden";
  const nodeLabelsClass =
    labelLayout.mode === "split"
      ? ` sym-labels-split-${labelLayout.side}`
      : labelLayout.mode === "block"
        ? ` sym-labels-${labelLayout.side}`
        : "";

  useLayoutEffect(() => {
    updateNodeInternals(id);
  }, [id, rotation, pinLayoutKey, updateNodeInternals]);

  useEffect(() => {
    const t = window.setTimeout(() => updateNodeInternals(id), 0);
    return () => window.clearTimeout(t);
  }, [id, rotation, pinLayoutKey, updateNodeInternals]);

  return (
    <div
      className={`component-node${isSymbol ? " symbol-node" : ""}${isSymbol ? nodeLabelsClass : ""} kind-${data.kind}${selected ? " selected" : ""}${unplaced ? " unplaced" : ""}${isTip ? " tip-node" : ""}${tipJunction ? " tip-junction" : ""}${tipFree ? " tip-free" : ""}`}
      style={
        symLayout
          ? {
              width: symLayout.w,
              height: symLayout.h,
              minHeight: symLayout.h,
              ["--label-x" as string]: `${getLabelInkAnchorX(data.kind) * 100}%`,
            }
          : undefined
      }
      title={
        tipFree
          ? selected
            ? "Wire end selected — press Delete to remove"
            : "Wire end — scissors, or select and press Delete"
          : tipJunction
            ? undefined
          : unplaced
            ? "Unplaced — drag to set position"
            : isSymbol && !isTip
              ? symbolTooltip
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
          {labelLayout.mode === "split" ? (
            <div className={symLabelsClass}>
              <div
                className="label-refdes"
                style={{ top: `${labelLayout.refdesY * 100}%` }}
              >
                {displayRefdes}
              </div>
              {symbolSecondary ? (
                <div
                  className="label-value"
                  style={{ top: `${labelLayout.valueY * 100}%` }}
                >
                  {symbolSecondary}
                </div>
              ) : null}
              {unplaced ? <div className="label-unplaced">unplaced</div> : null}
            </div>
          ) : labelLayout.mode === "block" ? (
            <div className={symLabelsClass}>
              <div className="component-refdes">{displayRefdes}</div>
              {symbolSecondary ? <div className="component-params">{symbolSecondary}</div> : null}
              {unplaced && <div className="component-unplaced">unplaced</div>}
            </div>
          ) : null}
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
      {tipFree && selected ? (
        <div className="tip-delete-hint" role="status">
          Wire end · <kbd>Delete</kbd>
        </div>
      ) : null}
    </div>
  );
}
