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
  missingModels,
}: {
  library: string;
  onChange: (text: string) => void;
  /** e.g. current .tran line — shown so users know analysis persists */
  analysisHint?: string;
  /** Model names referenced by the netlist but not defined in Models / deck. */
  missingModels?: string[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const missing = (missingModels ?? []).filter(Boolean);

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
      setStatus(`Added ${names.join(", ")} — kept in project Models; included on Run`);
    },
    [library, onChange],
  );

  return (
    <div className="library-panel">
      <div className="panel-header">
        <span>.subckt library</span>
        <div className="panel-header-right">
          <span className="badge">in project</span>
          <button
            type="button"
            className="ghost-btn library-browse-btn"
            title="Browse for .sub / .lib model files (stored in this project)"
            onClick={() => inputRef.current?.click()}
          >
            Browse…
          </button>
          {library.trim() ? (
            <button
              type="button"
              className="ghost-btn library-browse-btn"
              title="Clear all attached models from this project"
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

      {missing.length > 0 && (
        <div className="library-missing-hint" role="status">
          Missing for Run: <strong>{missing.join(", ")}</strong>
          {" — "}
          Browse or drop the matching <code>.sub</code> / <code>.lib</code> / <code>.txt</code> into Models
        </div>
      )}

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
          {library.trim() ? (
            <>
              Drop <code>.sub</code> / <code>.lib</code> / <code>.txt</code> here, or{" "}
              <strong>Browse…</strong>
              {" — "}
              models stay in this project and are inlined on every Run.
            </>
          ) : (
            <>
              Models is empty — drop vendor <code>.sub</code> / <code>.lib</code> / <code>.txt</code>{" "}
              files here, or use <strong>Browse…</strong>
              {" — "}
              add whatever models this schematic’s netlist references.
            </>
          )}
        </div>
        <textarea
          className="library-textarea"
          spellCheck={false}
          placeholder={"Vendor .subckt / .model text lives here — part of the project, not a separate Drive."}
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
