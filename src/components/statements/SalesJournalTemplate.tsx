import type { SalesJournal } from "./buildSalesJournal";

export interface SalesJournalTemplateProps {
  data: SalesJournal;
}

const num = (n: number) =>
  (Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** Compact Journal — matches the DUNE Sales & Collections Journal style.
 *  Dense, black & white, every invoice line item in one table with
 *  SL/Date/Description/Unit/Qty/Rate/Amount/VAT/Total/InvoiceNo/Received. */
export function SalesJournalTemplate({ data }: SalesJournalTemplateProps) {
  const { company, customer, period, summary, transactions } = data;

  return (
    <div
      className="bg-white text-neutral-900 p-6 text-[9.5px] leading-snug font-sans"
      style={{ minHeight: 700, width: 794 }}
    >
      {/* Header */}
      <div className="text-center pb-2">
        <div className="text-[15px] font-bold uppercase tracking-wide">
          {company.name}
        </div>
        {company.address && (
          <div className="text-neutral-600 whitespace-pre-line text-[9px]">
            {company.address}
          </div>
        )}
        {company.trn && (
          <div className="text-neutral-600 text-[9px]">TRN: {company.trn}</div>
        )}
      </div>

      <div className="h-0.5 bg-neutral-900 my-2" />

      <div className="text-center">
        <div className="text-[12.5px] font-bold uppercase tracking-widest">
          Sales & Collections Journal Statement
        </div>
        <div className="text-neutral-600 text-[9.5px]">
          Customer: {customer.company || customer.name} • Period {period.from} →{" "}
          {period.to}
        </div>
      </div>

      {/* Summary boxes */}
      <div className="grid grid-cols-3 gap-2 my-3">
        <SummaryBox label="TOTAL DOCUMENTED SALES" value={`AED ${num(summary.totalSales)}`} />
        <SummaryBox label="TOTAL FUNDS RECEIVED" value={`AED ${num(summary.totalReceived)}`} />
        <SummaryBox
          label="NET BALANCE (PENDING / ADVANCE)"
          value={`AED ${num(summary.netBalance)}`}
          tone={summary.netBalance < 0 ? "red" : "green"}
        />
      </div>

      {/* Main table */}
      <table className="w-full text-left border border-neutral-900">
        <thead>
          <tr className="bg-neutral-900 text-white text-[9px] uppercase tracking-wider">
            <th className="px-1.5 py-1 w-6">SL</th>
            <th className="px-1.5 py-1 w-14">Date</th>
            <th className="px-1.5 py-1">Description</th>
            <th className="px-1.5 py-1 w-8">Unit</th>
            <th className="px-1.5 py-1 text-right w-10">Qty</th>
            <th className="px-1.5 py-1 text-right w-10">Rate</th>
            <th className="px-1.5 py-1 text-right w-14">Amount</th>
            <th className="px-1.5 py-1 text-right w-10">VAT</th>
            <th className="px-1.5 py-1 text-right w-14">Total</th>
            <th className="px-1.5 py-1 w-20">Invoice No.</th>
            <th className="px-1.5 py-1 text-right w-14">Received</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t, i) => (
            <tr key={i} className="border-b border-neutral-200 even:bg-neutral-50">
              <td className="px-1.5 py-0.5">{t.sl || "-"}</td>
              <td className="px-1.5 py-0.5">{t.date}</td>
              <td className="px-1.5 py-0.5">{t.description}</td>
              <td className="px-1.5 py-0.5">{t.unit || "-"}</td>
              <td className="px-1.5 py-0.5 text-right">{t.qty || "-"}</td>
              <td className="px-1.5 py-0.5 text-right">{t.rate || "-"}</td>
              <td className="px-1.5 py-0.5 text-right">{t.amount || "-"}</td>
              <td className="px-1.5 py-0.5 text-right">{t.vat || "-"}</td>
              <td className="px-1.5 py-0.5 text-right">{t.total || "-"}</td>
              <td className="px-1.5 py-0.5">{t.invoiceNo || "-"}</td>
              <td className="px-1.5 py-0.5 text-right">
                {t.received !== "—" ? Number(t.received).toFixed(2) : "-"}
              </td>
            </tr>
          ))}
          {/* Total row */}
          <tr className="bg-neutral-900 text-white font-bold">
            <td colSpan={6} className="px-1.5 py-1.5 text-right">
              TOTAL SUMMARY
            </td>
            <td className="px-1.5 py-1.5 text-right">
              {num(summary.totalSales - summary.totalVat)}
            </td>
            <td className="px-1.5 py-1.5 text-right">{num(summary.totalVat)}</td>
            <td className="px-1.5 py-1.5 text-right">{num(summary.totalSales)}</td>
            <td></td>
            <td className="px-1.5 py-1.5 text-right">{num(summary.totalReceived)}</td>
          </tr>
        </tbody>
      </table>

      {/* Footer */}
      <div className="mt-3 text-[9px] text-neutral-600 flex items-center justify-between">
        <span>Generated on {new Date().toLocaleDateString()}</span>
        <span>
          PENDING / ADVANCE BALANCE: AED {num(summary.netBalance)}
        </span>
      </div>

      {summary.totalVat > 0 && (
        <div className="mt-1 text-[9px] text-neutral-600">
          VAT breakdown: Net AED {num(summary.totalSales - summary.totalVat)} +
          VAT AED {num(summary.totalVat)} = Total AED {num(summary.totalSales)}
        </div>
      )}
    </div>
  );
}

function SummaryBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "red" | "green";
}) {
  const color =
    tone === "red"
      ? "text-red-700"
      : tone === "green"
        ? "text-emerald-700"
        : "text-neutral-900";
  return (
    <div className="border border-neutral-900 p-2">
      <div className="text-[8.5px] uppercase tracking-wider text-neutral-600">
        {label}
      </div>
      <div className={`text-[13px] font-bold mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}