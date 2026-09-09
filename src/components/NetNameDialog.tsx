import { useEffect, useRef, useState } from "react";

/**
 * Prompt before stamp-placing net names (LTspice Label Net style).
 * OK enters placement; Cancel leaves the canvas alone.
 */
export function NetNameDialog({
  initialName,
  onOk,
  onCancel,
}: {
  initialName: string;
  onOk: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const trimmed = name.trim().replace(/\s+/g, "_");
        if (trimmed) onOk(trimmed);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [name, onOk, onCancel]);

  const submit = () => {
    const trimmed = name.trim().replace(/\s+/g, "_");
    if (trimmed) onOk(trimmed);
  };

  return (
    <div className="comp-props-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="comp-props-dialog net-name-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Net name"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="comp-props-titlebar">
          <span className="comp-props-title">Net name</span>
        </div>
        <div className="comp-props-body">
          <p className="comp-props-sub">
            Type a name, then stamp it on the schematic (same name joins those nets).
          </p>
          <label className="prop-field">
            <span className="prop-label">Name</span>
            <input
              ref={inputRef}
              className="prop-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
        </div>
        <div className="comp-props-footer">
          <div className="comp-props-footer-left" />
          <div className="comp-props-actions">
            <button
              type="button"
              className="comp-props-btn primary"
              disabled={!name.trim()}
              onClick={submit}
            >
              OK
            </button>
            <button type="button" className="comp-props-btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
