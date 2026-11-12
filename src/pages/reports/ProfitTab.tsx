import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, RefreshCw } from "lucide-react";
import { downloadCsv } from "../../lib/csv";
import { money, todayYmd } from "../../lib/format";
import { loadProfit, profitByDay, profitByItem, profitTotals, type ProfitLine, type ProfitRow } from "../../lib/profit";
import { ErrorBanner, Spinner } from "../../components/ui";
import { toast } from "../../components/Toaster";

function Table({ title, note, head, rows, onCsv }: { title: string; note?: string; head: string[]; rows: ReactNode[][]; onCsv?: () => void }) {
  return <section className="mb-6">
    <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
      <div><h3 className="text-sm font-semibold text-foreground">{title} <span className="font-normal text-muted-foreground">· {rows.length}</span></h3>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}</div>
      {onCsv && rows.length > 0 && <button type="button" className="btn-ghost" onClick={onCsv}><Download size={14} /> CSV</button>}
    </div>
    {rows.length === 0 ? <p className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">No sales in this period.</p> :
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            {head.map((h, i) => <th key={h} className={`px-3 py-2 font-medium ${i > 0 ? "text-right" : ""}`}>{h}</th>)}
          </tr></thead>
          <tbody>{rows.map((row, r) => <tr key={r} className="border-b border-border last:border-0">
            {row.map((cell, i) => <td key={i} className={`px-3 py-2 text-ink ${i > 0 ? "text-right tabular-nums" : ""}`}>{cell}</td>)}
          </tr>)}</tbody>
        </table>
      </div>}
  </section>;
}

/** Profit per day and per item, from invoices and counter receipts, for every business. */
export default function ProfitTab() {
  const today = todayYmd();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [currency, setCurrency] = useState("");
  const [lines, setLines] = useState<ProfitLine[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!from || !to || from > to) return;
    setLoading(true);
    setError("");
    try {
      const profit = await loadProfit(from, to);
      setCurrency(profit.currency);
      setSkipped(profit.skipped);
      setLines(profit.lines);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sales could not be read.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);

  const days = useMemo(() => profitByDay(lines), [lines]);
  const items = useMemo(() => profitByItem(lines), [lines]);
  const total = useMemo(() => profitTotals(lines), [lines]);
  const m = (v: number) => money(v, currency || "AED");
  const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
  const csv = (name: string, rows: ProfitRow[]) =>
    downloadCsv(`profit-${name}-${from}-to-${to}`, rows.map((r) => ({ [name === "days" ? "date" : "item"]: r.label, bills: r.bills, qty: r.qty, sales: r.sales, cost: r.cost, profit: r.profit, margin_percent: r.margin ?? "" })))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not export CSV."));

  return <div>
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap gap-3">
        <label className="text-xs">From<input aria-label="Profit from" type="date" className="input mt-1 w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-xs">To<input aria-label="Profit to" type="date" className="input mt-1 w-40" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <button type="button" className="btn-ghost" disabled={loading} onClick={() => { void load(); }}><RefreshCw size={14} /> Refresh</button>
    </div>
    <p className="mb-4 max-w-3xl text-xs text-muted-foreground">Sales are before tax and after discounts; credit notes count against them. Cost is each product's current cost price × quantity, so it can differ from what you paid at the time. Lines without a product have no cost.{skipped > 0 ? ` ${skipped} invoice${skipped === 1 ? "" : "s"} in another currency left out.` : ""}</p>
    {error && <div className="mb-4"><ErrorBanner message={error} /></div>}
    {loading ? <div className="py-10"><Spinner label="Working out profit…" /></div> : <>
      <div className="mb-6 grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-4">
        {[["Sales", m(total.sales)], ["Cost", m(total.cost)], ["Profit", m(total.profit)], ["Margin", pct(total.margin)]].map(([k, v]) =>
          <div key={k}><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</p><p className="text-lg font-semibold tabular-nums text-foreground">{v}</p></div>)}
      </div>
      <Table title="Per day" head={["Date", "Bills", "Sales", "Cost", "Profit", "Margin"]}
        rows={days.map((r) => [r.label, r.bills, m(r.sales), m(r.cost), m(r.profit), pct(r.margin)])} onCsv={() => csv("days", days)} />
      <Table title="Per item" note="Most profitable first. * means some of its lines have no cost." head={["Item", "Qty", "Sales", "Cost", "Profit", "Margin"]}
        rows={items.map((r) => [`${r.label}${r.costMissing ? " *" : ""}`, r.qty, m(r.sales), m(r.cost), m(r.profit), pct(r.margin)])} onCsv={() => csv("items", items)} />
    </>}
  </div>;
}
