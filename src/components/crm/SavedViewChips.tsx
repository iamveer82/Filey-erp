import { useState } from "react";
import { BookmarkPlus, X } from "lucide-react";
import { cn } from "../../lib/format";
import type { PipelineFilter, PipelineView } from "../../lib/pipelineViews";

/** Saved-view chips row (trycompai SavedView DNA) — shown under the toolbar on
 *  BOTH deals views. Click a chip to apply its filters, × to forget it; save
 *  the live filters with the trailing control once anything is active. */
export default function SavedViewChips({
  views,
  filter,
  filtersActive,
  onApply,
  onDelete,
  onSave,
}: {
  views: PipelineView[];
  /** Live toolbar state — used to mark the matching chip active. */
  filter: PipelineFilter;
  filtersActive: boolean;
  onApply: (view: PipelineView) => void;
  onDelete: (name: string) => void;
  onSave: (name: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  const commit = () => {
    if (!name.trim()) return;
    onSave(name.trim());
    setSaving(false);
    setName("");
  };

  // Nothing to show until a view exists or the user is filtering.
  if (views.length === 0 && !filtersActive && !saving) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {views.map((v) => {
        const active =
          (v.query ?? "") === (filter.query ?? "").trim() &&
          (v.owner ?? "") === (filter.owner ?? "");
        return (
          <span key={v.name} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => onApply(v)}
              aria-label={`Apply view ${v.name}`}
              aria-pressed={active}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors duration-150",
                active
                  ? "border-primary-400 bg-primary-500/10 text-primary-600 dark:text-primary-400"
                  : "border-border bg-card text-muted-foreground hover:bg-hover hover:text-foreground"
              )}
            >
              {v.name}
            </button>
            <button
              type="button"
              aria-label={`Delete view ${v.name}`}
              className="-ml-1 grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-hover hover:text-foreground"
              onClick={() => onDelete(v.name)}
            >
              <X size={11} />
            </button>
          </span>
        );
      })}

      {saving ? (
        <span className="flex items-center gap-1">
          <input
            autoFocus
            className="input h-8 w-36 text-[12px]"
            placeholder="View name…"
            aria-label="Saved view name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setSaving(false);
                setName("");
              }
            }}
          />
          <button
            type="button"
            className="btn-primary h-8"
            disabled={!name.trim()}
            onClick={commit}
          >
            Save
          </button>
        </span>
      ) : (
        filtersActive && (
          <button
            type="button"
            className="btn-ghost h-8"
            aria-label="Save current filters as a view"
            onClick={() => {
              setSaving(true);
              setName("");
            }}
          >
            <BookmarkPlus size={13} /> Save view
          </button>
        )
      )}
    </div>
  );
}
