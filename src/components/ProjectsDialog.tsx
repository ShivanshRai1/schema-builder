import { useEffect, useMemo, useState } from "react";
import type { WorkspaceFile } from "../persistence/workspaceFile";
import { downloadWorkspace } from "../persistence/workspaceFile";
import {
  deleteLocalProject,
  listLocalProjects,
  type LocalProjectMeta,
} from "../persistence/localProjects";
import { buildShareUrl, copyText, SHARE_URL_SOFT_LIMIT } from "../persistence/shareLink";

type TabId = "save" | "library" | "share";

export function ProjectsDialog({
  open,
  onClose,
  projectName,
  onProjectNameChange,
  currentProjectId,
  workspace,
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

  const shareInfo = useMemo(() => buildShareUrl(workspace), [workspace]);

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
              Saved in this browser for now. Same file format will sync when login arrives.
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
              ["library", "My projects"],
              ["share", "Share"],
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
                Saves all schematic tabs, models, and sim settings into this browser
                {currentProjectId ? " (updating the current project)." : "."}
              </p>
              <div className="projects-actions">
                <button type="button" className="ghost-btn ghost-btn-primary" onClick={onSaveProgress}>
                  Save progress
                </button>
                <button type="button" className="ghost-btn" onClick={onExportFile}>
                  Download file…
                </button>
              </div>
            </section>
          )}

          {tab === "library" && (
            <section className="projects-section">
              {projects.length === 0 ? (
                <p className="projects-hint">No saved projects yet — use Save progress first.</p>
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
                        <button type="button" className="ghost-btn" onClick={() => onLoadProject(p.id)}>
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
                <span>Import .json file</span>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) onImportFile(f);
                  }}
                />
              </label>
            </section>
          )}

          {tab === "share" && (
            <section className="projects-section">
              <p className="projects-hint">
                Share a file, clipboard JSON, or a link. Large projects (big model libraries) may be
                too big for a URL — use Download instead.
              </p>
              <div className="projects-actions">
                <button
                  type="button"
                  className="ghost-btn ghost-btn-primary"
                  onClick={() => {
                    downloadWorkspace(workspace);
                    flash("downloaded share file");
                  }}
                >
                  Download share file
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    void copyText(JSON.stringify(workspace))
                      .then(() => flash("copied project JSON — paste into chat or a .json file"))
                      .catch(() => flash("clipboard copy failed", true));
                  }}
                >
                  Copy JSON
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={shareInfo.tooLarge}
                  title={
                    shareInfo.tooLarge
                      ? `Link would exceed ~${Math.round(SHARE_URL_SOFT_LIMIT / 1000)}k characters`
                      : "Copy a URL that opens this project"
                  }
                  onClick={() => {
                    void copyText(shareInfo.url)
                      .then(() => flash("share link copied"))
                      .catch(() => flash("clipboard copy failed", true));
                  }}
                >
                  {shareInfo.tooLarge ? "Link too large" : "Copy share link"}
                </button>
              </div>
              {!shareInfo.tooLarge && (
                <p className="projects-share-url" title={shareInfo.url}>
                  {shareInfo.url.slice(0, 96)}…
                </p>
              )}
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
