import type { SchematicTabMeta } from "../model/schematicTabs";

export function SchematicTabBar({
  tabs,
  activeId,
  onSelect,
  onNew,
  onClose,
}: {
  tabs: SchematicTabMeta[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: (id: string) => void;
}) {
  return (
    <div className="schematic-tabbar" role="tablist" aria-label="Schematics">
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            className={`schematic-tab${active ? " is-active" : ""}`}
            role="tab"
            aria-selected={active}
          >
            <button
              type="button"
              className="schematic-tab-label"
              title={t.title}
              onClick={() => onSelect(t.id)}
            >
              {t.title}
            </button>
            {tabs.length > 1 && (
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
