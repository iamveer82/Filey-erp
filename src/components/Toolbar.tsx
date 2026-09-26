/* ── Toolbar ────────────────────────────────────────────────────────────────
 * Standard list-page toolbar: search, optional filter slot, and primary action.
 * All list pages should use this so the chrome feels identical everywhere. */
import { ReactNode } from "react";
import { Search, Plus } from "lucide-react";
import { cn } from "../lib/format";

export interface ToolbarProps {
  searchValue?: string;
  onSearch?: (value: string) => void;
  searchPlaceholder?: string;
  filterSlot?: ReactNode;
  primaryAction?: { label: string; onClick: () => void; icon?: ReactNode };
  className?: string;
}

export function Toolbar({
  searchValue,
  onSearch,
  searchPlaceholder = "Search…",
  filterSlot,
  primaryAction,
  className,
}: ToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1 max-w-md">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-400"
          />
          <input
            type="text"
            value={searchValue || ""}
            onChange={(e) => onSearch?.(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="input pl-9"
          />
        </div>
        {filterSlot}
      </div>
      {primaryAction && (
        <button
          onClick={primaryAction.onClick}
          className="btn-primary shrink-0"
        >
          {primaryAction.icon || <Plus size={16} />}
          {primaryAction.label}
        </button>
      )}
    </div>
  );
}
