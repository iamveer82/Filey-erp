import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileText } from "lucide-react";
import { billing, type InvoiceDocSummary } from "@shared/api";
import { aed } from "@shared/format";
import { Screen, ListRow, SearchHeader, EmptyState, Loading } from "@mobile/components/ui";
import { cn } from "@shared/format";

type Filter = "all" | "draft" | "sent" | "paid" | "overdue";
const FILTERS: Filter[] = ["all", "draft", "sent", "paid", "overdue"];

export default function Invoices() {
  const nav = useNavigate();
  const [rows, setRows] = useState<InvoiceDocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [params] = useSearchParams();

  useEffect(() => {
    billing
      .listDocs("sales")
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (
        needle &&
        !`${r.number} ${r.customer_name || ""}`.toLowerCase().includes(needle)
      )
        return false;
      if (filter === "all") return true;
      if (filter === "overdue")
        return (r.balance ?? 0) > 0 && (r.status === "sent" || r.status === "paid")
          ? r.status === "sent"
          : false;
      return (r.status || "draft") === filter;
    });
  }, [rows, q, filter]);

  return (
    <Screen title="Invoices" subtitle={`${rows.length} total`}>
      <div className="space-y-3">
        <SearchHeader
          value={q}
          onChange={setQ}
          placeholder="Search number or customer…"
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
            icon={<FileText size={22} />}
            title={rows.length === 0 ? "No invoices yet" : "No matches"}
            hint={
              rows.length === 0
                ? "Tap New invoice to raise your first one."
                : "Try a different search or filter."
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
                onClick={() => nav(`/invoices/${r.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </Screen>
  );
}
