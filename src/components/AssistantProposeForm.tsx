import type { Op } from "../llm/ops";
import type { AssistantContext } from "../llm/assistantTypes";
import type { ComponentKind } from "../model/types";
import { COMPONENT_SPECS } from "../model/componentSpecs";

/** Kinds the user can pick when editing an add-component proposal. */
const ADDABLE_KINDS = (Object.keys(COMPONENT_SPECS) as ComponentKind[]).filter(
  (k) => k !== "TIP",
);

function pinsFor(
  context: AssistantContext,
  refdes: string,
): string[] {
  const want = refdes.trim().toUpperCase();
  const hit = context.components.find((c) => c.refdes.toUpperCase() === want);
  if (hit?.pins?.length) return hit.pins;
  if (hit) return COMPONENT_SPECS[hit.kind].pins.map((p) => p.id);
  return [];
}

function summarize(op: Op): string {
  switch (op.type) {
    case "addComponent":
      return `Add ${COMPONENT_SPECS[op.kind]?.label ?? op.kind}${op.params?.value ? ` (${op.params.value})` : ""}`;
    case "setParam":
      return `Set ${op.refdes} ${op.key}`;
    case "deleteComponent":
      return `Remove ${op.refdes}`;
    case "connectPins":
      return `Connect ${op.aRefdes}${op.aPin ? `.${op.aPin}` : ""} → ${op.bRefdes}${op.bPin ? `.${op.bPin}` : ""}`;
    case "disconnectPins":
      return `Disconnect ${op.aRefdes}${op.aPin ? `.${op.aPin}` : ""}`;
  }
}

/**
 * Editable confirmation form for assistant-proposed circuit ops.
 * Does not apply anything itself — parent calls onApply / onCancel.
 */
export function AssistantProposeForm({
  ops,
  context,
  onChange,
  onApply,
  onCancel,
}: {
  ops: Op[];
  context: AssistantContext;
  onChange: (ops: Op[]) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  function update(i: number, next: Op) {
    onChange(ops.map((op, idx) => (idx === i ? next : op)));
  }

  function remove(i: number) {
    onChange(ops.filter((_, idx) => idx !== i));
  }

  return (
    <div className="propose-form">
      <div className="propose-form-header">
        Review changes — edit fields, then Apply
      </div>
      <div className="propose-form-rows">
        {ops.map((op, i) => (
          <div key={i} className="propose-form-row">
            <div className="propose-form-label">{summarize(op)}</div>
            <div className="propose-form-fields">
              {op.type === "addComponent" && (
                <>
                  <label className="propose-field">
                    <span>Kind</span>
                    <select
                      value={op.kind}
                      onChange={(e) =>
                        update(i, {
                          type: "addComponent",
                          kind: e.target.value as ComponentKind,
                          ...(op.params ? { params: op.params } : {}),
                        })
                      }
                    >
                      {ADDABLE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {COMPONENT_SPECS[k].label} ({k})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="propose-field">
                    <span>Value</span>
                    <input
                      value={op.params?.value ?? ""}
                      placeholder="e.g. 10k"
                      onChange={(e) => {
                        const value = e.target.value.trim();
                        const params = { ...(op.params ?? {}) };
                        if (value) params.value = value;
                        else delete params.value;
                        update(i, {
                          type: "addComponent",
                          kind: op.kind,
                          ...(Object.keys(params).length ? { params } : {}),
                        });
                      }}
                    />
                  </label>
                </>
              )}

              {op.type === "setParam" && (
                <>
                  <label className="propose-field">
                    <span>Part</span>
                    <input
                      value={op.refdes}
                      onChange={(e) =>
                        update(i, { ...op, refdes: e.target.value })
                      }
                    />
                  </label>
                  <label className="propose-field">
                    <span>Param</span>
                    <input
                      value={op.key}
                      onChange={(e) =>
                        update(i, { ...op, key: e.target.value })
                      }
                    />
                  </label>
                  <label className="propose-field">
                    <span>Value</span>
                    <input
                      value={op.value}
                      onChange={(e) =>
                        update(i, { ...op, value: e.target.value })
                      }
                    />
                  </label>
                </>
              )}

              {op.type === "deleteComponent" && (
                <label className="propose-field">
                  <span>Part</span>
                  <input
                    value={op.refdes}
                    onChange={(e) =>
                      update(i, { type: "deleteComponent", refdes: e.target.value })
                    }
                  />
                </label>
              )}

              {op.type === "connectPins" && (
                <>
                  <label className="propose-field">
                    <span>From</span>
                    <input
                      value={op.aRefdes}
                      onChange={(e) =>
                        update(i, { ...op, aRefdes: e.target.value })
                      }
                    />
                  </label>
                  <label className="propose-field">
                    <span>Pin</span>
                    <PinSelect
                      value={op.aPin ?? ""}
                      options={pinsFor(context, op.aRefdes)}
                      onChange={(aPin) =>
                        update(i, { ...op, aPin: aPin || undefined })
                      }
                    />
                  </label>
                  <label className="propose-field">
                    <span>To</span>
                    <input
                      value={op.bRefdes}
                      onChange={(e) =>
                        update(i, { ...op, bRefdes: e.target.value })
                      }
                    />
                  </label>
                  <label className="propose-field">
                    <span>Pin</span>
                    <PinSelect
                      value={op.bPin ?? ""}
                      options={pinsFor(context, op.bRefdes)}
                      onChange={(bPin) =>
                        update(i, { ...op, bPin: bPin || undefined })
                      }
                    />
                  </label>
                </>
              )}

              {op.type === "disconnectPins" && (
                <>
                  <label className="propose-field">
                    <span>Part</span>
                    <input
                      value={op.aRefdes}
                      onChange={(e) =>
                        update(i, { ...op, aRefdes: e.target.value })
                      }
                    />
                  </label>
                  <label className="propose-field">
                    <span>Pin</span>
                    <PinSelect
                      value={op.aPin ?? ""}
                      options={pinsFor(context, op.aRefdes)}
                      onChange={(aPin) =>
                        update(i, { ...op, aPin: aPin || undefined })
                      }
                    />
                  </label>
                  <label className="propose-field">
                    <span>Other (opt)</span>
                    <input
                      value={op.bRefdes ?? ""}
                      onChange={(e) =>
                        update(i, {
                          ...op,
                          bRefdes: e.target.value || undefined,
                        })
                      }
                    />
                  </label>
                </>
              )}

              <button
                type="button"
                className="propose-remove"
                title="Remove this change"
                onClick={() => remove(i)}
              >
                ×
              </button>
            </div>
          </div>
        ))}
        {!ops.length && (
          <div className="propose-form-empty">No changes left — Cancel or ask again.</div>
        )}
      </div>
      <div className="propose-form-actions">
        <button type="button" className="propose-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="propose-apply"
          disabled={!ops.length}
          onClick={onApply}
        >
          Apply to schematic
        </button>
      </div>
    </div>
  );
}

function PinSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  if (!options.length) {
    return (
      <input
        value={value}
        placeholder="auto"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">auto</option>
      {options.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );
}
