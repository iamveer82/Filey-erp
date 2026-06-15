import { useEffect, useMemo, useRef, useState } from "react";
import {
  TrendingUp,
  Wallet,
  Boxes,
  Download,
  FileText,
  DollarSign,
  Receipt,
  PiggyBank,
  ShoppingCart,
} from "lucide-react";
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  erp,
  fin,
  billing,
  hr,
  pos,
  Product,
  FinanceReport,
  InvoiceDocSummary,
  Expense,
  Payroll,
  PoSummary,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { downloadCsv } from "../lib/csv";
import { aed, num, getDisplayCurrency, fmtDate } from "../lib/format";
import { PageHeader, MetricCard, InfoCard, Spinner, ErrorBanner } from "../components/ui";
import { downloadElementAsPdf } from "../lib/pdfTools";
import { DateRangePicker } from "../components/DatePicker";
import { Calendar } from "lucide-react";

const PIE = ["#FFD600", "#E0AE00", "#B88C00", "#FFBA3D", "#F6C954"];
const CHART_STROKE = "#E0AE00";
const CHART_FILL_START = "#FFD600";
const CHART_GRID = "#DEDBD2";

export default function Reports() {
  const [products, setProducts] = useState<Product[]>([]);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [posList, setPosList] = useState<PoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const pdfRef = useRef<HTMLDivElement>(null);

  const load = () => {
    setError("");
    return Promise.all([
      erp.products().then(setProducts),
      fin.report().then(setReport),
      billing.listDocs().then(setInvoices),
      fin.expenses().then(setExpenses),
      hr.payroll().then(setPayroll),
      pos.list().then(setPosList),
    ])
      .catch((e) =>
        setError(`Could not load reports: ${e instanceof Error ? e.message : e}`)
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  /* ── Computed metrics ── */
  const invoiceRevenue = useMemo(
    () =>
      invoices
        .filter((i) => i.status !== "draft")
        .reduce((s, i) => s + ((i.total || 0) - (i.balance ?? 0)), 0),
    [invoices]
  );
  const accountsReceivable = useMemo(
    () =>
      invoices
        .filter((i) => i.status !== "draft")
        .reduce((s, i) => s + (i.balance ?? 0), 0),
    [invoices]
  );
  const totalExpenses = useMemo(
    () => expenses.reduce((s, e) => s + e.amount, 0),
    [expenses]
  );
  const monthExpenses = useMemo(() => {
    const now = new Date();
    return expenses
      .filter((e) => {
        const d = new Date(e.expense_date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((s, e) => s + e.amount, 0);
  }, [expenses]);
  const payrollCost = useMemo(
    () => payroll.reduce((s, p) => s + p.net_pay, 0),
    [payroll]
  );
  const poValue = useMemo(
    () =>
      posList.filter((p) => p.status !== "cancelled").reduce((s, p) => s + p.total, 0),
    [posList]
  );
  const poReceived = useMemo(
    () => posList.filter((p) => p.status === "received").reduce((s, p) => s + p.total, 0),
    [posList]
  );
  const grossProfit = invoiceRevenue - totalExpenses - payrollCost;
  const invValue = products.reduce((s, p) => s + p.quantity * p.cost_price, 0);

  /* ── Expense by category ── */
  const expenseByCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of expenses) {
      const cat = e.category || "Uncategorized";
      m.set(cat, (m.get(cat) ?? 0) + e.amount);
    }
    return Array.from(m.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  /* ── Chart data ── */
  const trend = useMemo(() => {
    const now = new Date();
    const buckets: { name: string; value: number; key: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        name: d.toLocaleString("en", { month: "short" }),
        key: `${d.getFullYear()}-${d.getMonth()}`,
        value: 0,
      });
    }
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    for (const inv of invoices) {
      if (inv.status === "draft" || !inv.issue_date) continue;
      const collected = (inv.total || 0) - (inv.balance ?? 0);
      if (collected <= 0) continue;
      const d = new Date(inv.issue_date);
      const b = byKey.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (b) b.value += collected;
    }
    return buckets.map(({ name, value }) => ({ name, value }));
  }, [invoices]);

  /* ── Transaction tables for PDF ── */
  const invoiceTxns = useMemo(
    () =>
      invoices
        .filter((i) => i.status !== "draft")
        .sort((a, b) => (a.issue_date || "").localeCompare(b.issue_date || "")),
    [invoices]
  );
  const expenseTxns = useMemo(
    () =>
      [...expenses].sort((a, b) =>
        (a.expense_date || "").localeCompare(b.expense_date || "")
      ),
    [expenses]
  );
  const poTxns = useMemo(
    () =>
      [...posList]
        .filter((p) => p.status !== "cancelled")
        .sort((a, b) => (a.order_date || "").localeCompare(b.order_date || "")),
    [posList]
  );

  /* ── PDF download ── */
  const downloadPdf = () => {
    const el = pdfRef.current?.closest(".invoice-print") as HTMLElement;
    if (el)
      downloadElementAsPdf(el, `Filey-Report-${new Date().toISOString().slice(0, 10)}`);
    else window.print();
  };

  const exportCsv = () => {
    const rows = [
      { metric: "Paid Revenue", amount: invoiceRevenue },
      { metric: "Accounts Receivable", amount: accountsReceivable },
      { metric: "PO Value (non-cancelled)", amount: poValue },
      { metric: "PO Received", amount: poReceived },
      { metric: "Total Expenses", amount: totalExpenses },
      { metric: "Payroll Cost", amount: payrollCost },
      { metric: "Gross Profit", amount: grossProfit },
      { metric: "Inventory Value", amount: invValue },
      { metric: "Cash Position", amount: report?.cash_position ?? 0 },
    ];
    downloadCsv(`filey-report-${new Date().toISOString().slice(0, 10)}`, rows, [
      { key: "metric", label: "Metric" },
      { key: "amount", label: "Amount" },
    ]);
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Reports"
        subtitle="Profit &amp; Loss, spending, transactions — print-ready PDF"
        action={
          <div className="flex gap-2 flex-wrap no-print">
            <button className="btn-ghost" onClick={downloadPdf}>
              <FileText size={15} /> PDF
            </button>
            <button className="btn-primary" onClick={exportCsv}>
              <Download size={15} /> Export CSV
            </button>
          </div>
        }
      />
      <div className="mb-4 card !p-3 flex items-center gap-3 no-print">
        <Calendar size={15} className="text-brand-400" />
        <span className="text-xs font-medium text-brand-500">Period</span>
        <DateRangePicker
          from={dateFrom}
          to={dateTo}
          onFromChange={setDateFrom}
          onToChange={setDateTo}
        />
        {(dateFrom || dateTo) && (
          <button
            className="text-xs text-brand-500 hover:text-ink cursor-pointer"
            onClick={() => {
              setDateFrom(undefined);
              setDateTo(undefined);
            }}
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}
      {loading && products.length === 0 && invoices.length === 0 && !error && (
        <div className="card mb-4">
          <Spinner label="Loading reports…" />
        </div>
      )}

      {/* ══════════ PDF PRINT SECTION ══════════ */}
      <div ref={pdfRef} className="invoice-print">
        {/* ── Summary cards ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 no-print">
          <div className="relative overflow-hidden rounded-full bg-primary-400 p-6 text-ink">
            <div className="flex items-center justify-between mb-3">
              <DollarSign size={22} className="text-ink/70" />
              <span className="pill bg-ink/15 text-ink text-[11px]">Paid invoices</span>
            </div>
            <p className="text-3xl font-medium">{aed(invoiceRevenue)}</p>
            <p className="text-sm font-medium text-ink/60 mt-1">Total Revenue</p>
          </div>
          <div className="rounded-3xl border border-brand-200 bg-brand-50 p-6 text-ink dark:border-[#2C2C2E] dark:bg-[#1C1C1E] dark:text-[#F4F5F6]">
            <div className="flex items-center justify-between mb-3">
              <Receipt size={22} className="text-brand-600 dark:text-[#DDE0E4]" />
              <span className="pill bg-brand-100 dark:bg-white/12 text-brand-600 dark:text-[#DDE0E4] text-[11px]">
                Expenses + Payroll
              </span>
            </div>
            <p className="text-3xl font-medium">{aed(totalExpenses + payrollCost)}</p>
            <p className="text-sm font-medium text-brand-500 dark:text-[#B6BAC1] mt-1">
              Total Expenses
            </p>
          </div>
          <div
            className={`rounded-md p-6 text-white ${grossProfit >= 0 ? "bg-success" : "bg-danger"}`}
          >
            <div className="flex items-center justify-between mb-3">
              <PiggyBank size={22} className="text-white/70" />
              <span className="pill bg-white/20 text-white text-[11px]">
                Revenue − Costs
              </span>
            </div>
            <p className="text-3xl font-medium">{aed(grossProfit)}</p>
            <p className="text-sm font-medium text-white/60 mt-1">Net Profit</p>
          </div>
        </div>

        {/* ── Metric cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <MetricCard
            label="Inventory Value"
            value={aed(invValue)}
            icon={<Boxes size={20} />}
          />
          <MetricCard
            label="Invoice Revenue (paid)"
            value={aed(invoiceRevenue)}
            icon={<Wallet size={20} />}
            iconClass="bg-success/15 text-success"
          />
          <MetricCard
            label="Accounts Receivable"
            value={aed(accountsReceivable)}
            icon={<Wallet size={20} />}
            iconClass="bg-secondary-400/20 text-secondary-600"
          />
          <MetricCard
            label="Gross Profit"
            value={aed(grossProfit)}
            icon={<TrendingUp size={20} />}
            iconClass="bg-info/15 text-info"
          />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <MetricCard
            label="Total Expenses"
            value={aed(totalExpenses)}
            icon={<Wallet size={20} />}
          />
          <MetricCard
            label="This Month Expenses"
            value={aed(monthExpenses)}
            icon={<Wallet size={20} />}
          />
          <MetricCard
            label="Payroll Cost"
            value={aed(payrollCost)}
            icon={<Wallet size={20} />}
          />
          <MetricCard
            label="PO Value (non-cancelled)"
            value={aed(poValue)}
            icon={<ShoppingCart size={20} />}
            iconClass="bg-info/15 text-info"
          />
        </div>

        {/* ── Profit & Loss Statement ── */}
        <div className="card p-6 mb-6">
          <h2 className="text-lg font-medium text-ink mb-4">
            Profit &amp; Loss Statement
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-2 border-b border-brand-100">
              <span className="font-medium text-brand-600">Revenue</span>
              <span className="font-medium tabular-nums">{aed(invoiceRevenue)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-brand-100 pl-4">
              <span className="text-brand-500">Invoices (paid)</span>
              <span className="tabular-nums">{aed(invoiceRevenue)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-brand-100 pl-4">
              <span className="text-brand-500">Outstanding (AR)</span>
              <span className="tabular-nums">{aed(accountsReceivable)}</span>
            </div>

            <div className="flex justify-between py-2 border-b border-brand-100">
              <span className="font-medium text-brand-600">Cost of Goods (POs)</span>
              <span className="font-medium tabular-nums">({aed(poValue)})</span>
            </div>
            <div className="flex justify-between py-2 border-b border-brand-100 pl-4">
              <span className="text-brand-500">Purchase Orders (non-cancelled)</span>
              <span className="tabular-nums">{aed(poValue)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-brand-100 pl-4">
              <span className="text-brand-500">Received into stock</span>
              <span className="tabular-nums">{aed(poReceived)}</span>
            </div>

            <div className="flex justify-between py-2 border-b border-brand-100">
              <span className="font-medium text-brand-600">Operating Expenses</span>
              <span className="font-medium tabular-nums">
                ({aed(totalExpenses + payrollCost)})
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-brand-100 pl-4">
              <span className="text-brand-500">General expenses</span>
              <span className="tabular-nums">{aed(totalExpenses)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-brand-100 pl-4">
              <span className="text-brand-500">Payroll</span>
              <span className="tabular-nums">{aed(payrollCost)}</span>
            </div>

            <div className="flex justify-between py-3 mt-1 rounded-3xl bg-brand-50 px-3">
              <span className="font-medium text-ink text-base">Net Profit / (Loss)</span>
              <span
                className={`font-medium text-base tabular-nums ${grossProfit >= 0 ? "text-success" : "text-danger"}`}
              >
                {aed(grossProfit)}
              </span>
            </div>
          </div>
        </div>

        {/* ── Charts (no-print) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6 no-print">
          <InfoCard title="Revenue (paid) — last 6 months" className="lg:col-span-2">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient id="rep" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_FILL_START} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={CHART_FILL_START} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12, fill: "#A39B8C" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: "#A39B8C" }}
                    axisLine={false}
                    tickLine={false}
                    width={70}
                  />
                  <Tooltip
                    formatter={(v) => aed(Number(v))}
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid #DEDBD2",
                      fontSize: 13,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={CHART_STROKE}
                    strokeWidth={2.5}
                    fill="url(#rep)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </InfoCard>

          <InfoCard title="Spending by category">
            <div className="h-72">
              {expenseByCat.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={expenseByCat}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                    >
                      {expenseByCat.map((_, i) => (
                        <Cell key={i} fill={PIE[i % PIE.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => aed(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-brand-400">
                  No expenses recorded
                </div>
              )}
            </div>
          </InfoCard>
        </div>

        {/* ══════════ TRANSACTION TABLES (print visible) ══════════ */}
        <div className="print-only space-y-6">
          {/* Print summary header */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-medium">Financial Report</h1>
            <p className="text-sm text-brand-500">
              {new Date().toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
          <table className="w-full text-sm mb-6" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #222" }}>
                <th className="py-1.5 text-left text-xs font-medium">Metric</th>
                <th className="py-1.5 text-right text-xs font-medium">Amount (AED)</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Revenue (paid invoices)", invoiceRevenue],
                ["Accounts Receivable", accountsReceivable],
                ["Purchase Orders (non-cancelled)", poValue],
                ["POs Received", poReceived],
                ["Total Expenses", totalExpenses],
                ["Payroll Cost", payrollCost],
                ["Gross Profit / (Loss)", grossProfit],
                ["Inventory Value", invValue],
                ["Cash Position", report?.cash_position ?? 0],
              ].map(([label, val], i) => (
                <tr key={i} style={{ borderBottom: "1px solid #EAE4D6" }}>
                  <td className="py-1.5 font-medium">{label}</td>
                  <td className="py-1.5 text-right tabular-nums">{aed(val as number)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Invoice transactions */}
        <div className="card p-0 overflow-hidden mb-6">
          <div className="p-4 border-b border-brand-100">
            <h2 className="font-medium text-ink">Sales Invoices</h2>
            <p className="text-xs text-brand-400">
              {invoiceTxns.length} invoices · {aed(invoiceRevenue)} collected
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-brand-400 border-b border-brand-100">
                  <th className="py-2.5 px-4 w-8">SL</th>
                  <th className="py-2.5 px-2">Date</th>
                  <th className="py-2.5 px-2">Customer</th>
                  <th className="py-2.5 px-2">Description</th>
                  <th className="py-2.5 px-2 w-28 text-right">Amount</th>
                  <th className="py-2.5 px-2 w-16 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoiceTxns.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sm text-brand-400">
                      No invoice transactions
                    </td>
                  </tr>
                ) : (
                  invoiceTxns.map((inv, i) => (
                    <tr
                      key={inv.id}
                      className="border-b border-brand-50 hover:bg-brand-50/50"
                    >
                      <td className="py-2.5 px-4 text-brand-400">{i + 1}</td>
                      <td className="py-2.5 px-2 tabular-nums text-xs">
                        {fmtDate(inv.issue_date)}
                      </td>
                      <td className="py-2.5 px-2 font-medium">
                        {inv.customer_name || "—"}
                      </td>
                      <td className="py-2.5 px-2 text-xs">{inv.number}</td>
                      <td className="py-2.5 px-2 text-right font-medium tabular-nums">
                        {aed(inv.total)}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${inv.balance === 0 ? "bg-success/10 text-success" : "bg-secondary-100 text-secondary-600"}`}
                        >
                          {inv.balance === 0 ? "Paid" : "Open"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="bg-brand-50 font-medium">
                  <td colSpan={4} className="py-2.5 px-4 text-right text-sm">
                    Grand Total
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums">
                    {aed(invoiceTxns.reduce((s, i) => s + i.total, 0))}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Purchase Order transactions */}
        <div className="card p-0 overflow-hidden mb-6">
          <div className="p-4 border-b border-brand-100">
            <h2 className="font-medium text-ink">Purchase Orders</h2>
            <p className="text-xs text-brand-400">
              {poTxns.length} POs · {aed(poValue)} total value
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-brand-400 border-b border-brand-100">
                  <th className="py-2.5 px-4 w-8">SL</th>
                  <th className="py-2.5 px-2">Date</th>
                  <th className="py-2.5 px-2">Supplier</th>
                  <th className="py-2.5 px-2">Description</th>
                  <th className="py-2.5 px-2 w-28 text-right">Amount</th>
                  <th className="py-2.5 px-2 w-16 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {poTxns.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sm text-brand-400">
                      No purchase orders
                    </td>
                  </tr>
                ) : (
                  poTxns.map((po, i) => (
                    <tr
                      key={po.id}
                      className="border-b border-brand-50 hover:bg-brand-50/50"
                    >
                      <td className="py-2.5 px-4 text-brand-400">{i + 1}</td>
                      <td className="py-2.5 px-2 tabular-nums text-xs">
                        {fmtDate(po.order_date)}
                      </td>
                      <td className="py-2.5 px-2 font-medium">{po.supplier_name}</td>
                      <td className="py-2.5 px-2 text-xs">{po.po_number}</td>
                      <td className="py-2.5 px-2 text-right font-medium tabular-nums">
                        {aed(po.total)}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${po.status === "received" ? "bg-success/10 text-success" : po.status === "cancelled" ? "bg-danger/10 text-danger" : "bg-secondary-100 text-secondary-600"}`}
                        >
                          {po.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="bg-brand-50 font-medium">
                  <td colSpan={4} className="py-2.5 px-4 text-right text-sm">
                    PO Total (non-cancelled)
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums">{aed(poValue)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Expense transactions */}
        <div className="card p-0 overflow-hidden mb-6">
          <div className="p-4 border-b border-brand-100">
            <h2 className="font-medium text-ink">Expenses</h2>
            <p className="text-xs text-brand-400">
              {expenseTxns.length} expenses · {aed(totalExpenses)} total
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-brand-400 border-b border-brand-100">
                  <th className="py-2.5 px-4 w-8">SL</th>
                  <th className="py-2.5 px-2">Date</th>
                  <th className="py-2.5 px-2">Category</th>
                  <th className="py-2.5 px-2">Description</th>
                  <th className="py-2.5 px-2 w-28 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {expenseTxns.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-sm text-brand-400">
                      No expenses recorded
                    </td>
                  </tr>
                ) : (
                  expenseTxns.map((e, i) => (
                    <tr
                      key={e.id}
                      className="border-b border-brand-50 hover:bg-brand-50/50"
                    >
                      <td className="py-2.5 px-4 text-brand-400">{i + 1}</td>
                      <td className="py-2.5 px-2 tabular-nums text-xs">
                        {fmtDate(e.expense_date)}
                      </td>
                      <td className="py-2.5 px-2 font-medium">{e.category || "—"}</td>
                      <td className="py-2.5 px-2 text-xs">{e.description || "—"}</td>
                      <td className="py-2.5 px-2 text-right font-medium tabular-nums">
                        {aed(e.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="bg-brand-50 font-medium">
                  <td colSpan={4} className="py-2.5 px-4 text-right text-sm">
                    Total Expenses
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums">
                    {aed(totalExpenses)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      <p className="text-xs text-brand-400 mt-3 no-print">
        {num(products.length)} products · {num(invoiceTxns.length)} invoices ·{" "}
        {num(poTxns.length)} POs · {num(expenseTxns.length)} expenses · figures in{" "}
        {getDisplayCurrency()}
      </p>
    </div>
  );
}
