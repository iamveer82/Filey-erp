import { useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { receipts, type ReceiptSummary } from "@shared/api";
import { aed } from "@shared/format";
import {
  Screen,
  MetricCard,
  ListRow,
  SearchHeader,
  EmptyState,
  Loading,
} from "@mobile/components/ui";
import { cn } from "@shared/format";

export default function Receipts() {
  const [rows, setRows] = useState<ReceiptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    receipts
      .list()
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return rows;
    return rows.filter((r) =>
      `${r.number} ${r.customer_name || ""} ${r.payment_method || ""}`
        .toLowerCase()
        .includes(n)
    );
  }, [rows, q]);

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const thisMonth = rows.filter(
    (r) => (r.payment_date || "").slice(0, 7) === new Date().toISOString().slice(0, 7)
  );

  return (
    <Screen title="Receipts" subtitle={`${rows.length} total`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5">
          <MetricCard
            label="Total received"
            value={aed(total)}
            change={`${rows.length} receipts`}
          />
          <MetricCard
            label="This month"
            value={aed(thisMonth.reduce((s, r) => s + (r.amount || 0), 0))}
            change={`${thisMonth.length} receipts`}
            tone={thisMonth.length > 0 ? "up" : "warn"}
          />
        </div>

        <SearchHeader
          value={q}
          onChange={setQ}
          placeholder="Search receipt, payer or method…"
        />

        {loading ? (
          <Loading />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Wallet size={22} />}
            title={rows.length === 0 ? "No receipts yet" : "No matches"}
            hint={rows.length === 0 ? "Issue receipts from the desktop app or ask the AI agent." : undefined}
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => (
              <ListRow
                key={r.id}
                title={r.number}
                subtitle={`${r.customer_name || "—"}${r.payment_method ? ` · ${r.payment_method}` : ""}`}
                amount={aed(r.amount || 0)}
                status={r.status}
              />
            ))}
          </div>
        )}
      </div>
    </Screen>
  );
}
