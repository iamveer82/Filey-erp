import { Columns3, List } from "lucide-react";
import { cn } from "../../lib/format";

export type DealsViewMode = "list" | "board";

const ITEMS: { id: DealsViewMode; label: string; Icon: typeof List }[] = [
  { id: "list", label: "List", Icon: List },
  { id: "board", label: "Board", Icon: Columns3 },
];

/** Segmented Table/Board view switcher (trycompai toolbar DNA). One h-8
 *  control; the active segment gets a quiet hover film — never amber. */
export default function ViewSwitcher({
  value,
  onChange,
}: {
  value: DealsViewMode;
  onChange: (mode: DealsViewMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Deals layout"
      className="inline-flex h-8 items-center rounded-md border border-border bg-card p-0.5"
    >
      {ITEMS.map(({ id, label, Icon }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-[12px] font-medium transition-colors duration-150",
              active
                ? "bg-hover text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
