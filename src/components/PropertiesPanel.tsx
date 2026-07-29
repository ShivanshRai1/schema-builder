import type { Node } from "@xyflow/react";
import { COMPONENT_SPECS } from "../model/componentSpecs";
import type { ComponentData } from "../model/types";

// ---------------------------------------------------------------------------
// Attribute editor. Renders inputs from the selected component's declared
// `attributes` schema and writes changes back into node.data.params (the graph
// is the source of truth). Also lets the user edit the refdes.
//
// "Ask users for attributes of components" = this panel. New attributes appear
// automatically for any component whose spec declares them — no code here.
// ---------------------------------------------------------------------------

export function PropertiesPanel({
  node,
  onChangeParam,
  onChangeRefdes,
  onDelete,
}: {
  node: Node<ComponentData> | null;
  onChangeParam: (nodeId: string, key: string, value: string) => void;
  onChangeRefdes: (nodeId: string, refdes: string) => void;
  onDelete: (nodeId: string) => void;
}) {
  if (!node) {
    return (
      <div className="props-panel">
        <div className="panel-header"><span>properties</span></div>
        <div className="props-empty">Select a component to edit its attributes.</div>
      </div>
    );
  }

  const spec = COMPONENT_SPECS[node.data.kind];

  return (
    <div className="props-panel">
      <div className="panel-header">
        <span>{spec.label}</span>
        <button className="ghost-btn danger" onClick={() => onDelete(node.id)}>delete</button>
      </div>

      <div className="props-body">
        {spec.refdesPrefix !== "" && (
          <label className="prop-field">
            <span className="prop-label">Reference designator</span>
            <input
              className="prop-input"
              value={node.data.refdes}
              onChange={(e) => onChangeRefdes(node.id, e.target.value)}
            />
          </label>
        )}

        {spec.attributes.length === 0 && spec.refdesPrefix === "" && (
          <div className="props-empty">This element has no editable attributes.</div>
        )}

        {spec.attributes.map((attr) => {
          const value = node.data.params[attr.key] ?? attr.default;
          return (
            <label className="prop-field" key={attr.key}>
              <span className="prop-label">
                {attr.label}
                {attr.unit ? <span className="prop-unit"> ({attr.unit})</span> : null}
              </span>
              {attr.type === "select" ? (
                <select
                  className="prop-input"
                  value={value}
                  onChange={(e) => onChangeParam(node.id, attr.key, e.target.value)}
                >
                  {(attr.options ?? []).map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="prop-input"
                  type={attr.type === "number" ? "number" : "text"}
                  value={value}
                  onChange={(e) => onChangeParam(node.id, attr.key, e.target.value)}
                />
              )}
              {attr.hint ? <span className="prop-hint">{attr.hint}</span> : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}
