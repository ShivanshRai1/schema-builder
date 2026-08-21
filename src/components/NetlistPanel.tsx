import Editor, { type OnMount } from "@monaco-editor/react";
import { spiceLanguageId } from "../monaco/spiceLanguage";

// ---------------------------------------------------------------------------
// Monaco panel showing the live, generated netlist.
//
// Default: read-only projection of the graph.
// Step-2: "edit as text" → draft → Apply syncs into the graph by refdes.
// ---------------------------------------------------------------------------

export function NetlistPanel({
  netlist,
  editing,
  draft,
  status,
  onStartEdit,
  onDraftChange,
  onApply,
  onCancel,
  onPopOut,
}: {
  netlist: string;
  editing: boolean;
  draft: string;
  status?: string | null;
  onStartEdit: () => void;
  onDraftChange: (text: string) => void;
  onApply: () => void;
  onCancel: () => void;
  onPopOut?: () => void;
}) {
  const onMount: OnMount = (editor, monaco) => {
    monaco.editor.setModelLanguage(editor.getModel()!, spiceLanguageId);
  };

  return (
    <div className="netlist-panel">
      <div className="panel-header">
        <span>netlist.cir</span>
        <div className="panel-header-right">
          {editing ? (
            <>
              <button type="button" className="ghost-btn" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" className="ghost-btn ghost-btn-primary" onClick={onApply}>
                Apply
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ghost-btn"
              onClick={onStartEdit}
              title="Edit netlist text; Apply syncs params, add/delete, and wiring by refdes"
            >
              edit as text
            </button>
          )}
          {onPopOut && (
            <button
              type="button"
              className="ghost-btn pop-out-btn"
              onClick={onPopOut}
              title="Open in a floating window"
            >
              ⤢
            </button>
          )}
        </div>
      </div>
      {status && <div className="netlist-status">{status}</div>}
      <div className="editor-wrap">
        <Editor
          height="100%"
          language={spiceLanguageId}
          value={editing ? draft : netlist}
          onMount={onMount}
          onChange={(value) => {
            if (editing) onDraftChange(value ?? "");
          }}
          theme="vs-dark"
          options={{
            readOnly: !editing,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
          }}
        />
      </div>
    </div>
  );
}
