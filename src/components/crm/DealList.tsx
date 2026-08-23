import { Eye, Trophy } from "lucide-react";
import type { Opportunity } from "../../lib/api";
import { aed, cn, fmtDate } from "../../lib/format";
import { keyActivate } from "../ui";
import { stageIndex } from "./stageMeta";
import StageChip from "./StageChip";

/** Dense deals table (trycompai DataTable DNA): 13px rows, sticky header,
 *  right-aligned tabular numbers, bg-hover row film, hover-revealed open
 *  action. A row opens the existing DealDrawer — the list is a lens on the
 *  same records the board edits, never a second source of truth. */
export default function DealList({
  opps,
  onOpen,
}: {
  opps: Opportunity[];
  onOpen: (deal: Opportunity) => void;
}) {
  const rows = [...opps].sort(
    (a, b) =>
      stageIndex(a.stage) - stageIndex(b.stage) ||
      +new Date(b.updated_at ?? b.created_at) -
        +new Date(a.updated_at ?? a.created_at)
  );

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card">
        <div className="grid place-items-center gap-2 py-16 text-[13px] text-muted-foreground">
          <Trophy size={20} className="text-muted-foreground/50" />
          No opportunities yet.
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Own scroll region so the header stays pinned once the list outgrows
          the viewport; short lists simply don't scroll. */}
      <div className="max-h-[calc(100vh-19rem)] min-h-0 overflow-auto">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead className="sticky top-0 z-10">
            <tr>
              {[
                "Deal",
                "Company / Contact",
                "Stage",
                "Value",
                "Close date",
                "Owner",
              ].map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={cn(
                    "th border-b border-border bg-card",
                    i >= 3 && "text-right"
                  )}
                >
                  {h}
                </th>
              ))}
              <th scope="col" className="th w-10 bg-card">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr
                key={o.id}
                tabIndex={0}
                aria-label={`Open deal ${o.title}`}
                onClick={() => onOpen(o)}
                onKeyDown={keyActivate(() => onOpen(o))}
                className="group row-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400"
              >
                <td className="td max-w-[240px] truncate font-medium">
                  {o.title}
                </td>
                <td className="td max-w-[200px] truncate text-muted-foreground">
                  {o.customer_name || "—"}
                </td>
                <td className="td">
                  <StageChip stage={o.stage} />
                </td>
                <td className="td text-right font-semibold tabular-nums">
                  {aed(o.value)}
                </td>
                <td className="td whitespace-nowrap text-right tabular-nums text-muted-foreground">
                  {o.expected_close ? fmtDate(o.expected_close) : "—"}
                </td>
                <td className="td max-w-[140px] truncate text-right text-muted-foreground">
                  {o.owner || "—"}
                </td>
                <td className="td text-right">
                  <button
                    type="button"
                    aria-label={`Open ${o.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(o);
                    }}
                    className="inline-grid h-6 w-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    <Eye size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
