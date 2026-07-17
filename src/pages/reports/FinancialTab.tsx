/* ── FinancialTab: P&L + balance sheet + VAT ──────────────────────────────── */
import { Wallet, Receipt, PiggyBank, DollarSign } from "lucide-react";
import { aed } from "../../lib/format";
import type { ReportsData, ReportsMetrics } from "./useReportsData";
import { ReportKpi } from "./components/ReportKpi";
import { Card, Badge } from "../../components/ui";
import { cn } from "../../lib/format";

export function FinancialTab({
  data,
  metrics,
}: {
  data: ReportsData;
  metrics: ReportsMetrics;
}) {
  const { loading } = data;
  const {
    totalRevenue,
    invoiceRevenue,
    accountsReceivable,
    totalExpenses,
    payrollCost,
    grossProfit,
    poValue,
    poReceived,
    vat,
    trialBalance,
    balanceSheet,
    cashSummary,
  } = metrics;

  return (
    <div className="space-y-6">
      {/* ── KPI cards ── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <ReportKpi
          label="Total Revenue"
          value={aed(totalRevenue)}
          icon={<DollarSign size={20} />}
          iconClass="bg-primary-100 text-ink"
          change="Billed (all)"
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
          label="Cash Position"
          value={aed(data.report?.cash_position ?? 0)}
          icon={<Wallet size={20} />}
          iconClass="bg-info/15 text-info"
          change="Net change"
          changeTone={cashSummary.net >= 0 ? "up" : "down"}
          loading={loading}
        />
      </section>

      {/* ── Profit & Loss Statement ── */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-ink mb-4 tracking-tight">
          Profit &amp; Loss Statement
        </h2>
        <div className="space-y-2 text-sm">
          {/* Revenue */}
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

          {/* Purchase commitments */}
          <div className="flex justify-between py-2 border-b border-brand-100">
            <span className="font-medium text-brand-500">
              Purchase commitments (POs){" "}
              <span className="text-brand-400 font-normal">· informational</span>
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

          {/* Operating expenses */}
          <div className="flex justify-between py-2 border-b border-brand-100">
            <span className="font-medium text-brand-500">Operating Expenses</span>
            <span className="font-medium tabular-nums">({aed(totalExpenses + payrollCost)})</span>
          </div>
          <div className="flex justify-between py-2 border-b border-brand-100 pl-4">
            <span className="text-brand-500">General expenses</span>
            <span className="tabular-nums">{aed(totalExpenses)}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-brand-100 pl-4">
            <span className="text-brand-500">Payroll</span>
            <span className="tabular-nums">{aed(payrollCost)}</span>
          </div>

          {/* Net */}
          <div className="flex justify-between py-3 mt-1 rounded-lg bg-muted px-3">
            <span className="font-semibold text-ink text-base">Net Profit / (Loss)</span>
            <span
              className={cn(
                "font-semibold text-base tabular-nums",
                grossProfit >= 0 ? "text-success" : "text-danger"
              )}
            >
              {aed(grossProfit)}
            </span>
          </div>
        </div>
      </Card>

      {/* ── VAT 201 (FTA) ── */}
      <Card className="p-5">
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
          Standard-rated figures derived from posted Output/Input VAT for the selected
          period. Zero-rated &amp; exempt supplies (boxes 4–5) and the per-emirate split
          are not yet itemised — set a Period above to file a quarter.
        </p>
      </Card>

      {/* ── Balance Sheet + Trial Balance ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Balance Sheet */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-ink">Balance Sheet</h3>
            <Badge tone={balanceSheet.balanced ? "neutral" : "danger"}>
              {balanceSheet.balanced ? "Balanced" : "Out of balance"}
            </Badge>
          </div>
          <div className="space-y-3 text-sm tabular-nums">
            {[
              { t: "Assets", lines: balanceSheet.assets, total: balanceSheet.totalAssets },
              {
                t: "Liabilities",
                lines: balanceSheet.liabilities,
                total: balanceSheet.totalLiabilities,
              },
              {
                t: "Equity",
                lines: balanceSheet.equity,
                total: balanceSheet.totalEquity,
              },
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
        </Card>

        {/* Trial Balance */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-ink">Trial Balance</h3>
            <Badge tone={trialBalance.balanced ? "neutral" : "danger"}>
              {trialBalance.balanced
                ? "Balanced"
                : `Off by ${aed(Math.abs(trialBalance.totalDebit - trialBalance.totalCredit))}`}
            </Badge>
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
        </Card>
      </div>

      {/* ── Cash flow summary ── */}
      <Card className="p-5">
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
          Direct cash movement on cash/bank accounts for the period. Not the categorised
          operating/investing/financing statement.
        </p>
      </Card>
    </div>
  );
}