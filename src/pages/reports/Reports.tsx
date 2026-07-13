/* ── Reports: modular Apple-style reports router shell ─────────────────────
 * Tab navigation: Dashboard · Sales · Inventory · Financial · Customers · Suppliers
 * All tabs share the same data hook (single fetch + live-sync). Preserves ALL
 * existing data fetching logic and business calculations from the original page. */
import { useState, useRef, useMemo } from "react";
import {
  LayoutDashboard,
  TrendingUp,
  Boxes,
  Wallet,
  Users,
  Truck,
  FileText,
  Download,
  Calendar,
} from "lucide-react";
import { cn, num, getDisplayCurrency } from "../../lib/format";
import { downloadCsv } from "../../lib/csv";
import { downloadElementAsPdf } from "../../lib/pdfTools";
import { DateRangePicker } from "../../components/DatePicker";
import { ErrorBanner, Spinner } from "../../components/ui";
import { useReportsData, useReportsMetrics } from "./useReportsData";
import { DashboardTab } from "./DashboardTab";
import { SalesTab } from "./SalesTab";
import { InventoryTab } from "./InventoryTab";
import { FinancialTab } from "./FinancialTab";
import { CustomersTab } from "./CustomersTab";
import { SuppliersTab } from "./SuppliersTab";

type TabId =
  | "dashboard"
  | "sales"
  | "inventory"
  | "financial"
  | "customers"
  | "suppliers";

const TABS: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "sales", label: "Sales", icon: TrendingUp },
  { id: "inventory", label: "Inventory", icon: Boxes },
  { id: "financial", label: "Financial", icon: Wallet },
  { id: "customers", label: "Customers", icon: Users },
  { id: "suppliers", label: "Suppliers", icon: Truck },
];

export default function Reports() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const data = useReportsData();
  const metrics = useReportsMetrics(data);
  const pdfRef = useRef<HTMLDivElement>(null);

  /* ── PDF download ── */
  const downloadPdf = () => {
    const el = pdfRef.current?.closest(".invoice-print") as HTMLElement;
    if (el)
      downloadElementAsPdf(el, `Filey-Report-${new Date().toISOString().slice(0, 10)}`);
    else window.print();
  };

  /* ── CSV export (preserves all original metrics) ── */
  const exportCsv = () => {
    const rows = [
      { metric: "Total Revenue (billed)", amount: metrics.totalRevenue },
      { metric: "Collected", amount: metrics.invoiceRevenue },
      { metric: "Accounts Receivable", amount: metrics.accountsReceivable },
      { metric: "PO Value (non-cancelled)", amount: metrics.poValue },
      { metric: "PO Received", amount: metrics.poReceived },
      { metric: "Total Expenses", amount: metrics.totalExpenses },
      { metric: "Payroll Cost", amount: metrics.payrollCost },
      { metric: "Gross Profit", amount: metrics.grossProfit },
      { metric: "Inventory Value", amount: metrics.invValue },
      { metric: "Cash Position", amount: data.report?.cash_position ?? 0 },
      { metric: "VAT 201 — Standard-rated supplies (net)", amount: metrics.vat.standardSupplyNet },
      { metric: "VAT 201 — Output tax (box 1)", amount: metrics.vat.outputVat },
      { metric: "VAT 201 — Standard-rated expenses (net)", amount: metrics.vat.standardExpenseNet },
      { metric: "VAT 201 — Input tax recoverable (box 9)", amount: metrics.vat.inputVat },
      { metric: "VAT 201 — Net VAT due (box 14)", amount: metrics.vat.netVatDue },
      { metric: "Balance Sheet — Total Assets", amount: metrics.balanceSheet.totalAssets },
      { metric: "Balance Sheet — Total Liabilities", amount: metrics.balanceSheet.totalLiabilities },
      { metric: "Balance Sheet — Total Equity", amount: metrics.balanceSheet.totalEquity },
      { metric: "Cash Flow — Net change (period)", amount: metrics.cashSummary.net },
    ];
    downloadCsv(`filey-report-${new Date().toISOString().slice(0, 10)}`, rows, [
      { key: "metric", label: "Metric" },
      { key: "amount", label: "Amount" },
    ]);
  };

  const tabContent = useMemo(() => {
    switch (tab) {
      case "dashboard":
        return <DashboardTab data={data} metrics={metrics} />;
      case "sales":
        return <SalesTab data={data} metrics={metrics} />;
      case "inventory":
        return <InventoryTab data={data} />;
      case "financial":
        return <FinancialTab data={data} metrics={metrics} />;
      case "customers":
        return <CustomersTab data={data} />;
      case "suppliers":
        return <SuppliersTab data={data} />;
    }
  }, [tab, data, metrics]);

  return (
    <div className="max-w-[1320px] mx-auto px-4 sm:px-6 py-6 space-y-5 animate-fade-up">
      {/* ── Header ── */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] leading-9 font-semibold text-ink tracking-tight">
            Reports
          </h1>
          <p className="text-sm text-brand-500 mt-1">
            Profit &amp; Loss, spending, transactions — print-ready PDF
          </p>
        </div>
        <div className="flex gap-2 flex-wrap no-print">
          <button className="btn-ghost" onClick={downloadPdf}>
            <FileText size={15} /> PDF
          </button>
          <button className="btn-primary" onClick={exportCsv}>
            <Download size={15} /> Export CSV
          </button>
        </div>
      </div>

      {/* ── Period selector ── */}
      <div className="card !p-3 flex items-center gap-3 no-print">
        <Calendar size={15} className="text-brand-400" />
        <span className="text-xs font-medium text-brand-500">Period</span>
        <DateRangePicker
          from={data.dateFrom}
          to={data.dateTo}
          onFromChange={data.setDateFrom}
          onToChange={data.setDateTo}
        />
        {(data.dateFrom || data.dateTo) && (
          <button
            className="text-xs text-brand-500 hover:text-ink cursor-pointer"
            onClick={() => {
              data.setDateFrom(undefined);
              data.setDateTo(undefined);
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Tab navigation ── */}
      <div className="flex items-center gap-1 p-1 rounded-full bg-brand-100 dark:bg-white/10 overflow-x-auto no-print">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-3.5 py-1.5 text-[12px] font-semibold rounded-full transition-all flex items-center gap-1.5 whitespace-nowrap",
                active
                  ? "bg-white text-ink shadow-sm dark:bg-[#3A3D45]"
                  : "text-brand-500 hover:text-ink"
              )}
            >
              <Icon size={13} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Error / loading ── */}
      {data.error && (
        <div className="mb-4">
          <ErrorBanner message={data.error} />
        </div>
      )}
      {data.loading &&
        data.products.length === 0 &&
        data.invoices.length === 0 &&
        !data.error && (
          <div className="card mb-4">
            <Spinner label="Loading reports…" />
          </div>
        )}

      {/* ── Tab content (PDF print area) ── */}
      <div ref={pdfRef} className="invoice-print">
        {tabContent}
      </div>

      {/* ── Footer summary ── */}
      <p className="text-xs text-brand-400 mt-3 no-print">
        {num(data.products.length)} products · {num(metrics.invoiceTxns.length)} invoices ·{" "}
        {num(metrics.poTxns.length)} POs · {num(metrics.expenseTxns.length)} expenses · figures
        in {getDisplayCurrency()}
      </p>
    </div>
  );
}