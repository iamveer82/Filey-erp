import { useEffect, useMemo, useRef, useState } from "react";
import {
  TrendingUp,
  Wallet,
  Boxes,
  Download,
  FileText,
  Receipt,
  ShoppingCart,
} from "lucide-react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
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
import {
  PageHeader,
  MetricCard,
  Badge,
  Spinner,
  ErrorBanner,
} from "../components/ui";
import { downloadElementAsPdf } from "../lib/pdfTools";
import { DateRangePicker } from "../components/DatePicker";
import { useChartColors } from "../lib/accent";
import { Calendar } from "lucide-react";

export default function Reports() {
  const c = useChartColors();
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

  /* ── Accent-driven chart palette (DEMO useChartColors) ── */
  const pieColors = [c.accent, c.primary, "#10b981", "#f43f5e", c.accentSoft, "#6366f1"];
  const tooltipStyle = {
    borderRadius: 8,
    fontSize: 12,
    background: c.tooltipBg,
    border: `1px solid ${c.tooltipBorder}`,
    color: c.tooltipFg,
  };

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
        <Calendar size={15} className="text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Period</span>
        <DateRangePicker
          from={dateFrom}
          to={dateTo}
          onFromChange={setDateFrom}
          onToChange={setDateTo}
        />
        {(dateFrom || dateTo) && (
          <button
            className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
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
        {/* ── Summary strip (DEMO joined KPIs) ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 border border-border rounded-xl overflow-hidden bg-card mb-6 no-print">
          <div className="p-5 border-b md:border-b-0 md:border-r border-border">
            <div className="text-[13px] text-muted-foreground">Total Revenue</div>
            <div className="mt-3 text-[26px] font-semibold text-foreground leading-tight tracking-tight tabular-nums">
              {aed(totalRevenue)}
            </div>
            <div className="mt-2 text-[11.5px] text-muted-foreground">Billed (all)</div>
          </div>
          <div className="p-5 border-b md:border-b-0 md:border-r border-border">
            <div className="text-[13px] text-muted-foreground">Total Expenses</div>
            <div className="mt-3 text-[26px] font-semibold text-foreground leading-tight tracking-tight tabular-nums">
              {aed(totalExpenses + payrollCost)}
            </div>
            <div className="mt-2 text-[11.5px] text-muted-foreground">
              Expenses + Payroll
            </div>
          </div>
          <div className="p-5">
            <div className="text-[13px] text-muted-foreground">Net Profit</div>
            <div
              className={`mt-3 text-[26px] font-semibold leading-tight tracking-tight tabular-nums ${grossProfit >= 0 ? "text-success" : "text-danger"}`}
            >
              {aed(grossProfit)}
            </div>
            <div className="mt-2 text-[11.5px] text-muted-foreground">Revenue − Costs</div>
          </div>
        </div>

        {/* ── VAT 201 (FTA) ── */}
        <div className="card mb-4 !p-0 overflow-hidden">
          <div className="flex items-center justify-between flex-wrap gap-2 px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Receipt size={16} className="text-muted-foreground" />
              <h3 className="text-[14px] font-semibold text-foreground">
                VAT Return (FTA 201)
              </h3>
            </div>
            <span className="text-xs text-muted-foreground">
              {vat.from || "start"} → {vat.to || "today"} · standard rate {vat.rate}%
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-border">
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                    Box
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                    Description
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground text-right">
                    Amount (AED)
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground text-right">
                    VAT (AED)
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-b border-border hover:bg-hover">
                  <td className="px-5 py-3 text-[13px] text-muted-foreground">1</td>
                  <td className="px-5 py-3 text-[13px]">Standard-rated supplies</td>
                  <td className="px-5 py-3 text-[13px] text-right">
                    {aed(vat.standardSupplyNet)}
                  </td>
                  <td className="px-5 py-3 text-[13px] text-right">{aed(vat.outputVat)}</td>
                </tr>
                <tr className="border-b border-border hover:bg-hover">
                  <td className="px-5 py-3 text-[13px] text-muted-foreground">9</td>
                  <td className="px-5 py-3 text-[13px]">Standard-rated expenses</td>
                  <td className="px-5 py-3 text-[13px] text-right">
                    {aed(vat.standardExpenseNet)}
                  </td>
                  <td className="px-5 py-3 text-[13px] text-right">{aed(vat.inputVat)}</td>
                </tr>
                <tr className="font-semibold text-foreground">
                  <td className="px-5 py-3 text-[13px] text-muted-foreground">14</td>
                  <td className="px-5 py-3 text-[13px]">
                    Net VAT due{" "}
                    <span className="font-normal text-muted-foreground">
                      ({vat.netVatDue >= 0 ? "payable" : "refundable"})
                    </span>
                  </td>
                  <td className="px-5 py-3 text-[13px]" />
                  <td className="px-5 py-3 text-[13px] text-right">
                    {aed(Math.abs(vat.netVatDue))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground px-5 py-3 border-t border-border">
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
              <h3 className="text-[14px] font-semibold text-foreground">Balance Sheet</h3>
              <Badge tone={balanceSheet.balanced ? "success" : "danger"}>
                {balanceSheet.balanced ? "Balanced" : "Out of balance"}
              </Badge>
            </div>
            <div className="space-y-3 text-[13px] tabular-nums">
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
                  <p className="text-[12px] font-medium tracking-wide uppercase text-muted-foreground mb-1">
                    {sec.t}
                  </p>
                  {sec.lines.length === 0 && (
                    <p className="text-muted-foreground text-xs">No accounts</p>
                  )}
                  {sec.lines.map((l, i) => (
                    <div key={(l.code || l.name) + i} className="flex justify-between py-1">
                      <span className="text-muted-foreground">{l.name}</span>
                      <span className="text-foreground">{aed(l.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-border mt-1 pt-1.5 font-semibold text-foreground">
                    <span>Total {sec.t}</span>
                    <span>{aed(sec.total)}</span>
                  </div>
                </div>
              ))}
              <div className="flex justify-between border-t border-border pt-2 font-semibold text-foreground">
                <span>Liabilities + Equity</span>
                <span>{aed(balanceSheet.totalLiabilities + balanceSheet.totalEquity)}</span>
              </div>
            </div>
          </div>

          {/* Trial Balance */}
          <div className="card !p-0 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-[14px] font-semibold text-foreground">Trial Balance</h3>
              <Badge tone={trialBalance.balanced ? "success" : "danger"}>
                {trialBalance.balanced
                  ? "Balanced"
                  : `Off by ${aed(Math.abs(trialBalance.totalDebit - trialBalance.totalCredit))}`}
              </Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full tabular-nums">
                <thead>
                  <tr className="text-left border-b border-border">
                    <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                      Account
                    </th>
                    <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground text-right">
                      Debit
                    </th>
                    <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground text-right">
                      Credit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {trialBalance.rows.map((r) => (
                    <tr key={r.code} className="border-b border-border hover:bg-hover">
                      <td className="px-5 py-3 text-[13px] text-muted-foreground">
                        {r.name}
                      </td>
                      <td className="px-5 py-3 text-[13px] text-right">
                        {r.debit ? aed(r.debit) : "—"}
                      </td>
                      <td className="px-5 py-3 text-[13px] text-right">
                        {r.credit ? aed(r.credit) : "—"}
                      </td>
                    </tr>
                  ))}
                  {trialBalance.rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-5 py-8 text-center text-[13px] text-muted-foreground"
                      >
                        No account balances yet
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="font-semibold text-foreground bg-muted/50">
                    <td className="px-5 py-3 text-[13px]">Total</td>
                    <td className="px-5 py-3 text-[13px] text-right">
                      {aed(trialBalance.totalDebit)}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-right">
                      {aed(trialBalance.totalCredit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* ── Cash flow (summary) ── */}
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2">
              <Wallet size={16} className="text-muted-foreground" /> Cash Flow (summary)
            </h3>
            <span className="text-xs text-muted-foreground">
              {vat.from || "start"} → {vat.to || "today"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-[12px] text-muted-foreground">Cash in</p>
              <p className="text-lg font-semibold text-success tabular-nums mt-1">
                {aed(cashSummary.inflow)}
              </p>
            </div>
            <div>
              <p className="text-[12px] text-muted-foreground">Cash out</p>
              <p className="text-lg font-semibold text-danger tabular-nums mt-1">
                {aed(cashSummary.outflow)}
              </p>
            </div>
            <div>
              <p className="text-[12px] text-muted-foreground">Net change</p>
              <p className="text-lg font-semibold text-foreground tabular-nums mt-1">
                {aed(cashSummary.net)}
              </p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
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
          <h2 className="text-[14px] font-semibold text-foreground mb-4">
            Profit &amp; Loss Statement
          </h2>
          <div className="space-y-2 text-[13px]">
            <div className="flex justify-between py-2 border-b border-border">
              <span className="font-medium text-foreground">Revenue</span>
              <span className="font-medium tabular-nums">{aed(totalRevenue)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border pl-4">
              <span className="text-muted-foreground">Collected</span>
              <span className="tabular-nums">{aed(invoiceRevenue)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border pl-4">
              <span className="text-muted-foreground">Outstanding (AR)</span>
              <span className="tabular-nums">{aed(accountsReceivable)}</span>
            </div>

            <div className="flex justify-between py-2 border-b border-border">
              <span className="font-medium text-foreground">
                Purchase commitments (POs){" "}
                <span className="text-muted-foreground font-normal">· informational</span>
              </span>
              <span className="font-medium tabular-nums">{aed(poValue)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border pl-4">
              <span className="text-muted-foreground">Purchase Orders (non-cancelled)</span>
              <span className="tabular-nums">{aed(poValue)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border pl-4">
              <span className="text-muted-foreground">Received into stock</span>
              <span className="tabular-nums">{aed(poReceived)}</span>
            </div>

            <div className="flex justify-between py-2 border-b border-border">
              <span className="font-medium text-foreground">Operating Expenses</span>
              <span className="font-medium tabular-nums">
                ({aed(totalExpenses + payrollCost)})
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-border pl-4">
              <span className="text-muted-foreground">General expenses</span>
              <span className="tabular-nums">{aed(totalExpenses)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border pl-4">
              <span className="text-muted-foreground">Payroll</span>
              <span className="tabular-nums">{aed(payrollCost)}</span>
            </div>

            <div className="flex justify-between py-3 mt-1 rounded-lg bg-muted px-3">
              <span className="font-medium text-foreground text-base">
                Net Profit / (Loss)
              </span>
              <span
                className={`font-medium text-base tabular-nums ${grossProfit >= 0 ? "text-success" : "text-danger"}`}
              >
                {aed(grossProfit)}
              </span>
            </div>
          </div>
        </div>

        {/* ── Charts (no-print) — DEMO joined chart card ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 border border-border rounded-xl overflow-hidden bg-card mb-6 no-print">
          <div className="lg:col-span-2 p-5 border-b lg:border-b-0 lg:border-r border-border">
            <div className="text-[14px] font-semibold text-foreground">
              Sales vs expenses
            </div>
            <div className="text-[12.5px] text-muted-foreground mt-0.5">
              Last 6 months — collected vs spent
            </div>
            <div className="h-[280px] mt-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 10, right: 4, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="repSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={c.accent} stopOpacity={0.95} />
                      <stop offset="100%" stopColor={c.accent} stopOpacity={0.35} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                  <XAxis
                    dataKey="name"
                    stroke={c.axis}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    stroke={c.axis}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: "currentColor", fillOpacity: 0.04 }}
                    formatter={(v) => aed(Number(v) || 0)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: c.axis }} />
                  <Bar
                    dataKey="sales"
                    name="Sales"
                    fill="url(#repSales)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="expense"
                    name="Expenses"
                    fill={c.primary}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="p-5">
            <div className="text-[14px] font-semibold text-foreground">
              Spending by category
            </div>
            <div className="text-[12.5px] text-muted-foreground mt-0.5">
              All recorded expenses
            </div>
            {expenseByCat.length > 0 ? (
              <>
                <div className="h-[220px] mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={expenseByCat}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {expenseByCat.map((_, i) => (
                          <Cell key={i} fill={pieColors[i % pieColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(v) => aed(Number(v) || 0)}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1.5 mt-2">
                  {expenseByCat.map((s, i) => (
                    <div
                      key={s.name}
                      className="flex items-center justify-between text-[12.5px]"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: pieColors[i % pieColors.length] }}
                        />
                        <span className="text-foreground">{s.name}</span>
                      </div>
                      <span className="text-muted-foreground tabular-nums">
                        {aed(s.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-[220px] text-[13px] text-muted-foreground">
                No expenses recorded
              </div>
            )}
          </div>
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
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-[14px] font-semibold text-foreground">Sales Invoices</h2>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">
              {invoiceTxns.length} invoices · {aed(invoiceRevenue)} collected
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-border">
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground w-8">
                    SL
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                    Date
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                    Customer
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                    Description
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground w-28 text-right">
                    Amount
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground w-16 text-center">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoiceTxns.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-5 py-8 text-center text-[13px] text-muted-foreground"
                    >
                      No invoice transactions
                    </td>
                  </tr>
                ) : (
                  invoiceTxns.map((inv, i) => (
                    <tr key={inv.id} className="border-b border-border hover:bg-hover">
                      <td className="px-5 py-3 text-[13px] text-muted-foreground">
                        {i + 1}
                      </td>
                      <td className="px-5 py-3 text-[13px] tabular-nums text-muted-foreground">
                        {fmtDate(inv.issue_date)}
                      </td>
                      <td className="px-5 py-3 text-[13px] font-medium">
                        {inv.customer_name || "—"}
                      </td>
                      <td className="px-5 py-3 text-[13px] text-muted-foreground">
                        {inv.number}
                      </td>
                      <td className="px-5 py-3 text-[13px] text-right font-medium tabular-nums">
                        {aed(inv.total)}
                      </td>
                      <td className="px-5 py-3 text-[13px] text-center">
                        <Badge tone={inv.balance === 0 ? "success" : "warn"}>
                          {inv.balance === 0 ? "Paid" : "Open"}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="bg-muted/50 font-semibold text-foreground">
                  <td colSpan={4} className="px-5 py-3 text-[13px] text-right">
                    Grand Total
                  </td>
                  <td className="px-5 py-3 text-[13px] text-right tabular-nums">
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
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-[14px] font-semibold text-foreground">Purchase Orders</h2>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">
              {poTxns.length} POs · {aed(poValue)} total value
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-border">
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground w-8">
                    SL
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                    Date
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                    Supplier
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                    Description
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground w-28 text-right">
                    Amount
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground w-16 text-center">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {poTxns.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-5 py-8 text-center text-[13px] text-muted-foreground"
                    >
                      No purchase orders
                    </td>
                  </tr>
                ) : (
                  poTxns.map((po, i) => (
                    <tr key={po.id} className="border-b border-border hover:bg-hover">
                      <td className="px-5 py-3 text-[13px] text-muted-foreground">
                        {i + 1}
                      </td>
                      <td className="px-5 py-3 text-[13px] tabular-nums text-muted-foreground">
                        {fmtDate(po.order_date)}
                      </td>
                      <td className="px-5 py-3 text-[13px] font-medium">
                        {po.supplier_name}
                      </td>
                      <td className="px-5 py-3 text-[13px] text-muted-foreground">
                        {po.po_number}
                      </td>
                      <td className="px-5 py-3 text-[13px] text-right font-medium tabular-nums">
                        {aed(po.total)}
                      </td>
                      <td className="px-5 py-3 text-[13px] text-center">
                        <Badge
                          tone={
                            po.status === "received"
                              ? "success"
                              : po.status === "cancelled"
                                ? "danger"
                                : "info"
                          }
                        >
                          {po.status}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="bg-muted/50 font-semibold text-foreground">
                  <td colSpan={4} className="px-5 py-3 text-[13px] text-right">
                    PO Total (non-cancelled)
                  </td>
                  <td className="px-5 py-3 text-[13px] text-right tabular-nums">
                    {aed(poValue)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Expense transactions */}
        <div className="card p-0 overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-[14px] font-semibold text-foreground">Expenses</h2>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">
              {expenseTxns.length} expenses · {aed(totalExpenses)} total
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-border">
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground w-8">
                    SL
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                    Date
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                    Category
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                    Description
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground w-28 text-right">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {expenseTxns.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-5 py-8 text-center text-[13px] text-muted-foreground"
                    >
                      No expenses recorded
                    </td>
                  </tr>
                ) : (
                  expenseTxns.map((e, i) => (
                    <tr key={e.id} className="border-b border-border hover:bg-hover">
                      <td className="px-5 py-3 text-[13px] text-muted-foreground">
                        {i + 1}
                      </td>
                      <td className="px-5 py-3 text-[13px] tabular-nums text-muted-foreground">
                        {fmtDate(e.expense_date)}
                      </td>
                      <td className="px-5 py-3 text-[13px] font-medium">
                        {e.category || "—"}
                      </td>
                      <td className="px-5 py-3 text-[13px] text-muted-foreground">
                        {e.description || "—"}
                      </td>
                      <td className="px-5 py-3 text-[13px] text-right font-medium tabular-nums">
                        {aed(e.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="bg-muted/50 font-semibold text-foreground">
                  <td colSpan={4} className="px-5 py-3 text-[13px] text-right">
                    Total Expenses
                  </td>
                  <td className="px-5 py-3 text-[13px] text-right tabular-nums">
                    {aed(totalExpenses)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-3 no-print">
        {num(products.length)} products · {num(invoiceTxns.length)} invoices ·{" "}
        {num(poTxns.length)} POs · {num(expenseTxns.length)} expenses · figures in{" "}
        {getDisplayCurrency()}
      </p>
    </div>
  );
}
