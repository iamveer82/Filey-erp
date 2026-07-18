import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, TrendingUp, TrendingDown } from "lucide-react";
import {
  pos,
  suppliers as suppliersApi,
  type PoSummary,
  type Supplier,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { aed, fmtDate, money, num, cn, errMsg } from "../lib/format";
import {
  PageHeader,
  Badge,
  statusTone,
  ErrorBanner,
} from "../components/ui";

export default function Purchase() {
  const nav = useNavigate();
  const [orders, setOrders] = useState<PoSummary[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    return Promise.all([pos.list(), suppliersApi.list()])
      .then(([poList, supList]) => {
        setOrders(poList);
        setSuppliers(supList);
      })
      .catch((e) => setError(`Could not load purchases: ${errMsg(e)}`))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  /* ── KPI strip, real data (DEMO parity): Total spend = sum of
     non-cancelled PO totals, Open = draft+sent, Received = received count,
     Avg. lead time = mean(expected − order_date) where both dates exist. ── */
  const active = useMemo(
    () => orders.filter((p) => p.status !== "cancelled"),
    [orders]
  );
  const totalSpend = active.reduce((s, p) => s + p.total, 0);
  const openCount = orders.filter(
    (p) => p.status === "draft" || p.status === "sent"
  ).length;
  const received = useMemo(
    () => orders.filter((p) => p.status === "received"),
    [orders]
  );
  const receivedThisMonth = received.filter((p) => {
    const d = new Date(p.updated_at);
    const now = new Date();
    return (
      !isNaN(d.getTime()) &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    );
  }).length;

  const leadTime = useMemo(() => {
    const days: number[] = [];
    for (const p of orders) {
      if (!p.order_date || !p.expected_date) continue;
      const d = (+new Date(p.expected_date) - +new Date(p.order_date)) / 86400000;
      if (Number.isFinite(d)) days.push(d);
    }
    if (!days.length) return null;
    return days.reduce((s, d) => s + d, 0) / days.length;
  }, [orders]);

  /* ── Real period-over-period deltas (Reports pattern): last 30 days vs
     the 30 before that, keyed on order_date (received uses updated_at —
     the only receipt timestamp on a summary row). Where no prior-period
     baseline exists the delta is null → no chip, hint text only. ── */
  const deltas = useMemo(() => {
    const DAY = 86400000;
    const now = Date.now();
    const curStart = now - 30 * DAY;
    const prevStart = now - 60 * DAY;
    const pct = (cur: number, prev: number): number | null =>
      prev > 0 ? ((cur - prev) / prev) * 100 : null;

    let spendCur = 0;
    let spendPrev = 0;
    let poCur = 0;
    let poPrev = 0;
    let rcvCur = 0;
    let rcvPrev = 0;
    const leadCur: number[] = [];
    const leadPrev: number[] = [];
    for (const p of orders) {
      const t = +new Date(p.order_date);
      const cur = t >= curStart;
      const prev = !cur && t >= prevStart;
      if (p.status !== "cancelled") {
        if (cur) spendCur += p.total;
        else if (prev) spendPrev += p.total;
      }
      if (cur) poCur += 1;
      else if (prev) poPrev += 1;
      if (p.status === "received") {
        const rt = +new Date(p.updated_at);
        if (rt >= curStart) rcvCur += 1;
        else if (rt >= prevStart) rcvPrev += 1;
      }
      if (p.order_date && p.expected_date) {
        const d = (+new Date(p.expected_date) - t) / DAY;
        if (Number.isFinite(d)) {
          if (cur) leadCur.push(d);
          else if (prev) leadPrev.push(d);
        }
      }
    }
    const avg = (xs: number[]) =>
      xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
    return {
      spend: pct(spendCur, spendPrev),
      open: pct(poCur, poPrev),
      received: pct(rcvCur, rcvPrev),
      lead: leadPrev.length ? pct(avg(leadCur), avg(leadPrev)) : null,
    };
  }, [orders]);

  const kpis = [
    {
      label: "Total spend",
      value: aed(totalSpend),
      delta: deltas.spend,
      hint: `across ${num(suppliers.length)} suppliers`,
    },
    {
      label: "Open POs",
      value: num(openCount),
      delta: deltas.open,
      hint: "awaiting delivery",
    },
    {
      label: "Received",
      value: num(receivedThisMonth > 0 ? receivedThisMonth : received.length),
      delta: deltas.received,
      hint: receivedThisMonth > 0 ? "this month" : "all time",
    },
    {
      label: "Avg. lead time",
      value: leadTime == null ? "—" : `${leadTime.toFixed(1)} d`,
      delta: deltas.lead,
      hint: "order → expected",
    },
  ];

  // pos.list() is already ordered by order_date desc, id desc → first 8 = recent.
  const recent = orders.slice(0, 8);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Purchase"
        subtitle="Track spend across suppliers"
        action={
          <button className="btn-primary" onClick={() => nav("/purchase-orders")}>
            <Plus size={16} /> New Purchase
          </button>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {/* ── KPI strip (joined 4-up, DEMO tile markup) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-border rounded-xl overflow-hidden bg-card">
        {kpis.map((k, i) => {
          const up = (k.delta ?? 0) >= 0;
          const Icon = up ? TrendingUp : TrendingDown;
          return (
            <div
              key={k.label}
              className={cn(
                "p-5 border-b lg:border-b-0 border-border",
                i < 3 && "lg:border-r",
                i % 2 === 0 && "sm:border-r lg:border-r"
              )}
            >
              <div className="text-[13px] text-muted-foreground">{k.label}</div>
              <div className="mt-3 text-[26px] font-semibold text-foreground leading-tight tracking-tight tabular-nums">
                {k.value}
              </div>
              <div className="mt-2 flex items-center gap-2 text-[11.5px]">
                {k.delta != null && (
                  <span
                    title="vs previous 30 days"
                    className={cn(
                      "inline-flex items-center gap-1 font-medium",
                      up ? "text-success" : "text-danger"
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {k.delta >= 0 ? "+" : ""}
                    {k.delta.toFixed(1)}%
                  </span>
                )}
                <span className="text-muted-foreground">{k.hint}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Recent purchases (first 8 POs) ── */}
      <div className="mt-5 border border-border rounded-xl overflow-hidden bg-card">
        <div className="px-5 pt-4 pb-3">
          <div className="text-[14px] font-semibold text-foreground">Recent purchases</div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Latest purchase orders across your suppliers
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="px-5 py-2.5 font-medium text-[12px] tracking-wide">PO</th>
                <th className="px-5 py-2.5 font-medium text-[12px] tracking-wide">Supplier</th>
                <th className="px-5 py-2.5 font-medium text-[12px] tracking-wide">Items</th>
                <th className="px-5 py-2.5 font-medium text-[12px] tracking-wide">Total</th>
                <th className="px-5 py-2.5 font-medium text-[12px] tracking-wide">Status</th>
                <th className="px-5 py-2.5 font-medium text-[12px] tracking-wide">ETA</th>
              </tr>
            </thead>
            <tbody>
              {loading && recent.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && recent.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                    No purchase orders yet
                  </td>
                </tr>
              )}
              {recent.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => nav("/purchase-orders")}
                  className="border-b border-border last:border-0 hover:bg-hover transition-colors cursor-pointer"
                >
                  <td className="px-5 py-3">
                    <span className="font-mono text-xs font-medium text-primary-700 dark:text-primary-300">
                      {p.po_number}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-foreground">{p.supplier_name}</td>
                  <td className="px-5 py-3 text-foreground tabular-nums">
                    {num(p.items_count)}
                  </td>
                  <td className="px-5 py-3 text-foreground tabular-nums font-medium">
                    {money(p.total, p.currency || "AED")}
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {p.expected_date ? fmtDate(p.expected_date) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
