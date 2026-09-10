import { useCallback, useRef, useState } from "react";

const MODEL_EXT = /\.(sub|lib|cir|txt|mod|spi)$/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mergeLibrary(existing: string, filename: string, body: string): string {
  const block = body.replace(/^\uFEFF/, "").trim();
  if (!block) return existing;
  const header = `* --- file: ${filename} ---`;
  const chunk = `${header}\n${block}\n`;
  const cur = existing.trim();
  if (!cur) return chunk;
  // Replace prior paste of the same file name if present
  const re = new RegExp(
    `\\* --- file: ${escapeRegExp(filename)} ---\\n[\\s\\S]*?(?=\\* --- file:|$)`,
    "i",
  );
  if (re.test(cur)) {
    return `${cur.replace(re, chunk).trim()}\n`;
  }
  return `${cur}\n\n${chunk}`;
}

/** Attach vendor .subckt bodies — drag/drop or browse files (no manual paste required). */
export function LibraryPanel({
  library,
  onChange,
  analysisHint,
}: {
  library: string;
  onChange: (text: string) => void;
  /** e.g. current .tran line — shown so users know analysis persists */
  analysisHint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const ingestFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = [...files].filter((f) => MODEL_EXT.test(f.name) || f.type.startsWith("text/"));
      if (!list.length) {
        setStatus("Use .sub / .lib / .txt model files");
        return;
      }
      let next = library;
      const names: string[] = [];
      for (const f of list) {
        const text = await f.text();
        next = mergeLibrary(next, f.name, text);
        names.push(f.name);
      }
      onChange(next.endsWith("\n") ? next : next + "\n");
      setStatus(`Added ${names.join(", ")} — included in Run netlist automatically`);
    },
    [library, onChange],
  );

  return (
    <div className="library-panel">
      <div className="panel-header">
        <span>.subckt library</span>
        <div className="panel-header-right">
          <span className="badge">models for Run</span>
          <button
            type="button"
            className="ghost-btn library-browse-btn"
            title="Browse for .sub / .lib model files"
            onClick={() => inputRef.current?.click()}
          >
            Browse…
          </button>
          {library.trim() ? (
            <button
              type="button"
              className="ghost-btn library-browse-btn"
              title="Clear all attached models"
              onClick={() => {
                onChange("");
                setStatus("Library cleared");
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".sub,.lib,.cir,.txt,.mod,.spi,text/plain"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void ingestFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div
        className={`library-dropzone${dragOver ? " is-dragover" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) void ingestFiles(e.dataTransfer.files);
        }}
      >
        <div className="library-drop-hint">
          Drop <code>.sub</code> / <code>.lib</code> files here, or use <strong>Browse…</strong>
          {" — "}
          no need to paste by hand. Models are sent with every Run.
        </div>
        <textarea
          className="library-textarea"
          spellCheck={false}
          placeholder={"Vendor models appear here after you add files."}
          value={library}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>

      {(status || analysisHint) && (
        <div className="library-status">
          {analysisHint ? <span title="From circuit directives">Analysis: {analysisHint}</span> : null}
          {status ? <span>{status}</span> : null}
        </div>
      )}
    </div>
  );
}
