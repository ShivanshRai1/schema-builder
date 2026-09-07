import { useMemo, useState } from "react";
import type { Op } from "../llm/ops";
import type { AssistantContext } from "../llm/assistantTypes";
import { COMPONENT_SPECS, isGroundKind } from "../model/componentSpecs";

/**
 * Live device table for the interactive netlist: edit values, apply one row
 * at a time via the same applyOpsSafe path (no canvas/wiring changes).
 */
export function DeviceTable({
  context,
  onApplyOps,
}: {
  context: AssistantContext;
  onApplyOps: (ops: Op[]) => void;
}) {
  const rows = useMemo(
    () =>
      context.components.filter(
        (c) => c.kind !== "TIP" && !isGroundKind(c.kind) && c.kind !== "NODE" && c.kind !== "WIRELABEL",
      ),
    [context.components],
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (!rows.length) {
    return (
      <div className="device-table">
        <div className="device-table-header">Devices</div>
        <div className="device-table-empty">No devices yet — add parts on the canvas or via chat.</div>
      </div>
    );
  }

  return (
    <div className="device-table">
      <div className="device-table-header">Devices</div>
      <div className="device-table-rows">
        {rows.map((c) => {
          const label = COMPONENT_SPECS[c.kind]?.label ?? c.kind;
          const current = c.params.value ?? c.params.model ?? "";
          const draft = drafts[c.refdes] ?? current;
          const dirty = draft.trim() !== current.trim();
          return (
            <div key={c.refdes} className="device-table-row">
              <span className="device-ref">{c.refdes}</span>
              <span className="device-kind">{label}</span>
              <input
                className="device-value"
                value={draft}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [c.refdes]: e.target.value }))
                }
              />
              <button
                type="button"
                className="device-apply"
                disabled={!dirty || !draft.trim()}
                onClick={() => {
                  onApplyOps([
                    {
                      type: "setParam",
                      refdes: c.refdes,
                      key: "value",
                      value: draft.trim(),
                    },
                  ]);
                  setDrafts((d) => {
                    const next = { ...d };
                    delete next[c.refdes];
                    return next;
                  });
                }}
              >
                Apply
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
