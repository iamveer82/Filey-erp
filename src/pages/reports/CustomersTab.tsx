/* ── CustomersTab: Top customers + receivables aging ──────────────────────── */
import { Users, DollarSign, Clock, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import type { ChartConfig } from "../../components/ui/chart";
import { aed, num } from "../../lib/format";
import type { ReportsData } from "./useReportsData";
import { ReportKpi } from "./components/ReportKpi";
import { ReportBarChart } from "./components/ReportChart";
import { ReportTable, StatusBadge, type Column } from "./components/ReportTable";

const chartConfig = {
  revenue: { label: "Revenue", color: "#FFD600" },
} satisfies ChartConfig;

interface CustomerSummary {
  name: string;
  invoiceCount: number;
  totalBilled: number;
  collected: number;
  balance: number;
}

export function CustomersTab({ data }: { data: ReportsData }) {
  const { invoices, loading } = data;

  /* Aggregate by customer */
  const customers = useMemo<CustomerSummary[]>(() => {
    const m = new Map<string, CustomerSummary>();
    for (const inv of invoices) {
      if (inv.status === "draft") continue;
      const name = (inv.customer_name || "—").trim() || "—";
      const cur = m.get(name) ?? {
        name,
        invoiceCount: 0,
        totalBilled: 0,
        collected: 0,
        balance: 0,
      };
      cur.invoiceCount += 1;
      cur.totalBilled += inv.total || 0;
      cur.collected += (inv.total || 0) - (inv.balance ?? 0);
      cur.balance += inv.balance ?? 0;
      m.set(name, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.totalBilled - a.totalBilled);
  }, [invoices]);

  /* Receivables aging buckets */
  const aging = useMemo(() => {
    const now = new Date();
    const buckets = {
      current: 0, // not yet due
      "1-30": 0,
      "31-60": 0,
      "61-90": 0,
      "90+": 0,
    };
    for (const inv of invoices) {
      if (inv.status === "draft" || inv.status === "paid") continue;
      const bal = inv.balance ?? 0;
      if (bal <= 0) continue;
      if (!inv.due_date) {
        buckets.current += bal;
        continue;
      }
      const due = new Date(inv.due_date);
      const daysOverdue = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
      if (daysOverdue <= 0) buckets.current += bal;
      else if (daysOverdue <= 30) buckets["1-30"] += bal;
      else if (daysOverdue <= 60) buckets["31-60"] += bal;
      else if (daysOverdue <= 90) buckets["61-90"] += bal;
      else buckets["90+"] += bal;
    }
    return buckets;
  }, [invoices]);

  const totalReceivable = customers.reduce((s, c) => s + c.balance, 0);
  const totalBilled = customers.reduce((s, c) => s + c.totalBilled, 0);
  const totalCollected = customers.reduce((s, c) => s + c.collected, 0);

  const customerColumns: Column<CustomerSummary>[] = [
    {
      key: "sl",
      header: "SL",
      className: "w-8 text-brand-400 px-4",
      render: (_, i) => i + 1,
    },
    {
      key: "name",
      header: "Customer",
      render: (c) => <span className="font-medium">{c.name}</span>,
    },
    {
      key: "invoices",
      header: "Invoices",
      align: "right",
      render: (c) => <span className="tabular-nums">{num(c.invoiceCount)}</span>,
    },
    {
      key: "billed",
      header: "Billed",
      align: "right",
      render: (c) => <span className="tabular-nums">{aed(c.totalBilled)}</span>,
    },
    {
      key: "collected",
      header: "Collected",
      align: "right",
      render: (c) => (
        <span className="tabular-nums text-success">{aed(c.collected)}</span>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      render: (c) => (
        <span
          className={c.balance > 0 ? "font-medium tabular-nums text-warning" : "tabular-nums text-brand-400"}
        >
          {aed(c.balance)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (c) => (
        <StatusBadge tone={c.balance === 0 ? "paid" : "open"}>
          {c.balance === 0 ? "Settled" : "Owing"}
        </StatusBadge>
      ),
    },
  ];

  const agingData = [
    { name: "Current", value: aging.current },
    { name: "1–30", value: aging["1-30"] },
    { name: "31–60", value: aging["31-60"] },
    { name: "61–90", value: aging["61-90"] },
    { name: "90+", value: aging["90+"] },
  ];

  return (
    <div className="space-y-6">
      {/* ── KPI cards ── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <ReportKpi
          label="Total Billed"
          value={aed(totalBilled)}
          icon={<DollarSign size={20} />}
          iconClass="bg-primary-100 text-ink"
          change={`${num(customers.length)} customers`}
          changeTone="up"
          loading={loading}
        />
        <ReportKpi
          label="Collected"
          value={aed(totalCollected)}
          icon={<TrendingUp size={20} />}
          iconClass="bg-success/15 text-success"
          change={`${totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0}% collected`}
          changeTone="up"
          loading={loading}
        />
        <ReportKpi
          label="Outstanding"
          value={aed(totalReceivable)}
          icon={<Clock size={20} />}
          iconClass="bg-warning/15 text-warning"
          change="Receivables"
          changeTone={totalReceivable > 0 ? "warn" : "up"}
          loading={loading}
        />
        <ReportKpi
          label="Active Customers"
          value={num(customers.length)}
          icon={<Users size={20} />}
          iconClass="bg-info/15 text-info"
          change="With invoices"
          changeTone="up"
          loading={loading}
        />
      </section>

      {/* ── Receivables aging chart ── */}
      <ReportBarChart
        data={agingData.map((d) => ({ name: d.name, revenue: d.value }))}
        config={chartConfig}
        title="Receivables aging"
        loading={loading}
      />

      {/* ── Top customers table ── */}
      <ReportTable
        title="Top customers by billed amount"
        subtitle={`${num(customers.length)} customers · ${aed(totalBilled)} billed · ${aed(totalReceivable)} outstanding`}
        columns={customerColumns}
        rows={customers}
        emptyMessage="No customer transactions"
        footer={
          <>
            <td colSpan={5} className="py-2.5 px-4 text-right text-sm">
              Grand Total
            </td>
            <td className="py-2.5 px-2 text-right tabular-nums">{aed(totalReceivable)}</td>
            <td></td>
          </>
        }
      />
    </div>
  );
}