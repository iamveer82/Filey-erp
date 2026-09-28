/* ── Toolbar ────────────────────────────────────────────────────────────────
 * Standard list-page toolbar: search, optional filter slot, and primary action.
 * All list pages should use this so the chrome feels identical everywhere. */
import { ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "../lib/format";
import { SearchInput } from "./ui";

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
          <SearchInput
            value={searchValue || ""}
            onChange={(value) => onSearch?.(value)}
            placeholder={searchPlaceholder}
            className="min-w-[160px] flex-1 max-w-md"
          />
        {filterSlot}
      </div>
      {primaryAction && (
        <button
          type="button"
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
