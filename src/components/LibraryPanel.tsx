/** Attach vendor .subckt bodies — prepended to the generated netlist. */
export function LibraryPanel({
  library,
  onChange,
}: {
  library: string;
  onChange: (text: string) => void;
}) {
  return (
    <div className="library-panel">
      <div className="panel-header">
        <span>.subckt library</span>
        <span className="badge">prepended to netlist</span>
      </div>
      <textarea
        className="library-textarea"
        spellCheck={false}
        placeholder={
          "Paste vendor .subckt bodies here, e.g.\n" +
          ".subckt SIC_MOS d g s\n...\n.ends SIC_MOS"
        }
        value={library}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
