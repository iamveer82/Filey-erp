/* ── DashboardTab: 4 KPI cards + revenue bar chart + transactions table ──── */
import {
  DollarSign,
  Wallet,
  Boxes,
  TrendingUp,
  ShoppingCart,
  Receipt,
  PiggyBank,
} from "lucide-react";
import type { ChartConfig } from "../../components/ui/chart";
import { aed, num, fmtDate } from "../../lib/format";
import type { ReportsData, ReportsMetrics } from "./useReportsData";
import { ReportKpi } from "./components/ReportKpi";
import { ReportBarChart, ReportPieChart } from "./components/ReportChart";
import { ReportTable, StatusBadge, type Column } from "./components/ReportTable";
import type { InvoiceDocSummary } from "../../lib/api";

const chartConfig = {
  sales: { label: "Sales", color: "#FFD600" },
  expense: { label: "Expenses", color: "#B88C00" },
} satisfies ChartConfig;

export function DashboardTab({
  data,
  metrics,
}: {
  data: ReportsData;
  metrics: ReportsMetrics;
}) {
  const { loading } = data;
  const {
    totalRevenue,
    totalExpenses,
    payrollCost,
    grossProfit,
    invValue,
    invoiceRevenue,
    accountsReceivable,
    poValue,
    monthly,
    expenseByCat,
    invoiceTxns,
  } = metrics;

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
      key: "amount",
      header: "Amount",
      align: "right",
      render: (inv) => <span className="font-medium tabular-nums">{aed(inv.total)}</span>,
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
      {/* ── KPI Row: 4 cards ── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <ReportKpi
          label="Total Revenue"
          value={aed(totalRevenue)}
          icon={<DollarSign size={20} />}
          iconClass="bg-primary-100 text-ink"
          change={`${num(invoiceTxns.length)} invoices`}
          changeTone="up"
          loading={loading}
        />
        <ReportKpi
          label="Total Expenses"
          value={aed(totalExpenses + payrollCost)}
          icon={<Receipt size={20} />}
          iconClass="bg-warning/15 text-warning"
          change={`Payroll ${aed(payrollCost)}`}
          changeTone="warn"
          loading={loading}
        />
        <ReportKpi
          label="Net Profit"
          value={aed(grossProfit)}
          icon={<PiggyBank size={20} />}
          iconClass={
            grossProfit >= 0 ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
          }
          change={grossProfit >= 0 ? "Profit" : "Loss"}
          changeTone={grossProfit >= 0 ? "up" : "down"}
          loading={loading}
        />
        <ReportKpi
          label="Inventory Value"
          value={aed(invValue)}
          icon={<Boxes size={20} />}
          iconClass="bg-info/15 text-info"
          change={`${num(data.products.length)} products`}
          changeTone="up"
          loading={loading}
        />
      </section>

      {/* ── Secondary KPIs ── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <ReportKpi
          label="Collected"
          value={aed(invoiceRevenue)}
          icon={<Wallet size={20} />}
          iconClass="bg-success/15 text-success"
          change="Cash in"
          changeTone="up"
          loading={loading}
        />
        <ReportKpi
          label="Accounts Receivable"
          value={aed(accountsReceivable)}
          icon={<Wallet size={20} />}
          iconClass="bg-secondary-400/20 text-secondary-600"
          change="Outstanding"
          changeTone={accountsReceivable > 0 ? "warn" : "up"}
          loading={loading}
        />
        <ReportKpi
          label="PO Value"
          value={aed(poValue)}
          icon={<ShoppingCart size={20} />}
          iconClass="bg-info/15 text-info"
          change="Non-cancelled"
          changeTone="up"
          loading={loading}
        />
        <ReportKpi
          label="Gross Profit"
          value={aed(grossProfit)}
          icon={<TrendingUp size={20} />}
          iconClass={grossProfit >= 0 ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}
          change={`Margin ${totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 100) : 0}%`}
          changeTone={grossProfit >= 0 ? "up" : "down"}
          loading={loading}
        />
      </section>

      {/* ── Charts ── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ReportBarChart
          data={monthly}
          config={chartConfig}
          title="Sales vs expenses — last 6 months"
          loading={loading}
          className="lg:col-span-2"
        />
        <ReportPieChart
          data={expenseByCat}
          title="Spending by category"
          loading={loading}
        />
      </section>

      {/* ── Recent invoice transactions ── */}
      <ReportTable
        title="Sales Invoices"
        subtitle={`${num(invoiceTxns.length)} invoices · ${aed(invoiceRevenue)} collected`}
        columns={invoiceColumns}
        rows={invoiceTxns.slice(0, 12)}
        emptyMessage="No invoice transactions"
        footer={
          <>
            <td colSpan={4} className="py-2.5 px-4 text-right text-sm">
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