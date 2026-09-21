import { useEffect, useState } from "react";
import type { WorkspaceFile } from "../persistence/workspaceFile";
import {
  deleteLocalProject,
  listLocalProjects,
  type LocalProjectMeta,
} from "../persistence/localProjects";

type TabId = "save" | "open";

export function ProjectsDialog({
  open,
  onClose,
  projectName,
  onProjectNameChange,
  currentProjectId,
  workspace: _workspace,
  onSaveProgress,
  onLoadProject,
  onExportFile,
  onImportFile,
}: {
  open: boolean;
  onClose: () => void;
  projectName: string;
  onProjectNameChange: (name: string) => void;
  currentProjectId: string | null;
  workspace: WorkspaceFile;
  onSaveProgress: () => void;
  onLoadProject: (id: string) => void;
  onExportFile: () => void;
  onImportFile: (file: File) => void;
}) {
  const [tab, setTab] = useState<TabId>("save");
  const [projects, setProjects] = useState<LocalProjectMeta[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [statusErr, setStatusErr] = useState(false);

  const refresh = () => setProjects(listLocalProjects());

  useEffect(() => {
    if (!open) return;
    refresh();
    setStatus(null);
    setStatusErr(false);
    setTab("save");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const flash = (msg: string, err = false) => {
    setStatus(msg);
    setStatusErr(err);
  };

  return (
    <div className="projects-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="projects-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Projects"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="projects-dialog-header">
          <div>
            <h2>Projects</h2>
            <p className="projects-dialog-sub">
              Save / open: schematic + netlist + models + results
            </p>
          </div>
          <button type="button" className="ghost-btn" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="projects-tabs" role="tablist">
          {(
            [
              ["save", "Save"],
              ["open", "Open"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={`projects-tab${tab === id ? " is-on" : ""}`}
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="projects-body">
          {tab === "save" && (
            <section className="projects-section">
              <label className="projects-field">
                <span>Project name</span>
                <input
                  value={projectName}
                  onChange={(e) => onProjectNameChange(e.target.value)}
                  placeholder="e.g. Load dump demo"
                  autoFocus
                />
              </label>
              <p className="projects-hint">
                Saves this browser’s project list
                {currentProjectId ? " (updates the current entry)." : "."} You can also download a
                .json file.
              </p>
              <div className="projects-actions">
                <button
                  type="button"
                  className="ghost-btn ghost-btn-primary"
                  onClick={() => {
                    onSaveProgress();
                    flash("saved");
                    refresh();
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    onExportFile();
                    flash("downloaded .json file");
                  }}
                >
                  Download file…
                </button>
              </div>
            </section>
          )}

          {tab === "open" && (
            <section className="projects-section">
              {projects.length === 0 ? (
                <p className="projects-hint">No local projects yet — Save one first, or import a file.</p>
              ) : (
                <ul className="projects-list">
                  {projects.map((p) => (
                    <li key={p.id} className="projects-list-item">
                      <div className="projects-list-main">
                        <strong>
                          {p.name}
                          {p.id === currentProjectId ? " · current" : ""}
                        </strong>
                        <span>
                          {p.tabCount} tab{p.tabCount === 1 ? "" : "s"} ·{" "}
                          {new Date(p.updatedAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="projects-list-actions">
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => {
                            onLoadProject(p.id);
                            onClose();
                          }}
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => {
                            if (!window.confirm(`Delete “${p.name}” from this browser?`)) return;
                            deleteLocalProject(p.id);
                            refresh();
                            flash(`deleted “${p.name}”`);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <label className="projects-import">
                <span>Open .json file</span>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) {
                      onImportFile(f);
                      onClose();
                    }
                  }}
                />
              </label>
            </section>
          )}
        </div>

        {status && (
          <footer className={`projects-status${statusErr ? " is-error" : ""}`}>{status}</footer>
        )}
      </div>
    </div>
  );
}
