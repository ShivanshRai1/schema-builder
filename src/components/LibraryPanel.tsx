/** Attach vendor .subckt bodies — optional; overrides built-in placeholders. */
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
        <span className="badge">optional override</span>
      </div>
      <textarea
        className="library-textarea"
        spellCheck={false}
        placeholder={
          "Optional — built-in models run automatically.\n" +
          "Paste vendor .subckt bodies here to override, e.g.\n" +
          ".subckt SIC_MOS d g s\n...\n.ends SIC_MOS"
        }
        value={library}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
