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
  BarChart,
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
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartBar,
  type ChartConfig,
} from "../components/ui/chart";
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
  Txn,
  Account,
  computeVatReturn,
  computeTrialBalance,
  computeBalanceSheet,
  computeCashSummary,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { downloadCsv } from "../lib/csv";
import { aed, num, getDisplayCurrency, fmtDate, localYmd } from "../lib/format";
import { PageHeader, MetricCard, InfoCard, Spinner, ErrorBanner } from "../components/ui";
import { downloadElementAsPdf } from "../lib/pdfTools";
import { DateRangePicker } from "../components/DatePicker";
import { Calendar } from "lucide-react";

const PIE = ["#FFD600", "#E0AE00", "#B88C00", "#FFBA3D", "#F6C954"];
const CHART_GRID = "#DEDBD2";

export default function Reports() {
  const [products, setProducts] = useState<Product[]>([]);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [posList, setPosList] = useState<PoSummary[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
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
      fin.transactions().then(setTxns),
      fin.accounts().then(setAccounts),
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
  // Revenue is recognised when invoiced (accrual), so "Total Revenue" =
  // collected + still-outstanding. invoiceRevenue alone is cash collected.
  // This is what Overview labels "Revenue" — keep the two pages in agreement.
  const totalRevenue = invoiceRevenue + accountsReceivable;
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
  const grossProfit = totalRevenue - totalExpenses - payrollCost;
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

  /* ── Chart data — sales (collected) vs expenses per month, last 6 ── */
  const monthly = useMemo(() => {
    const now = new Date();
    const buckets: { name: string; key: string; sales: number; expense: number }[] =
      [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        name: d.toLocaleString("en", { month: "short" }),
        key: `${d.getFullYear()}-${d.getMonth()}`,
        sales: 0,
        expense: 0,
      });
    }
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    for (const inv of invoices) {
      if (inv.status === "draft" || !inv.issue_date) continue;
      const collected = (inv.total || 0) - (inv.balance ?? 0);
      if (collected <= 0) continue;
      const d = new Date(inv.issue_date);
      const b = byKey.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (b) b.sales += collected;
    }
    for (const e of expenses) {
      if (!e.expense_date) continue;
      const d = new Date(e.expense_date);
      const b = byKey.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (b) b.expense += e.amount;
    }
    return buckets.map(({ name, sales, expense }) => ({ name, sales, expense }));
  }, [invoices, expenses]);

  const chartConfig = {
    sales: { label: "Sales", color: "#FFD600" },
    expense: { label: "Expenses", color: "#B88C00" },
  } satisfies ChartConfig;

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

  /* ── VAT 201 (FTA) — standard-rated VAT from the ledger over the period ── */
  const vat = useMemo(
    () =>
      computeVatReturn(
        txns,
        5, // ponytail: UAE flat 5%; pass company default_tax_rate when multi-rate lands
        dateFrom ? localYmd(dateFrom) : undefined,
        dateTo ? localYmd(dateTo) : undefined
      ),
    [txns, dateFrom, dateTo]
  );

  /* ── Financial statements (point-in-time from account balances) ── */
  const trialBalance = useMemo(() => computeTrialBalance(accounts), [accounts]);
  const balanceSheet = useMemo(() => computeBalanceSheet(accounts), [accounts]);
  const cashSummary = useMemo(
    () =>
      computeCashSummary(
        txns,
        dateFrom ? localYmd(dateFrom) : undefined,
        dateTo ? localYmd(dateTo) : undefined
      ),
    [txns, dateFrom, dateTo]
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
      { metric: "Total Revenue (billed)", amount: totalRevenue },
      { metric: "Collected", amount: invoiceRevenue },
      { metric: "Accounts Receivable", amount: accountsReceivable },
      { metric: "PO Value (non-cancelled)", amount: poValue },
      { metric: "PO Received", amount: poReceived },
      { metric: "Total Expenses", amount: totalExpenses },
      { metric: "Payroll Cost", amount: payrollCost },
      { metric: "Gross Profit", amount: grossProfit },
      { metric: "Inventory Value", amount: invValue },
      { metric: "Cash Position", amount: report?.cash_position ?? 0 },
      { metric: "VAT 201 — Standard-rated supplies (net)", amount: vat.standardSupplyNet },
      { metric: "VAT 201 — Output tax (box 1)", amount: vat.outputVat },
      { metric: "VAT 201 — Standard-rated expenses (net)", amount: vat.standardExpenseNet },
      { metric: "VAT 201 — Input tax recoverable (box 9)", amount: vat.inputVat },
      { metric: "VAT 201 — Net VAT due (box 14)", amount: vat.netVatDue },
      { metric: "Balance Sheet — Total Assets", amount: balanceSheet.totalAssets },
      { metric: "Balance Sheet — Total Liabilities", amount: balanceSheet.totalLiabilities },
      { metric: "Balance Sheet — Total Equity", amount: balanceSheet.totalEquity },
      { metric: "Cash Flow — Net change (period)", amount: cashSummary.net },
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
        <div className="grid grid-cols-1 md:grid-cols-3 border border-border rounded-xl overflow-hidden bg-card mb-6 no-print">
          <div className="p-5 border-b md:border-b-0 md:border-r border-border">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Total Revenue</span>
              <DollarSign size={16} className="text-muted-foreground" />
            </div>
            <p className="mt-3 text-[26px] font-semibold text-foreground leading-tight tracking-tight tabular-nums">
              {aed(totalRevenue)}
            </p>
            <p className="text-[11.5px] text-muted-foreground mt-2">Billed (all)</p>
          </div>
          <div className="p-5 border-b md:border-b-0 md:border-r border-border">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Total Expenses</span>
              <Receipt size={16} className="text-muted-foreground" />
            </div>
            <p className="mt-3 text-[26px] font-semibold text-foreground leading-tight tracking-tight tabular-nums">
              {aed(totalExpenses + payrollCost)}
            </p>
            <p className="text-[11.5px] text-muted-foreground mt-2">Expenses + Payroll</p>
          </div>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Net Profit</span>
              <PiggyBank size={16} className="text-muted-foreground" />
            </div>
            <p
              className={`mt-3 text-[26px] font-semibold leading-tight tracking-tight tabular-nums ${grossProfit >= 0 ? "text-success" : "text-danger"}`}
            >
              {aed(grossProfit)}
            </p>
            <p className="text-[11.5px] text-muted-foreground mt-2">Revenue − Costs</p>
          </div>
        </div>

        {/* ── VAT 201 (FTA) ── */}
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Receipt size={16} className="text-brand-500" />
              <h3 className="font-semibold text-ink">VAT Return (FTA 201)</h3>
            </div>
            <span className="text-xs text-brand-500">
              {vat.from || "start"} → {vat.to || "today"} · standard rate {vat.rate}%
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-brand-500 border-b border-brand-200">
                  <th className="py-1.5 pr-2 font-medium">Box</th>
                  <th className="py-1.5 pr-2 font-medium">Description</th>
                  <th className="py-1.5 pr-2 font-medium text-right">Amount (AED)</th>
                  <th className="py-1.5 font-medium text-right">VAT (AED)</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-b border-brand-100">
                  <td className="py-1.5 pr-2 text-brand-500">1</td>
                  <td className="py-1.5 pr-2">Standard-rated supplies</td>
                  <td className="py-1.5 pr-2 text-right">{aed(vat.standardSupplyNet)}</td>
                  <td className="py-1.5 text-right">{aed(vat.outputVat)}</td>
                </tr>
                <tr className="border-b border-brand-100">
                  <td className="py-1.5 pr-2 text-brand-500">9</td>
                  <td className="py-1.5 pr-2">Standard-rated expenses</td>
                  <td className="py-1.5 pr-2 text-right">{aed(vat.standardExpenseNet)}</td>
                  <td className="py-1.5 text-right">{aed(vat.inputVat)}</td>
                </tr>
                <tr className="font-semibold text-ink">
                  <td className="py-1.5 pr-2 text-brand-500">14</td>
                  <td className="py-1.5 pr-2">
                    Net VAT due{" "}
                    <span className="font-normal text-brand-500">
                      ({vat.netVatDue >= 0 ? "payable" : "refundable"})
                    </span>
                  </td>
                  <td className="py-1.5 pr-2" />
                  <td className="py-1.5 text-right">{aed(Math.abs(vat.netVatDue))}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-brand-400 mt-2">
            Standard-rated figures derived from posted Output/Input VAT for the
            selected period. Zero-rated &amp; exempt supplies (boxes 4–5) and the
            per-emirate split are not yet itemised — set a Period above to file a
            quarter.
          </p>
        </div>

        {/* ── Financial statements ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {/* Balance Sheet */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-ink">Balance Sheet</h3>
              <span
                className={`pill text-[11px] ${
                  balanceSheet.balanced
                    ? "bg-brand-100 text-brand-500"
                    : "bg-danger/15 text-danger"
                }`}
              >
                {balanceSheet.balanced ? "Balanced" : "Out of balance"}
              </span>
            </div>
            <div className="space-y-3 text-sm tabular-nums">
              {[
                { t: "Assets", lines: balanceSheet.assets, total: balanceSheet.totalAssets },
                {
                  t: "Liabilities",
                  lines: balanceSheet.liabilities,
                  total: balanceSheet.totalLiabilities,
                },
                { t: "Equity", lines: balanceSheet.equity, total: balanceSheet.totalEquity },
              ].map((sec) => (
                <div key={sec.t}>
                  <p className="text-xs font-semibold text-brand-500 uppercase tracking-wide mb-1">
                    {sec.t}
                  </p>
                  {sec.lines.length === 0 && (
                    <p className="text-brand-400 text-xs">No accounts</p>
                  )}
                  {sec.lines.map((l, i) => (
                    <div key={(l.code || l.name) + i} className="flex justify-between py-0.5">
                      <span className="text-ink/80">{l.name}</span>
                      <span>{aed(l.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-brand-100 mt-1 pt-1 font-semibold text-ink">
                    <span>Total {sec.t}</span>
                    <span>{aed(sec.total)}</span>
                  </div>
                </div>
              ))}
              <div className="flex justify-between border-t border-brand-200 pt-2 font-semibold text-ink">
                <span>Liabilities + Equity</span>
                <span>{aed(balanceSheet.totalLiabilities + balanceSheet.totalEquity)}</span>
              </div>
            </div>
          </div>

          {/* Trial Balance */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-ink">Trial Balance</h3>
              <span
                className={`pill text-[11px] ${
                  trialBalance.balanced
                    ? "bg-brand-100 text-brand-500"
                    : "bg-danger/15 text-danger"
                }`}
              >
                {trialBalance.balanced
                  ? "Balanced"
                  : `Off by ${aed(Math.abs(trialBalance.totalDebit - trialBalance.totalCredit))}`}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-xs text-brand-500 border-b border-brand-200">
                    <th className="py-1.5 pr-2 font-medium">Account</th>
                    <th className="py-1.5 pr-2 font-medium text-right">Debit</th>
                    <th className="py-1.5 font-medium text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {trialBalance.rows.map((r) => (
                    <tr key={r.code} className="border-b border-brand-100">
                      <td className="py-1 pr-2 text-ink/80">{r.name}</td>
                      <td className="py-1 pr-2 text-right">{r.debit ? aed(r.debit) : "—"}</td>
                      <td className="py-1 text-right">{r.credit ? aed(r.credit) : "—"}</td>
                    </tr>
                  ))}
                  {trialBalance.rows.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-3 text-center text-brand-400 text-xs">
                        No account balances yet
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="font-semibold text-ink border-t border-brand-200">
                    <td className="py-1.5 pr-2">Total</td>
                    <td className="py-1.5 pr-2 text-right">{aed(trialBalance.totalDebit)}</td>
                    <td className="py-1.5 text-right">{aed(trialBalance.totalCredit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* ── Cash flow (summary) ── */}
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <Wallet size={16} className="text-brand-500" /> Cash Flow (summary)
            </h3>
            <span className="text-xs text-brand-500">
              {vat.from || "start"} → {vat.to || "today"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xs text-brand-500">Cash in</p>
              <p className="text-lg font-semibold text-success tabular-nums">
                {aed(cashSummary.inflow)}
              </p>
            </div>
            <div>
              <p className="text-xs text-brand-500">Cash out</p>
              <p className="text-lg font-semibold text-danger tabular-nums">
                {aed(cashSummary.outflow)}
              </p>
            </div>
            <div>
              <p className="text-xs text-brand-500">Net change</p>
              <p className="text-lg font-semibold text-ink tabular-nums">
                {aed(cashSummary.net)}
              </p>
            </div>
          </div>
          <p className="text-[11px] text-brand-400 mt-2">
            Direct cash movement on cash/bank accounts for the period. Not the
            categorised operating/investing/financing statement.
          </p>
        </div>

        {/* ── Metric cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 joined-kpis mb-4">
          <MetricCard
            label="Inventory Value"
            value={aed(invValue)}
            icon={<Boxes size={20} />}
          />
          <MetricCard
            label="Collected"
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

        <div className="grid grid-cols-2 lg:grid-cols-4 joined-kpis mb-6">
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
              <span className="font-medium text-brand-500">Revenue</span>
              <span className="font-medium tabular-nums">{aed(totalRevenue)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-brand-100 pl-4">
              <span className="text-brand-500">Collected</span>
              <span className="tabular-nums">{aed(invoiceRevenue)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-brand-100 pl-4">
              <span className="text-brand-500">Outstanding (AR)</span>
              <span className="tabular-nums">{aed(accountsReceivable)}</span>
            </div>

            <div className="flex justify-between py-2 border-b border-brand-100">
              <span className="font-medium text-brand-500">
                Purchase commitments (POs) <span className="text-brand-400 font-normal">· informational</span>
              </span>
              <span className="font-medium tabular-nums">{aed(poValue)}</span>
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
              <span className="font-medium text-brand-500">Operating Expenses</span>
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

            <div className="flex justify-between py-3 mt-1 rounded-lg bg-muted px-3">
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
          <InfoCard title="Sales vs expenses — last 6 months" className="lg:col-span-2">
            <ChartContainer config={chartConfig} className="h-72 w-full aspect-auto">
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
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
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <ChartBar
                  dataKey="sales"
                  fill="var(--color-sales)"
                  radius={[4, 4, 0, 0]}
                  seriesIndex={0}
                />
                <ChartBar
                  dataKey="expense"
                  fill="var(--color-expense)"
                  radius={[4, 4, 0, 0]}
                  seriesIndex={1}
                />
              </BarChart>
            </ChartContainer>
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
                ["Total Revenue (billed)", totalRevenue],
                ["Collected", invoiceRevenue],
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
