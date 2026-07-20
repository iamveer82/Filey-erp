import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { aed, cn } from "../../lib/format";
import { useChartColors } from "../../lib/accent";
import { ReportsData, useFinancials } from "./useReportsData";

export default function FinancialTab({ data }: { data: ReportsData }) {
  const c = useChartColors();
  const fin = useFinancials(data.accounts, data.txns);

  const tooltipStyle = {
    borderRadius: 8,
    fontSize: 12,
    background: c.tooltipBg,
    border: `1px solid ${c.tooltipBorder}`,
    color: c.tooltipFg,
  };

  /* Expense by category bar chart */
  const expenseByCategory = useMemo(() => {
    const g = new Map<string, number>();
    for (const e of data.expenses) {
      const key = e.category || "Other";
      g.set(key, (g.get(key) ?? 0) + (Number(e.amount) || 0));
    }
    return Array.from(g.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [data.expenses]);

  /* P&L rows */
  const plRows = useMemo(() => {
    const revenueAccts = data.accounts.filter((a) => a.account_type === "revenue");
    const expenseAccts = data.accounts.filter((a) => a.account_type === "expense");
    return { revenueAccts, expenseAccts };
  }, [data.accounts]);

  /* Balance sheet rows */
  const bs = fin.balanceSheet;

  const kpis = [
    {
      label: "Net Profit",
      value: aed(fin.netProfit),
      hint: "Revenue − Expenses",
    },
    {
      label: "Total Revenue",
      value: aed(fin.revenue),
      hint: `${plRows.revenueAccts.length} accounts`,
    },
    {
      label: "Total Expenses",
      value: aed(fin.expensesTotal),
      hint: `${plRows.expenseAccts.length} accounts`,
    },
    {
      label: "Cash Position",
      value: aed(fin.cashSummary.net),
      hint: `In: ${aed(fin.cashSummary.inflow)} · Out: ${aed(fin.cashSummary.outflow)}`,
    },
  ];

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-border rounded-xl overflow-hidden bg-card">
        {kpis.map((k, i) => (
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
            <div className="mt-2 text-[11.5px] text-muted-foreground">{k.hint}</div>
          </div>
        ))}
      </div>

      {/* P&L statement + Expense by category */}
      <div className="grid grid-cols-1 lg:grid-cols-2 border border-border rounded-xl overflow-hidden bg-card">
        {/* P&L */}
        <div className="p-5 border-b lg:border-b-0 lg:border-r border-border">
          <div className="text-[14px] font-semibold text-foreground">Profit & Loss</div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Current period — from account balances
          </div>
          <div className="mt-4 space-y-1">
            {/* Revenue */}
            <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide pt-1">
              Revenue
            </div>
            {plRows.revenueAccts.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between text-[13px] py-1"
              >
                <span className="text-foreground">{a.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {aed(Number(a.balance) || 0)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between text-[13px] py-2 border-t border-border font-semibold">
              <span className="text-foreground">Total Revenue</span>
              <span className="text-foreground tabular-nums">{aed(fin.revenue)}</span>
            </div>

            {/* Expenses */}
            <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide pt-3">
              Expenses
            </div>
            {plRows.expenseAccts.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between text-[13px] py-1"
              >
                <span className="text-foreground">{a.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {aed(Number(a.balance) || 0)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between text-[13px] py-2 border-t border-border font-semibold">
              <span className="text-foreground">Total Expenses</span>
              <span className="text-foreground tabular-nums">
                {aed(fin.expensesTotal)}
              </span>
            </div>

            {/* Net profit */}
            <div className="flex items-center justify-between text-[14px] py-3 border-t-2 border-border font-bold mt-2">
              <span className="text-foreground">Net Profit</span>
              <span
                className={cn(
                  "tabular-nums",
                  fin.netProfit >= 0 ? "text-success" : "text-danger"
                )}
              >
                {aed(fin.netProfit)}
              </span>
            </div>
          </div>
        </div>

        {/* Expense by category chart */}
        <div className="p-5">
          <div className="text-[14px] font-semibold text-foreground">
            Expenses by category
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            From recorded expense entries
          </div>
          {expenseByCategory.length === 0 ? (
            <div className="h-[280px] mt-3 grid place-items-center text-[12.5px] text-muted-foreground">
              No expenses recorded
            </div>
          ) : (
            <div className="h-[280px] mt-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={expenseByCategory}
                  margin={{ top: 10, right: 10, left: -12, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="expG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={c.accent} stopOpacity={0.95} />
                      <stop offset="100%" stopColor={c.accent} stopOpacity={0.4} />
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
                    formatter={(v) => aed(Number(v) || 0)}
                  />
                  <Bar
                    dataKey="value"
                    name="AED"
                    fill="url(#expG)"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Balance sheet + VAT return */}
      <div className="grid grid-cols-1 lg:grid-cols-2 border border-border rounded-xl overflow-hidden bg-card">
        {/* Balance sheet */}
        <div className="p-5 border-b lg:border-b-0 lg:border-r border-border">
          <div className="text-[14px] font-semibold text-foreground">Balance Sheet</div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Assets = Liabilities + Equity
            {bs.balanced ? " · Balanced" : " · Out of balance"}
          </div>
          <div className="mt-4 space-y-3">
            {/* Assets */}
            <div>
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">
                Assets
              </div>
              {bs.assets.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-[13px] py-1"
                >
                  <span className="text-foreground">{a.name || "—"}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {aed(a.amount)}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between text-[13px] py-1.5 border-t border-border font-semibold">
                <span className="text-foreground">Total Assets</span>
                <span className="text-foreground tabular-nums">
                  {aed(bs.totalAssets)}
                </span>
              </div>
            </div>

            {/* Liabilities */}
            <div>
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide pt-2">
                Liabilities
              </div>
              {bs.liabilities.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-[13px] py-1"
                >
                  <span className="text-foreground">{a.name || "—"}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {aed(a.amount)}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between text-[13px] py-1.5 border-t border-border font-semibold">
                <span className="text-foreground">Total Liabilities</span>
                <span className="text-foreground tabular-nums">
                  {aed(bs.totalLiabilities)}
                </span>
              </div>
            </div>

            {/* Equity */}
            <div>
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide pt-2">
                Equity
              </div>
              {bs.equity.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-[13px] py-1"
                >
                  <span className="text-foreground">{a.name || "—"}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {aed(a.amount)}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between text-[13px] py-1.5 border-t border-border font-semibold">
                <span className="text-foreground">Total Equity</span>
                <span className="text-foreground tabular-nums">
                  {aed(bs.totalEquity)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* VAT return */}
        <div className="p-5">
          <div className="text-[14px] font-semibold text-foreground">
            VAT Return (UAE FTA 201)
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            Standard rate: {(fin.vatReturn.rate * 100).toFixed(0)}% · From ledger postings
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-[13px] py-2 border-b border-border">
              <span className="text-muted-foreground">Standard-rated supplies (net)</span>
              <span className="text-foreground tabular-nums font-medium">
                {aed(fin.vatReturn.standardSupplyNet)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[13px] py-2 border-b border-border">
              <span className="text-muted-foreground">Output VAT (Box 1)</span>
              <span className="text-foreground tabular-nums font-medium">
                {aed(fin.vatReturn.outputVat)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[13px] py-2 border-b border-border">
              <span className="text-muted-foreground">Standard-rated expenses (net)</span>
              <span className="text-foreground tabular-nums font-medium">
                {aed(fin.vatReturn.standardExpenseNet)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[13px] py-2 border-b border-border">
              <span className="text-muted-foreground">Input VAT (Box 9)</span>
              <span className="text-foreground tabular-nums font-medium">
                {aed(fin.vatReturn.inputVat)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[14px] py-3 border-t-2 border-border font-bold mt-2">
              <span className="text-foreground">Net VAT Due</span>
              <span
                className={cn(
                  "tabular-nums",
                  fin.vatReturn.netVatDue >= 0 ? "text-foreground" : "text-success"
                )}
              >
                {aed(fin.vatReturn.netVatDue)}
              </span>
            </div>
          </div>

          {/* Cash flow summary */}
          <div className="mt-6 pt-4 border-t border-border">
            <div className="text-[14px] font-semibold text-foreground">Cash Flow</div>
            <div className="text-[12.5px] text-muted-foreground mt-0.5">
              All-time cash movements
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border p-3">
                <div className="text-[11.5px] text-muted-foreground">Inflow</div>
                <div className="text-[16px] font-semibold text-success tabular-nums mt-1">
                  {aed(fin.cashSummary.inflow)}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-[11.5px] text-muted-foreground">Outflow</div>
                <div className="text-[16px] font-semibold text-danger tabular-nums mt-1">
                  {aed(fin.cashSummary.outflow)}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-[11.5px] text-muted-foreground">Net</div>
                <div
                  className={cn(
                    "text-[16px] font-semibold tabular-nums mt-1",
                    fin.cashSummary.net >= 0 ? "text-foreground" : "text-danger"
                  )}
                >
                  {aed(fin.cashSummary.net)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Trial balance */}
      <div className="border border-border rounded-xl overflow-hidden bg-card">
        <div className="px-5 pt-4 pb-3">
          <div className="text-[14px] font-semibold text-foreground">Trial Balance</div>
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            All accounts with non-zero balances ·
            {fin.trialBalance.balanced ? " Books balanced" : " Out of balance"}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="px-5 py-2.5 font-medium text-[12px]">Code</th>
                <th className="px-5 py-2.5 font-medium text-[12px]">Account</th>
                <th className="px-5 py-2.5 font-medium text-[12px]">Type</th>
                <th className="px-5 py-2.5 font-medium text-[12px] text-right">Debit</th>
                <th className="px-5 py-2.5 font-medium text-[12px] text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {fin.trialBalance.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    No accounts with balances
                  </td>
                </tr>
              )}
              {fin.trialBalance.rows.map((r, i) => (
                <tr
                  key={i}
                  className="border-b border-border last:border-0 hover:bg-hover transition-colors"
                >
                  <td className="px-5 py-3 text-muted-foreground tabular-nums">{r.code}</td>
                  <td className="px-5 py-3 text-foreground">{r.name}</td>
                  <td className="px-5 py-3 text-muted-foreground capitalize">{r.type}</td>
                  <td className="px-5 py-3 text-right text-foreground tabular-nums">
                    {r.debit > 0 ? aed(r.debit) : "—"}
                  </td>
                  <td className="px-5 py-3 text-right text-foreground tabular-nums">
                    {r.credit > 0 ? aed(r.credit) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            {fin.trialBalance.rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td colSpan={3} className="px-5 py-3 text-foreground">
                    Total
                  </td>
                  <td className="px-5 py-3 text-right text-foreground tabular-nums">
                    {aed(fin.trialBalance.totalDebit)}
                  </td>
                  <td className="px-5 py-3 text-right text-foreground tabular-nums">
                    {aed(fin.trialBalance.totalCredit)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}