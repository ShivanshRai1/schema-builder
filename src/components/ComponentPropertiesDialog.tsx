import { useEffect, useMemo, useRef, useState } from "react";
import type { Node } from "@xyflow/react";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import type { ComponentData, ComponentRotation, LabelPosition } from "../model/types";
import { normalizeRotation, nextRotation } from "../model/rotation";
import { hasSymbol } from "../nodes/symbols/layout";

const LABEL_POSITION_OPTIONS: { value: LabelPosition; label: string }[] = [
  { value: "auto", label: "Auto (avoid pins)" },
  { value: "above", label: "Above" },
  { value: "below", label: "Below" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "hidden", label: "Hidden" },
];

export type ComponentPropsDraft = {
  refdes: string;
  params: Record<string, string>;
  labelPos: LabelPosition;
  rotation: ComponentRotation;
};

function draftFromNode(node: Node<ComponentData>): ComponentPropsDraft {
  const spec = COMPONENT_SPECS[node.data.kind];
  const params: Record<string, string> = {};
  for (const attr of spec.attributes) {
    params[attr.key] = node.data.params[attr.key] ?? attr.default;
  }
  return {
    refdes: node.data.refdes,
    params,
    labelPos: node.data.labelPos ?? "auto",
    rotation: normalizeRotation(node.data.rotation),
  };
}

/**
 * LTspice-style component properties dialog.
 * Opens on right-click; edits are drafted until OK (Cancel discards).
 */
export function ComponentPropertiesDialog({
  node,
  anchor,
  onApply,
  onCancel,
  onRotateLive,
  onDelete,
}: {
  node: Node<ComponentData>;
  /** Screen position near the right-click. */
  anchor: { x: number; y: number };
  onApply: (nodeId: string, draft: ComponentPropsDraft) => void;
  onCancel: () => void;
  /** Immediate 90° rotate on the live node (LTspice-like); also updates draft. */
  onRotateLive?: (nodeId: string) => void;
  onDelete?: (nodeId: string) => void;
}) {
  const spec = COMPONENT_SPECS[node.data.kind];
  const [draft, setDraft] = useState(() => draftFromNode(node));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const firstFieldRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    setDraft(draftFromNode(node));
  }, [node.id, node.data.kind]);

  useEffect(() => {
    const el = firstFieldRef.current;
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
  }, [node.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        const t = e.target as HTMLElement | null;
        if (t?.tagName === "TEXTAREA" || t?.tagName === "SELECT") return;
        e.preventDefault();
        onApply(node.id, draftRef.current);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [node.id, onApply, onCancel]);

  const position = useMemo(() => {
    const w = 340;
    const h = 360;
    const pad = 12;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    return {
      left: Math.max(pad, Math.min(anchor.x + 8, vw - w - pad)),
      top: Math.max(pad, Math.min(anchor.y + 8, vh - h - pad)),
      width: w,
    };
  }, [anchor.x, anchor.y]);

  const title =
    spec.refdesPrefix !== ""
      ? `${spec.label.replace(/\n/g, " ")} — ${draft.refdes || node.data.refdes}`
      : spec.label.replace(/\n/g, " ");

  const showLabelPos = hasSymbol(node.data.kind);
  const showRefdes = spec.refdesPrefix !== "";

  return (
    <div className="comp-props-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="comp-props-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ left: position.left, top: position.top, width: position.width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="comp-props-titlebar">
          <span className="comp-props-title">{title}</span>
          <div className="comp-props-actions">
            <button
              type="button"
              className="comp-props-btn primary"
              onClick={() => onApply(node.id, draft)}
            >
              OK
            </button>
            <button type="button" className="comp-props-btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>

        <div className="comp-props-body">
          {showRefdes && (
            <label className="prop-field">
              <span className="prop-label">Reference designator</span>
              <input
                ref={firstFieldRef as React.RefObject<HTMLInputElement>}
                className="prop-input"
                value={draft.refdes}
                onChange={(e) => setDraft((d) => ({ ...d, refdes: e.target.value }))}
              />
            </label>
          )}

          {spec.attributes.map((attr, i) => {
            const value = draft.params[attr.key] ?? attr.default;
            const isFirst = !showRefdes && i === 0;
            return (
              <label className="prop-field" key={attr.key}>
                <span className="prop-label">
                  {attr.label}
                  {attr.unit ? <span className="prop-unit"> ({attr.unit})</span> : null}
                </span>
                {attr.type === "select" ? (
                  <select
                    ref={isFirst ? (firstFieldRef as React.RefObject<HTMLSelectElement>) : undefined}
                    className="prop-input"
                    value={value}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        params: { ...d.params, [attr.key]: e.target.value },
                      }))
                    }
                  >
                    {(attr.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    ref={isFirst ? (firstFieldRef as React.RefObject<HTMLInputElement>) : undefined}
                    className="prop-input"
                    type={attr.type === "number" ? "number" : "text"}
                    value={value}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        params: { ...d.params, [attr.key]: e.target.value },
                      }))
                    }
                  />
                )}
                {attr.hint ? <span className="prop-hint">{attr.hint}</span> : null}
              </label>
            );
          })}

          {showLabelPos && (
            <label className="prop-field">
              <span className="prop-label">Label position</span>
              <select
                className="prop-input"
                value={draft.labelPos}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    labelPos: e.target.value as LabelPosition,
                  }))
                }
              >
                {LABEL_POSITION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {spec.attributes.length === 0 && !showRefdes && !showLabelPos && (
            <div className="props-empty">This element has no editable attributes.</div>
          )}

          <div className="comp-props-extra">
            {onRotateLive && (
              <button
                type="button"
                className="comp-props-btn"
                title="Rotate 90° clockwise"
                onClick={() => {
                  onRotateLive(node.id);
                  setDraft((d) => ({ ...d, rotation: nextRotation(d.rotation) }));
                }}
              >
                Rotate {draft.rotation}°
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="comp-props-btn danger"
                onClick={() => onDelete(node.id)}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
