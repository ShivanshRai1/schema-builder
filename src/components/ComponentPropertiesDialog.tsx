import { useEffect, useMemo, useRef, useState } from "react";
import type { Node } from "@xyflow/react";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import type { ComponentData, ComponentRotation, LabelPosition } from "../model/types";
import { normalizeRotation, nextLabelRotation, nextRotation } from "../model/rotation";
import { hasSymbol } from "../nodes/symbols/layout";

const LABEL_POSITION_OPTIONS: { value: LabelPosition; label: string }[] = [
  { value: "auto", label: "Auto (avoid pins)" },
  { value: "above", label: "Above" },
  { value: "below", label: "Below" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "hidden", label: "Hidden" },
];

type VoltageStimKind = "DC" | "AC" | "CUSTOM";

function parseVoltageStimulus(raw: string): {
  kind: VoltageStimKind;
  magnitude: string;
  custom: string;
} {
  const t = raw.trim();
  const typed = /^(DC|AC)\s+(.+)$/i.exec(t);
  if (typed) {
    return {
      kind: typed[1]!.toUpperCase() as "DC" | "AC",
      magnitude: typed[2]!.trim(),
      custom: t,
    };
  }
  // Bare number / engineering suffix → treat as DC magnitude.
  if (t && /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[a-zA-Z]*$/.test(t)) {
    return { kind: "DC", magnitude: t, custom: t };
  }
  if (!t || /^v$/i.test(t)) {
    return { kind: "DC", magnitude: "V", custom: t || "V" };
  }
  return { kind: "CUSTOM", magnitude: "", custom: t };
}

function composeVoltageStimulus(
  kind: VoltageStimKind,
  magnitude: string,
  custom: string,
): string {
  if (kind === "CUSTOM") {
    const c = custom.trim();
    return c || "V";
  }
  const mag = magnitude.trim();
  // Keep the schematic default as plain "V" until a real magnitude is entered.
  if (!mag || /^v$/i.test(mag)) return kind === "DC" ? "V" : `${kind} 0`;
  return `${kind} ${mag}`;
}

function VoltageValueFields({
  value,
  onChange,
  inputRef,
}: {
  value: string;
  onChange: (next: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | HTMLSelectElement | null>;
}) {
  const parsed = parseVoltageStimulus(value);
  const [kind, setKind] = useState<VoltageStimKind>(parsed.kind);
  const [magnitude, setMagnitude] = useState(parsed.magnitude);
  const [custom, setCustom] = useState(parsed.custom);

  // Re-sync when opening another node / external draft reset.
  useEffect(() => {
    const next = parseVoltageStimulus(value);
    setKind(next.kind);
    setMagnitude(next.magnitude);
    setCustom(next.custom);
  }, [value]);

  const commit = (
    nextKind: VoltageStimKind,
    nextMag: string,
    nextCustom: string,
  ) => {
    onChange(composeVoltageStimulus(nextKind, nextMag, nextCustom));
  };

  return (
    <div className="prop-field prop-voltage-value">
      <span className="prop-label">Value</span>
      <div className="prop-voltage-row">
        <select
          className="prop-input prop-voltage-type"
          value={kind}
          aria-label="Voltage type"
          onChange={(e) => {
            const nextKind = e.target.value as VoltageStimKind;
            setKind(nextKind);
            if (nextKind === "CUSTOM") {
              const seed =
                custom.trim() ||
                (magnitude.trim() && !/^v$/i.test(magnitude.trim())
                  ? `${kind} ${magnitude.trim()}`
                  : "V");
              setCustom(seed);
              commit("CUSTOM", magnitude, seed);
            } else {
              const mag = magnitude.trim() || "V";
              setMagnitude(mag);
              commit(nextKind, mag, custom);
            }
          }}
        >
          <option value="DC">DC</option>
          <option value="AC">AC</option>
          <option value="CUSTOM">Any (PULSE, SIN, …)</option>
        </select>
        {kind === "CUSTOM" ? (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            className="prop-input prop-voltage-mag"
            value={custom}
            placeholder="PULSE(0 5 0 1n 1n 5u 10u)"
            onChange={(e) => {
              setCustom(e.target.value);
              commit("CUSTOM", magnitude, e.target.value);
            }}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            className="prop-input prop-voltage-mag"
            value={/^v$/i.test(magnitude.trim()) ? "V" : magnitude}
            placeholder="V"
            onChange={(e) => {
              const next = e.target.value;
              setMagnitude(next);
              commit(kind, next, custom);
            }}
          />
        )}
      </div>
      <span className="prop-hint">
        {kind === "CUSTOM"
          ? "Full SPICE stimulus, e.g. PULSE(0 5 0 1n 1n 5u 10u) or SIN(0 1 1k)"
          : `${kind} voltage — enter the magnitude (unit V)`}
      </span>
    </div>
  );
}

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
    let v = node.data.params[attr.key] ?? attr.default;
    // Old voltage-source factory default was "DC 12" — show "V" instead.
    if (node.data.kind === "V" && attr.key === "value") {
      const t = String(v).trim();
      if (!t || /^DC\s*12$/i.test(t)) v = "V";
    }
    params[attr.key] = v;
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
              <span className="prop-label">Name</span>
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

            // Voltage source: type (DC / AC / custom) + magnitude.
            if (node.data.kind === "V" && attr.key === "value") {
              return (
                <VoltageValueFields
                  key={attr.key}
                  value={value}
                  inputRef={isFirst ? firstFieldRef : undefined}
                  onChange={(next) =>
                    setDraft((d) => ({
                      ...d,
                      params: { ...d.params, value: next },
                    }))
                  }
                />
              );
            }

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
                  setDraft((d) => ({
                    ...d,
                    rotation:
                      node.data.kind === "WIRELABEL"
                        ? nextLabelRotation(d.rotation)
                        : nextRotation(d.rotation),
                  }));
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
