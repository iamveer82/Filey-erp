import type { ComponentType, ReactNode } from "react";
import { money } from "../../lib/format";

/* ------------------------------------------------------------------ */
/*  Statement of Account templates — TSX port of the six DEMO          */
/*  statement-templates (compact journal, executive summary, detailed  */
/*  ledger, modern, elegant, corporate). They are print documents:     */
/*  DEMO fonts, sizes and layout are kept verbatim; the mock data      */
/*  shape is replaced by a typed party ledger with running balance.    */
/* ------------------------------------------------------------------ */

export type StatementPartyKind = "customer" | "supplier";

export interface StatementLine {
  /** Display-ready date. */
  date: string;
  ref: string;
  description: string;
  /** Billed amount (sales invoice / purchase order). */
  debit: number;
  /** Settled amount (payment / receipt / advance deposit). */
  credit: number;
  /** Running balance after this line (+ = owed, − = in advance/credit). */
  balance: number;
  /** Journal serial — absent on the opening-balance row. */
  sl?: number;
  /** True on the brought-forward opening row. */
  opening?: boolean;
}

export interface StatementData {
  company: {
    name: string;
    address?: string;
    trn?: string;
    email?: string;
    phone?: string;
  };
  party: {
    kind: StatementPartyKind;
    name: string;
    contact?: string;
    trn?: string;
    email?: string;
    address?: string;
  };
  /** Display-ready period bounds. */
  period: { from: string; to: string };
  currency: string;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  generatedOn: string;
  lines: StatementLine[];
}

/** One A4 slice of the ledger for the off-screen PDF export stack. When
 *  omitted the template renders as a single flowing document (on-screen
 *  preview + browser print). */
export interface StatementPage {
  lines: StatementLine[];
  /** 1-based page number / total pages (shown on continuation pages). */
  page: number;
  pages: number;
  continuation: boolean;
  last: boolean;
}

export interface StatementTemplateProps {
  data: StatementData;
  page?: StatementPage;
}

/** Per-kind wording so one layout reads correctly for a receivable
 *  (customer) or a payable (supplier) ledger. */
function kindLabels(kind: StatementPartyKind) {
  return kind === "customer"
    ? {
        partyNoun: "Customer",
        journalTitle: "Sales & Collections Journal Statement",
        ledgerTitle: "Customer Ledger",
        debitTotal: "Total invoiced",
        creditTotal: "Payments received",
        balance: "Balance due",
        debitCol: "Invoiced",
        creditCol: "Received",
        refCol: "Invoice",
        docsNoun: "Invoices",
        paymentsNoun: "Payments received",
        terms:
          "Kindly settle any outstanding amounts within 30 days of the statement date.",
        gratitude:
          "With gratitude for your continued partnership — kindly settle by month-end",
      }
    : {
        partyNoun: "Supplier",
        journalTitle: "Purchases & Payments Journal Statement",
        ledgerTitle: "Supplier Ledger",
        debitTotal: "Total billed",
        creditTotal: "Payments made",
        balance: "Amount payable",
        debitCol: "Billed",
        creditCol: "Paid",
        refCol: "PO #",
        docsNoun: "Purchase orders",
        paymentsNoun: "Payments made",
        terms: "Please contact accounts for any reconciliation queries.",
        gratitude:
          "With gratitude for your continued partnership — settlement follows the agreed terms",
      };
}

type Tone = "red" | "green" | undefined;
/** Positive closing = money still owed → attention; negative = advance. */
const closingTone = (v: number): Tone =>
  v > 0.005 ? "red" : v < -0.005 ? "green" : undefined;

const two = (v: number) => v.toFixed(2);

/* ============================ 1 · Compact Journal ========================= */

/** Compact Journal — dense, black & white, the whole ledger in one table. */
export function CompactJournalTemplate({ data, page }: StatementTemplateProps) {
  const L = kindLabels(data.party.kind);
  const m = (v: number) => money(v, data.currency);
  const lines = page ? page.lines : data.lines;
  const first = !page || page.page === 1;
  const last = !page || page.last;
  return (
    <div
      className="bg-white text-neutral-900 p-6 text-[9.5px] leading-snug font-sans"
      style={{ minHeight: 700 }}
    >
      {first ? (
        <>
          <div className="text-center pb-2">
            <div className="text-[15px] font-bold uppercase tracking-wide">
              {data.company.name}
            </div>
            {data.company.address && (
              <div className="text-neutral-600 whitespace-pre-line text-[9px]">
                {data.company.address}
              </div>
            )}
            {data.company.trn && (
              <div className="text-neutral-600 text-[9px]">TRN: {data.company.trn}</div>
            )}
          </div>

          <div className="h-0.5 bg-neutral-900 my-2"></div>

          <div className="text-center">
            <div className="text-[12.5px] font-bold uppercase tracking-widest">
              {L.journalTitle}
            </div>
            <div className="text-neutral-600 text-[9.5px]">
              {L.partyNoun}: {data.party.name} • Period {data.period.from} →{" "}
              {data.period.to}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 my-3">
            <CjSummary label={L.debitTotal} value={m(data.totalDebit)} />
            <CjSummary label={L.creditTotal} value={m(data.totalCredit)} />
            <CjSummary
              label="Closing balance"
              value={m(data.closingBalance)}
              tone={closingTone(data.closingBalance)}
            />
          </div>
        </>
      ) : (
        <div className="flex items-baseline justify-between border-b-2 border-neutral-900 pb-1 mb-2">
          <span className="font-bold uppercase">{data.company.name}</span>
          <span className="text-neutral-600">
            {data.party.name} — continued · page {page?.page}/{page?.pages}
          </span>
        </div>
      )}

      <table className="w-full text-left border border-neutral-900">
        <thead>
          <tr className="bg-neutral-900 text-white text-[9px] uppercase tracking-wider">
            <th className="px-1.5 py-1 w-6">SL</th>
            <th className="px-1.5 py-1 w-16">Date</th>
            <th className="px-1.5 py-1">Description</th>
            <th className="px-1.5 py-1 w-20">Reference</th>
            <th className="px-1.5 py-1 text-right w-16">{L.debitCol}</th>
            <th className="px-1.5 py-1 text-right w-16">{L.creditCol}</th>
            <th className="px-1.5 py-1 text-right w-16">Balance</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((t, i) => (
            <tr key={i} className="border-b border-neutral-200 even:bg-neutral-50">
              <td className="px-1.5 py-0.5">{t.sl ?? "-"}</td>
              <td className="px-1.5 py-0.5 whitespace-nowrap">{t.date}</td>
              <td className="px-1.5 py-0.5">{t.description}</td>
              <td className="px-1.5 py-0.5">{t.ref}</td>
              <td className="px-1.5 py-0.5 text-right">{t.debit ? two(t.debit) : "-"}</td>
              <td className="px-1.5 py-0.5 text-right">{t.credit ? two(t.credit) : "-"}</td>
              <td className="px-1.5 py-0.5 text-right">{two(t.balance)}</td>
            </tr>
          ))}
          {last && (
            <tr className="bg-neutral-900 text-white font-bold">
              <td colSpan={4} className="px-1.5 py-1.5 text-right">
                TOTAL SUMMARY
              </td>
              <td className="px-1.5 py-1.5 text-right">{two(data.totalDebit)}</td>
              <td className="px-1.5 py-1.5 text-right">{two(data.totalCredit)}</td>
              <td className="px-1.5 py-1.5 text-right">{two(data.closingBalance)}</td>
            </tr>
          )}
        </tbody>
      </table>

      {last && (
        <div className="mt-3 text-[9px] text-neutral-600 flex items-center justify-between">
          <span>Generated on {data.generatedOn}</span>
          <span>
          {L.balance.toUpperCase()}: {m(data.closingBalance)}
          </span>
        </div>
      )}
    </div>
  );
}

function CjSummary({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: Tone;
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

/* ========================== 2 · Executive Summary ========================= */

/** Executive Summary — KPI-first with condensed activity (one page by design). */
export function ExecutiveSummaryTemplate({ data }: StatementTemplateProps) {
  const L = kindLabels(data.party.kind);
  const m = (v: number) => money(v, data.currency);
  const docs = data.lines.filter((t) => !t.opening && t.debit > 0);
  const pays = data.lines.filter((t) => !t.opening && t.credit > 0);
  return (
    <div
      className="bg-white text-neutral-900 p-8 text-[11px] leading-relaxed font-sans"
      style={{ minHeight: 700 }}
    >
      <div className="flex items-start justify-between pb-4 border-b border-neutral-300">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold">
            Executive Summary
          </div>
          <div className="text-[20px] font-semibold tracking-tight mt-1">
            {L.partyNoun} Statement
          </div>
          <div className="text-neutral-600 text-[10.5px]">
            Period {data.period.from} → {data.period.to}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[12px] font-semibold uppercase">{data.company.name}</div>
          {data.company.address && (
            <div className="text-neutral-600 text-[10px] whitespace-pre-line">
              {data.company.address}
            </div>
          )}
          {data.company.trn && (
            <div className="text-neutral-600 text-[10px]">TRN: {data.company.trn}</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 py-4">
        <div>
          <div className="text-[9.5px] uppercase tracking-wider text-neutral-500">
            Account
          </div>
          <div className="font-semibold text-[13px] mt-0.5">{data.party.name}</div>
          {data.party.contact && (
            <div className="text-neutral-700 text-[10.5px]">{data.party.contact}</div>
          )}
          <div className="text-neutral-700 text-[10.5px]">
            TRN: {data.party.trn || "—"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9.5px] uppercase tracking-wider text-neutral-500">
            Statement Date
          </div>
          <div>{data.generatedOn}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <ExKpi label={L.debitTotal} value={m(data.totalDebit)} />
        <ExKpi label={L.creditTotal} value={m(data.totalCredit)} />
        <ExKpi
          label={L.balance}
          value={m(data.closingBalance)}
          accent={closingTone(data.closingBalance)}
        />
      </div>

      <div className="mt-6">
        <div className="text-[10.5px] uppercase tracking-wider text-neutral-500 font-semibold mb-2">
          {L.docsNoun}
        </div>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-neutral-300 text-neutral-600">
              <th className="py-1.5 font-medium">{L.refCol}</th>
              <th className="py-1.5 font-medium">Date</th>
              <th className="py-1.5 font-medium">Description</th>
              <th className="py-1.5 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {docs.slice(0, 8).map((t, i) => (
              <tr key={i} className="border-b border-neutral-100">
                <td className="py-1.5 font-medium">{t.ref}</td>
                <td className="py-1.5 text-neutral-700 whitespace-nowrap">{t.date}</td>
                <td className="py-1.5 text-neutral-700 truncate max-w-[220px]">
                  {t.description}
                </td>
                <td className="py-1.5 text-right">{two(t.debit)}</td>
              </tr>
            ))}
            {docs.length > 8 && (
              <tr>
                <td colSpan={4} className="py-1.5 text-neutral-500 italic">
                  +{docs.length - 8} more — the Detailed Ledger template lists every
                  entry
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <div className="text-[10.5px] uppercase tracking-wider text-neutral-500 font-semibold mb-2">
          {L.paymentsNoun}
        </div>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-neutral-300 text-neutral-600">
              <th className="py-1.5 font-medium">Date</th>
              <th className="py-1.5 font-medium">Method</th>
              <th className="py-1.5 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {pays.slice(0, 6).map((t, i) => (
              <tr key={i} className="border-b border-neutral-100">
                <td className="py-1.5 whitespace-nowrap">{t.date}</td>
                <td className="py-1.5 text-neutral-700">{t.description}</td>
                <td className="py-1.5 text-right">{two(t.credit)}</td>
              </tr>
            ))}
            {pays.length > 6 && (
              <tr>
                <td colSpan={3} className="py-1.5 text-neutral-500 italic">
                  +{pays.length - 6} more — the Detailed Ledger template lists every
                  entry
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExKpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: Tone;
}) {
  const cls =
    accent === "red"
      ? "text-red-600"
      : accent === "green"
        ? "text-emerald-600"
        : "text-neutral-900";
  return (
    <div className="border border-neutral-200 rounded-md p-3">
      <div className="text-[9.5px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className={`text-[16px] font-semibold mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}

/* ========================== 3 · Detailed Ledger =========================== */

/** Detailed Ledger — accounting-style with running debit/credit balance. */
export function DetailedLedgerTemplate({ data, page }: StatementTemplateProps) {
  const L = kindLabels(data.party.kind);
  const m = (v: number) => money(v, data.currency);
  const lines = page ? page.lines : data.lines;
  const first = !page || page.page === 1;
  const last = !page || page.last;
  const tone = closingTone(data.closingBalance);
  return (
    <div
      className="bg-white text-neutral-900 p-6 text-[10.5px] leading-snug font-sans"
      style={{ minHeight: 700 }}
    >
      {first ? (
        <>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[13px] font-bold uppercase">{data.company.name}</div>
              {data.company.address && (
                <div className="text-neutral-600 text-[9.5px] whitespace-pre-line">
                  {data.company.address}
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="text-[13px] font-bold uppercase">{L.ledgerTitle}</div>
              <div className="text-neutral-600 text-[9.5px]">
                Period {data.period.from} – {data.period.to}
              </div>
            </div>
          </div>

          <div className="border-y-2 border-neutral-900 my-3 py-2 flex items-center justify-between">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-neutral-500">
                Account holder
              </div>
              <div className="font-semibold">{data.party.name}</div>
              <div className="text-neutral-700 text-[9.5px]">
                TRN: {data.party.trn || "—"}
                {data.party.email ? ` • ${data.party.email}` : ""}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[9px] uppercase tracking-wider text-neutral-500">
                Closing balance
              </div>
              <div
                className={`font-bold text-[15px] ${
                  tone === "red"
                    ? "text-red-600"
                    : tone === "green"
                      ? "text-emerald-600"
                      : ""
                }`}
              >
                {m(data.closingBalance)}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex items-baseline justify-between border-b-2 border-neutral-900 pb-1 mb-2">
          <span className="font-bold uppercase">{data.company.name}</span>
          <span className="text-neutral-600 text-[9.5px]">
            {data.party.name} — continued · page {page?.page}/{page?.pages}
          </span>
        </div>
      )}

      <table className="w-full text-left">
        <thead>
          <tr className="border-b-2 border-neutral-900 text-neutral-800">
            <th className="py-1.5 w-16 font-semibold">Date</th>
            <th className="py-1.5 font-semibold">Description</th>
            <th className="py-1.5 font-semibold w-24">Reference</th>
            <th className="py-1.5 font-semibold text-right w-20">Debit</th>
            <th className="py-1.5 font-semibold text-right w-20">Credit</th>
            <th className="py-1.5 font-semibold text-right w-24">Balance</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((t, i) => (
            <tr key={i} className="border-b border-neutral-200">
              <td className="py-1.5 whitespace-nowrap">{t.date}</td>
              <td className="py-1.5 truncate">{t.description}</td>
              <td className="py-1.5 text-neutral-600">{t.ref}</td>
              <td className="py-1.5 text-right">{t.debit ? two(t.debit) : "—"}</td>
              <td className="py-1.5 text-right">{t.credit ? two(t.credit) : "—"}</td>
              <td
                className={`py-1.5 text-right font-medium ${
                  t.balance < -0.005 ? "text-red-600" : ""
                }`}
              >
                {two(t.balance)}
              </td>
            </tr>
          ))}
          {last && (
            <tr className="bg-neutral-100 font-bold">
              <td colSpan={3} className="py-2 pl-2 text-right">
                Totals
              </td>
              <td className="py-2 text-right">{two(data.totalDebit)}</td>
              <td className="py-2 text-right">{two(data.totalCredit)}</td>
              <td
                className={`py-2 text-right ${
                  tone === "red"
                    ? "text-red-600"
                    : tone === "green"
                      ? "text-emerald-700"
                      : ""
                }`}
              >
                {two(data.closingBalance)}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {last && (
        <div className="mt-4 text-[9.5px] text-neutral-600 border-t border-neutral-200 pt-2">
          This ledger is generated from the accounting records of {data.company.name}.{" "}
          {L.terms}
        </div>
      )}
    </div>
  );
}

/* ========================== 4 · Modern Statement ========================== */

/** Modern Statement — blue accent, card-based summary, monospace numbers. */
export function ModernStatementTemplate({ data, page }: StatementTemplateProps) {
  const L = kindLabels(data.party.kind);
  const m = (v: number) => money(v, data.currency);
  const lines = page ? page.lines : data.lines;
  const first = !page || page.page === 1;
  const last = !page || page.last;
  return (
    <div
      className="bg-white text-neutral-900 text-[11px] leading-relaxed font-sans"
      style={{ minHeight: 700 }}
    >
      {first ? (
        <div className="px-8 pt-8 pb-4 flex items-start gap-4">
          <div className="w-1.5 h-16 bg-blue-500 rounded-full"></div>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-widest text-blue-600 font-semibold">
              Statement of Account
            </div>
            <div className="text-[22px] font-bold tracking-tight">
              {data.party.name}
            </div>
            <div className="text-neutral-500 text-[10.5px]">
              Period {data.period.from} → {data.period.to}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[13px] font-semibold">{data.company.name}</div>
            {data.company.address && (
              <div className="text-neutral-500 text-[10px] whitespace-pre-line">
                {data.company.address}
              </div>
            )}
            {data.company.trn && (
              <div className="text-neutral-500 text-[10px]">
                TRN: {data.company.trn}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mx-8 mt-8 flex items-baseline justify-between border-b border-blue-200 pb-1 mb-2">
          <span className="font-bold text-blue-600 uppercase">
            {data.company.name}
          </span>
          <span className="text-neutral-500 text-[10px]">
            {data.party.name} — continued · page {page?.page}/{page?.pages}
          </span>
        </div>
      )}

      {first && (
        <div className="px-8 grid grid-cols-3 gap-3 mt-2">
          <MdCard label={L.debitTotal} value={m(data.totalDebit)} tone="neutral" />
          <MdCard label={L.creditTotal} value={m(data.totalCredit)} tone="blue" />
          <MdCard
            label={L.balance}
            value={m(data.closingBalance)}
            tone={data.closingBalance > 0.005 ? "red" : "green"}
          />
        </div>
      )}

      <div className="px-8 mt-5">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-blue-50 text-blue-900 text-[10px] uppercase tracking-wider">
              <th className="py-2 px-2 rounded-l-md">Date</th>
              <th className="py-2 px-2">Description</th>
              <th className="py-2 px-2 w-24">Reference</th>
              <th className="py-2 px-2 text-right w-24">{L.debitCol}</th>
              <th className="py-2 px-2 text-right w-24 rounded-r-md">
                {L.creditCol}
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((t, i) => (
              <tr key={i} className="border-b border-neutral-100">
                <td className="py-1.5 px-2 whitespace-nowrap">{t.date}</td>
                <td className="py-1.5 px-2">{t.description}</td>
                <td className="py-1.5 px-2 text-neutral-500">{t.ref}</td>
                <td className="py-1.5 px-2 text-right font-mono">
                  {t.debit ? two(t.debit) : "—"}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-emerald-600">
                  {t.credit ? two(t.credit) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {last && (
        <div className="mt-6 mx-8 rounded-lg bg-blue-500 text-white px-5 py-3 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-widest font-semibold">
            Closing balance
          </span>
          <span className="text-[16px] font-bold">{m(data.closingBalance)}</span>
        </div>
      )}

      {last && (
        <div className="px-8 py-4 text-neutral-500 text-[10px]">
          Prepared on {data.generatedOn}. {L.terms}
        </div>
      )}
    </div>
  );
}

function MdCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "blue" | "green" | "red" | "neutral";
}) {
  const bg = {
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    red: "bg-red-50 text-red-700 border-red-200",
    neutral: "bg-neutral-50 text-neutral-800 border-neutral-200",
  }[tone];
  return (
    <div className={`border rounded-lg p-3 ${bg}`}>
      <div className="text-[9.5px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-[17px] font-bold mt-0.5">{value}</div>
    </div>
  );
}

/* ========================= 5 · Elegant Statement ========================== */

/** Elegant Statement — serif, gold accents, formal. */
export function ElegantStatementTemplate({ data, page }: StatementTemplateProps) {
  const L = kindLabels(data.party.kind);
  const m = (v: number) => money(v, data.currency);
  const lines = page ? page.lines : data.lines;
  const first = !page || page.page === 1;
  const last = !page || page.last;
  return (
    <div
      className="text-neutral-900 p-8 text-[11px] leading-relaxed"
      style={{ background: "#fbf7f0", fontFamily: "Georgia, serif", minHeight: 700 }}
    >
      {first ? (
        <>
          <div className="text-center pb-4 border-b border-amber-800/40">
            <div className="text-[18px] uppercase tracking-[0.25em] text-amber-800 font-semibold">
              {data.company.name}
            </div>
            {data.company.address && (
              <div className="text-neutral-700 text-[10px] whitespace-pre-line">
                {data.company.address}
              </div>
            )}
          </div>

          <div className="text-center py-4">
            <div className="text-[16px] tracking-[0.35em] uppercase text-amber-800">
              Statement of Account
            </div>
            <div className="italic text-neutral-700 mt-1">
              Period {data.period.from} – {data.period.to}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 py-3">
            <div>
              <div className="italic text-amber-800">Presented to</div>
              <div className="font-semibold text-[13px]">{data.party.name}</div>
              <div className="text-neutral-700">TRN: {data.party.trn || "—"}</div>
            </div>
            <div className="text-right">
              <div className="italic text-amber-800">Statement Date</div>
              <div>{data.generatedOn}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 my-4">
            <ElKpi label={L.debitTotal} value={m(data.totalDebit)} />
            <ElKpi label={L.creditTotal} value={m(data.totalCredit)} />
            <ElKpi
              label={L.balance}
              value={m(data.closingBalance)}
              accent={data.closingBalance > 0.005}
            />
          </div>
        </>
      ) : (
        <div className="flex items-baseline justify-between border-b border-amber-800/40 pb-1 mb-2">
          <span className="uppercase tracking-[0.2em] text-amber-800 font-semibold">
            {data.company.name}
          </span>
          <span className="italic text-neutral-700 text-[10px]">
            {data.party.name} — continued · page {page?.page}/{page?.pages}
          </span>
        </div>
      )}

      <table className="w-full text-left">
        <thead>
          <tr className="border-y border-amber-800/40 text-amber-900">
            <th className="py-2">Date</th>
            <th className="py-2">Description</th>
            <th className="py-2 text-right w-24">{L.debitCol}</th>
            <th className="py-2 text-right w-24">{L.creditCol}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((t, i) => (
            <tr key={i} className="border-b border-amber-800/15">
              <td className="py-1.5 whitespace-nowrap">{t.date}</td>
              <td className="py-1.5">{t.description}</td>
              <td className="py-1.5 text-right">{t.debit ? two(t.debit) : "—"}</td>
              <td className="py-1.5 text-right">{t.credit ? two(t.credit) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {last && (
        <div className="flex justify-end mt-4">
          <div className="w-72 space-y-1">
            <div className="flex justify-between italic">
              <span>{L.debitTotal}</span>
              <span>{m(data.totalDebit)}</span>
            </div>
            <div className="flex justify-between italic">
              <span>{L.creditTotal}</span>
              <span>{m(data.totalCredit)}</span>
            </div>
            <div className="flex justify-between font-bold text-[13px] pt-2 border-t border-amber-800/40 text-amber-900">
              <span>{L.balance}</span>
              <span>{m(data.closingBalance)}</span>
            </div>
          </div>
        </div>
      )}

      {last && (
        <div className="text-center italic text-amber-800 text-[10.5px] mt-6 pt-3 border-t border-amber-800/30">
          {L.gratitude}
        </div>
      )}
    </div>
  );
}

function ElKpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className="border border-amber-800/30 rounded-md p-3"
      style={{ background: "#fff" }}
    >
      <div className="text-[9.5px] uppercase tracking-wider italic text-amber-800">
        {label}
      </div>
      <div
        className={`text-[16px] font-bold mt-0.5 ${
          accent ? "text-red-600" : "text-amber-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/* ======================== 6 · Corporate Statement ========================= */

/** Corporate Statement — bold dark header + footer, formal business style. */
export function CorporateStatementTemplate({ data, page }: StatementTemplateProps) {
  const L = kindLabels(data.party.kind);
  const m = (v: number) => money(v, data.currency);
  const lines = page ? page.lines : data.lines;
  const first = !page || page.page === 1;
  const last = !page || page.last;
  return (
    <div
      className="bg-white text-neutral-900 text-[10.5px] leading-snug font-sans"
      style={{ minHeight: 700 }}
    >
      {first ? (
        <div className="bg-neutral-900 text-white px-8 py-5 flex items-center justify-between">
          <div>
            <div className="text-[16px] font-bold uppercase tracking-wider">
              {data.company.name}
            </div>
            {data.company.address && (
              <div className="text-neutral-300 text-[10px] whitespace-pre-line">
                {data.company.address}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-[13px] font-semibold uppercase tracking-widest">
              Statement of Account
            </div>
            <div className="text-neutral-300">
              Period {data.period.from} – {data.period.to}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-neutral-900 text-white px-8 py-2 flex items-baseline justify-between">
          <span className="font-bold uppercase tracking-wider">
            {data.company.name}
          </span>
          <span className="text-neutral-300 text-[9.5px]">
            {data.party.name} — continued · page {page?.page}/{page?.pages}
          </span>
        </div>
      )}

      {first && (
        <div className="px-8 py-4 grid grid-cols-2 gap-6">
          <div>
            <div className="text-[9.5px] uppercase text-neutral-500 tracking-wider font-semibold">
              Account holder
            </div>
            <div className="font-semibold text-[12px] mt-0.5">{data.party.name}</div>
            {data.party.contact && (
              <div className="text-neutral-700">{data.party.contact}</div>
            )}
            <div className="text-neutral-700">TRN: {data.party.trn || "—"}</div>
          </div>
          <div className="text-right">
            <div className="text-[9.5px] uppercase text-neutral-500 tracking-wider font-semibold">
              Statement generated
            </div>
            <div>{data.generatedOn}</div>
          </div>
        </div>
      )}

      {first && (
        <div className="px-8 grid grid-cols-3 gap-2">
          <CoKpi label={L.debitTotal} value={m(data.totalDebit)} />
          <CoKpi label={L.creditTotal} value={m(data.totalCredit)} />
          <CoKpi
            label={L.balance}
            value={m(data.closingBalance)}
            accent={closingTone(data.closingBalance)}
          />
        </div>
      )}

      <div className="px-8 mt-5">
        <table className="w-full text-left">
          <thead>
            <tr className="border-y-2 border-neutral-900">
              <th className="py-2 font-semibold">Date</th>
              <th className="py-2 font-semibold">Description</th>
              <th className="py-2 font-semibold w-24">{L.refCol}</th>
              <th className="py-2 font-semibold text-right w-20">{L.debitCol}</th>
              <th className="py-2 font-semibold text-right w-20">{L.creditCol}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((t, i) => (
              <tr key={i} className="border-b border-neutral-200">
                <td className="py-1.5 whitespace-nowrap">{t.date}</td>
                <td className="py-1.5">{t.description}</td>
                <td className="py-1.5 text-neutral-600">{t.ref}</td>
                <td className="py-1.5 text-right">{t.debit ? two(t.debit) : "—"}</td>
                <td className="py-1.5 text-right">{t.credit ? two(t.credit) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {last && (
        <div className="px-8 mt-4 flex justify-end">
          <div className="w-72">
            <div className="flex justify-between py-1">
              <span>{L.debitTotal}</span>
              <span>{two(data.totalDebit)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span>{L.creditTotal}</span>
              <span>{two(data.totalCredit)}</span>
            </div>
            <div className="flex justify-between bg-neutral-900 text-white px-3 py-2 font-bold text-[13px] mt-1">
              <span>{L.balance}</span>
              <span>{m(data.closingBalance)}</span>
            </div>
          </div>
        </div>
      )}

      {last && (
        <div className="mt-6 bg-neutral-900 text-neutral-300 px-8 py-3 text-[10px]">
          Prepared by {data.company.name}.
          {data.company.email ? ` For queries email ${data.company.email}.` : ""}{" "}
          {L.terms}
        </div>
      )}
    </div>
  );
}

function CoKpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: Tone;
}) {
  const cls =
    accent === "red"
      ? "text-red-600"
      : accent === "green"
        ? "text-emerald-600"
        : "text-neutral-900";
  return (
    <div className="border border-neutral-300 p-2.5">
      <div className="text-[9.5px] uppercase tracking-wider text-neutral-500 font-semibold">
        {label}
      </div>
      <div className={`text-[15px] font-bold mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}

/* ========================= registry, pagination, picker =================== */

export type StatementTemplateKey =
  | "compact"
  | "executive"
  | "ledger"
  | "modern"
  | "elegant"
  | "corporate";

export interface StatementTemplateMeta {
  key: StatementTemplateKey;
  name: string;
  desc: string;
  Component: ComponentType<StatementTemplateProps>;
  /** Summary-style layouts fit one page by design and skip A4 slicing. */
  paginates: boolean;
}

export const statementTemplates: Record<StatementTemplateKey, StatementTemplateMeta> =
  {
    compact: {
      key: "compact",
      name: "Compact Journal",
      desc: "Dense journal-style, all transactions in one table.",
      Component: CompactJournalTemplate,
      paginates: true,
    },
    executive: {
      key: "executive",
      name: "Executive Summary",
      desc: "KPI-first summary for management review.",
      Component: ExecutiveSummaryTemplate,
      paginates: false,
    },
    ledger: {
      key: "ledger",
      name: "Detailed Ledger",
      desc: "Accounting ledger with running balance.",
      Component: DetailedLedgerTemplate,
      paginates: true,
    },
    modern: {
      key: "modern",
      name: "Modern Statement",
      desc: "Card-based, blue accent, easy to read.",
      Component: ModernStatementTemplate,
      paginates: true,
    },
    elegant: {
      key: "elegant",
      name: "Elegant",
      desc: "Formal serif design with gold accents.",
      Component: ElegantStatementTemplate,
      paginates: true,
    },
    corporate: {
      key: "corporate",
      name: "Corporate",
      desc: "Bold dark header, business-formal.",
      Component: CorporateStatementTemplate,
      paginates: true,
    },
  };

export const statementTemplateList: StatementTemplateMeta[] = [
  statementTemplates.compact,
  statementTemplates.executive,
  statementTemplates.ledger,
  statementTemplates.modern,
  statementTemplates.elegant,
  statementTemplates.corporate,
];

/** Split the ledger for the A4 PDF export stack: page 1 leaves room for the
 *  template header + KPI blocks, the final page for its totals/footer. */
export function paginateStatementLines(lines: StatementLine[]): StatementLine[][] {
  const FIRST = 16;
  const MIDDLE = 26;
  const LAST = 22;
  if (lines.length <= FIRST) return [lines];
  const rest = lines.slice();
  const pages: StatementLine[][] = [rest.splice(0, FIRST)];
  while (rest.length > LAST)
    pages.push(rest.splice(0, Math.min(MIDDLE, rest.length - 1)));
  if (rest.length) pages.push(rest);
  return pages;
}

/** Quiet template-picker tile — mini document sketch + name (DEMO index.jsx
 *  parity, amber active ring). */
export function StatementThumb({
  template,
  active,
  onClick,
}: {
  template: StatementTemplateMeta;
  active: boolean;
  onClick: () => void;
}) {
  const previews: Record<StatementTemplateKey, ReactNode> = {
    compact: (
      <div className="bg-white h-full p-2.5 flex flex-col justify-between">
        <div className="h-1.5 bg-neutral-900 w-2/3 mx-auto rounded-full"></div>
        <div className="grid grid-cols-3 gap-0.5">
          <div className="h-2 bg-neutral-200 rounded-sm"></div>
          <div className="h-2 bg-neutral-200 rounded-sm"></div>
          <div className="h-2 bg-neutral-200 rounded-sm"></div>
        </div>
        <div className="space-y-0.5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-0.5 bg-neutral-300 rounded-full"></div>
          ))}
        </div>
        <div className="h-1 bg-neutral-900 rounded-full"></div>
      </div>
    ),
    executive: (
      <div className="bg-white h-full p-2.5 flex flex-col justify-between">
        <div className="h-1.5 bg-neutral-800 w-1/2 rounded-full"></div>
        <div className="grid grid-cols-3 gap-0.5">
          <div className="h-3 border border-neutral-300 rounded-sm"></div>
          <div className="h-3 border border-neutral-300 rounded-sm"></div>
          <div className="h-3 border border-emerald-400 bg-emerald-50 rounded-sm"></div>
        </div>
        <div className="space-y-0.5">
          <div className="h-0.5 bg-neutral-300 w-full rounded-full"></div>
          <div className="h-0.5 bg-neutral-300 w-4/5 rounded-full"></div>
        </div>
      </div>
    ),
    ledger: (
      <div className="bg-white h-full p-2.5 flex flex-col justify-between">
        <div className="flex justify-between">
          <div className="h-1 bg-neutral-800 w-1/3 rounded-full"></div>
          <div className="h-1 bg-neutral-800 w-1/4 rounded-full"></div>
        </div>
        <div className="h-px bg-neutral-800"></div>
        <div className="space-y-0.5">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex gap-0.5">
              <div className="h-0.5 bg-neutral-300 flex-1 rounded-full"></div>
              <div className="h-0.5 bg-neutral-500 w-6 rounded-full"></div>
            </div>
          ))}
        </div>
      </div>
    ),
    modern: (
      <div className="bg-white h-full p-2.5 flex gap-1">
        <div className="w-0.5 bg-blue-500 rounded-full"></div>
        <div className="flex-1 flex flex-col justify-between">
          <div className="h-1.5 bg-blue-500 w-2/3 rounded-full"></div>
          <div className="grid grid-cols-3 gap-0.5">
            <div className="h-2 bg-neutral-100 rounded-sm"></div>
            <div className="h-2 bg-blue-50 border border-blue-200 rounded-sm"></div>
            <div className="h-2 bg-emerald-50 border border-emerald-200 rounded-sm"></div>
          </div>
          <div className="h-2 bg-blue-500 rounded-sm"></div>
        </div>
      </div>
    ),
    elegant: (
      <div
        className="h-full p-2.5 flex flex-col justify-between"
        style={{ background: "#fbf7f0" }}
      >
        <div className="h-1.5 bg-amber-700 w-2/3 mx-auto rounded-full"></div>
        <div className="grid grid-cols-3 gap-0.5">
          <div className="h-2.5 bg-white border border-amber-800/30 rounded-sm"></div>
          <div className="h-2.5 bg-white border border-amber-800/30 rounded-sm"></div>
          <div className="h-2.5 bg-white border border-amber-800/30 rounded-sm"></div>
        </div>
        <div className="space-y-0.5">
          <div className="h-0.5 bg-amber-800/40 w-full rounded-full"></div>
          <div className="h-0.5 bg-amber-800/40 w-3/4 rounded-full"></div>
        </div>
      </div>
    ),
    corporate: (
      <div className="bg-white h-full flex flex-col justify-between">
        <div className="h-3 bg-neutral-900"></div>
        <div className="px-2 grid grid-cols-3 gap-0.5">
          <div className="h-2 bg-neutral-100 rounded-sm"></div>
          <div className="h-2 bg-neutral-100 rounded-sm"></div>
          <div className="h-2 bg-neutral-100 rounded-sm"></div>
        </div>
        <div className="px-2 space-y-0.5">
          <div className="h-0.5 bg-neutral-300 w-full rounded-full"></div>
          <div className="h-0.5 bg-neutral-300 w-full rounded-full"></div>
        </div>
        <div className="h-2.5 bg-neutral-900"></div>
      </div>
    ),
  };

  return (
    <button
      onClick={onClick}
      className={`shrink-0 w-[150px] rounded-lg border transition-all overflow-hidden text-left ${
        active
          ? "border-amber-400 ring-2 ring-amber-400/40"
          : "border-border hover:border-muted-foreground"
      }`}
    >
      <div className="h-[92px] border-b border-border overflow-hidden bg-white">
        {previews[template.key]}
      </div>
      <div className="px-2.5 py-2">
        <div className="text-[12px] font-medium text-foreground">{template.name}</div>
        <div className="text-[10.5px] text-muted-foreground truncate">
          {template.desc}
        </div>
      </div>
    </button>
  );
}

export default statementTemplates;
