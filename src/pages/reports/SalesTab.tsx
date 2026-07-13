/* ── SalesTab: Invoice analytics ─────────────────────────────────────────── */
import { DollarSign, FileText, CheckCircle2, Clock } from "lucide-react";
import type { ChartConfig } from "../../components/ui/chart";
import { aed, num, fmtDate } from "../../lib/format";
import type { ReportsData, ReportsMetrics } from "./useReportsData";
import { ReportKpi } from "./components/ReportKpi";
import { ReportBarChart } from "./components/ReportChart";
import { ReportTable, StatusBadge, type Column } from "./components/ReportTable";
import type { InvoiceDocSummary } from "../../lib/api";
import { useMemo } from "react";

const chartConfig = {
  sales: { label: "Sales", color: "#FFD600" },
} satisfies ChartConfig;

export function SalesTab({
  data,
  metrics,
}: {
  data: ReportsData;
  metrics: ReportsMetrics;
}) {
  const { loading } = data;
  const { invoiceRevenue, accountsReceivable, totalRevenue, monthly, invoiceTxns } =
    metrics;

  /* Status breakdown of invoices */
  const statusBreakdown = useMemo(() => {
    const issued = data.invoices.filter((i) => i.status !== "draft");
    return {
      paid: issued.filter((i) => i.balance === 0).length,
      open: issued.filter((i) => i.balance !== 0).length,
      draft: data.invoices.filter((i) => i.status === "draft").length,
      total: issued.length,
    };
  }, [data.invoices]);

  const invoiceColumns: Column<InvoiceDocSummary>[] = [
    {
      key: "sl",
      header: "SL",
      className: "w-8 text-brand-400 px-4",
      render: (_, i) => i + 1,
    },
    {
      key: "date",
      header: "Date",
      render: (inv) => (
        <span className="tabular-nums text-xs">{fmtDate(inv.issue_date)}</span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      render: (inv) => <span className="font-medium">{inv.customer_name || "—"}</span>,
    },
    {
      key: "number",
      header: "Invoice #",
      render: (inv) => <span className="text-xs">{inv.number}</span>,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      render: (inv) => <span className="font-medium tabular-nums">{aed(inv.total)}</span>,
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      render: (inv) => (
        <span className="tabular-nums text-brand-500">{aed(inv.balance ?? 0)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (inv) => (
        <StatusBadge tone={inv.balance === 0 ? "paid" : "open"}>
          {inv.balance === 0 ? "Paid" : "Open"}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── KPI cards ── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <ReportKpi
          label="Total Revenue (billed)"
          value={aed(totalRevenue)}
          icon={<DollarSign size={20} />}
          iconClass="bg-primary-100 text-ink"
          change={`${num(statusBreakdown.total)} invoices`}
          changeTone="up"
          loading={loading}
        />
        <ReportKpi
          label="Collected"
          value={aed(invoiceRevenue)}
          icon={<CheckCircle2 size={20} />}
          iconClass="bg-success/15 text-success"
          change={`${num(statusBreakdown.paid)} paid`}
          changeTone="up"
          loading={loading}
        />
        <ReportKpi
          label="Outstanding"
          value={aed(accountsReceivable)}
          icon={<Clock size={20} />}
          iconClass="bg-warning/15 text-warning"
          change={`${num(statusBreakdown.open)} open`}
          changeTone={accountsReceivable > 0 ? "warn" : "up"}
          loading={loading}
        />
        <ReportKpi
          label="Draft Invoices"
          value={num(statusBreakdown.draft)}
          icon={<FileText size={20} />}
          iconClass="bg-brand-100 text-brand-500"
          change="Not sent"
          changeTone="down"
          loading={loading}
        />
      </section>

      {/* ── Sales trend (bar chart, last 6 months) ── */}
      <ReportBarChart
        data={monthly.map((m) => ({ name: m.name, sales: m.sales }))}
        config={chartConfig}
        title="Sales — last 6 months (collected)"
        loading={loading}
      />

      {/* ── All invoices table ── */}
      <ReportTable
        title="All Sales Invoices"
        subtitle={`${num(invoiceTxns.length)} invoices · ${aed(invoiceRevenue)} collected`}
        columns={invoiceColumns}
        rows={invoiceTxns}
        emptyMessage="No invoice transactions"
        footer={
          <>
            <td colSpan={5} className="py-2.5 px-4 text-right text-sm">
              Grand Total
            </td>
            <td className="py-2.5 px-2 text-right tabular-nums">
              {aed(invoiceTxns.reduce((s, i) => s + i.total, 0))}
            </td>
            <td></td>
          </>
        }
      />
    </div>
  );
}