import { useEffect, useRef, useState } from "react";
import type { SchematicTabMeta } from "../model/schematicTabs";

export function SchematicTabBar({
  tabs,
  activeId,
  onSelect,
  onNew,
  onClose,
  onRename,
}: {
  tabs: SchematicTabMeta[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editingIdRef = useRef<string | null>(null);
  const draftRef = useRef("");
  editingIdRef.current = editingId;
  draftRef.current = draft;

  useEffect(() => {
    if (!editingId) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editingId]);

  const beginRename = (tab: SchematicTabMeta) => {
    editingIdRef.current = tab.id;
    setEditingId(tab.id);
    setDraft(tab.title);
  };

  const commitRename = () => {
    const id = editingIdRef.current;
    if (!id) return;
    editingIdRef.current = null;
    const next =
      draftRef.current.trim() || tabs.find((t) => t.id === id)?.title || "Circuit";
    setEditingId(null);
    setDraft("");
    onRename(id, next);
  };

  const cancelRename = () => {
    editingIdRef.current = null;
    setEditingId(null);
    setDraft("");
  };

  return (
    <div className="schematic-tabbar" role="tablist" aria-label="Schematics">
      {tabs.map((t) => {
        const active = t.id === activeId;
        const editing = editingId === t.id;
        return (
          <div
            key={t.id}
            className={`schematic-tab${active ? " is-active" : ""}`}
            role="tab"
            aria-selected={active}
          >
            {editing ? (
              <input
                ref={inputRef}
                className="schematic-tab-rename"
                value={draft}
                aria-label={`Rename ${t.title}`}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelRename();
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="schematic-tab-label"
                title={`${t.title} — double-click to rename`}
                onClick={() => onSelect(t.id)}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  beginRename(t);
                }}
              >
                {t.title}
              </button>
            )}
            {tabs.length > 1 && !editing && (
              <button
                type="button"
                className="schematic-tab-close"
                title={`Close ${t.title}`}
                aria-label={`Close ${t.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.id);
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="schematic-tab-new"
        title="New empty schematic tab"
        aria-label="New schematic tab"
        onClick={onNew}
      >
        +
      </button>
    </div>
  );
}
