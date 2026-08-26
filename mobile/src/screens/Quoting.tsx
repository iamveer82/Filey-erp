import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileSignature } from "lucide-react";
import { quotes, type QuotationSummary } from "@shared/api";
import { aed } from "@shared/format";
import {
  Screen,
  ListRow,
  SearchHeader,
  EmptyState,
  Loading,
} from "@mobile/components/ui";
import { cn } from "@shared/format";

type Filter = "all" | "draft" | "sent" | "accepted";
const FILTERS: Filter[] = ["all", "draft", "sent", "accepted"];

export default function Quoting() {
  const nav = useNavigate();
  const [rows, setRows] = useState<QuotationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    quotes
      .listDocs()
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (
        needle &&
        !`${r.number} ${r.customer_name || ""}`.toLowerCase().includes(needle)
      )
        return false;
      if (filter === "all") return true;
      return (r.status || "draft") === filter;
    });
  }, [rows, q, filter]);

  return (
    <Screen title="Quotations" subtitle={`${rows.length} total`}>
      <div className="space-y-3">
        <SearchHeader
          value={q}
          onChange={setQ}
          placeholder="Search quote or customer…"
        />
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-medium capitalize transition-colors",
                filter === f
                  ? "border-transparent bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground"
              )}
            >
              {f}
            </button>
          ))}
        </div>

        {loading ? (
          <Loading />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<FileSignature size={22} />}
            title={rows.length === 0 ? "No quotations yet" : "No matches"}
            hint={
              rows.length === 0
                ? "Create quotes from the desktop app to see them here."
                : undefined
            }
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => (
              <ListRow
                key={r.id}
                title={r.number}
                subtitle={r.customer_name || "—"}
                amount={aed(r.total || 0)}
                status={r.status}
              />
            ))}
          </div>
        )}
      </div>
    </Screen>
  );
}
