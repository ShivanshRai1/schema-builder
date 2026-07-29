import Editor from "@monaco-editor/react";

// ---------------------------------------------------------------------------
// Monaco panel showing the live, generated netlist.
//
// STEP 1: read-only. The graph is authoritative; this is a projection.
//
// STEP-2 SEAM: set `readOnly: false`, take an onChange, and route edits through
// a parser that diffs the text against the current graph and patches by refdes
// (preserving node positions). The `onRequestEdit` prop is the placeholder for
// flipping into that editable-fallback mode from the UI.
// ---------------------------------------------------------------------------

export function NetlistPanel({
  netlist,
  onRequestEdit,
}: {
  netlist: string;
  onRequestEdit?: () => void;
}) {
  return (
    <div className="netlist-panel">
      <div className="panel-header">
        <span>netlist.cir</span>
        <div className="panel-header-right">
          <span className="badge">graph-authoritative · read-only</span>
          <button className="ghost-btn" onClick={onRequestEdit} title="Step 2: editable fallback">
            edit as text
          </button>
        </div>
      </div>
      <div className="editor-wrap">
        <Editor
          height="100%"
          defaultLanguage="spice"
          language="ini" /* ini highlighting is a decent stand-in until a SPICE grammar is added */
          value={netlist}
          theme="vs-dark"
          options={{
            readOnly: true,
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
