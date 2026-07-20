import { fmtDate } from "../../lib/format";
import type {
  StatementData,
  StatementLine,
  StatementPartyKind,
} from "./StatementTemplates";

/* ------------------------------------------------------------------ */
/*  buildStatement — derive a party's statement ledger from REAL       */
/*  records: billing docs (invoices / purchase orders) as debits,      */
/*  dated payments + payment receipts + advance deposits as credits,   */
/*  sorted by date with a running balance. No mock values anywhere.    */
/* ------------------------------------------------------------------ */

export interface StatementDocEntry {
  number: string;
  /** ISO date (yyyy-mm-dd); docs without a date are skipped — a ledger
   *  line cannot be placed honestly without one. */
  date?: string;
  total: number;
  /** VAT rate (%) applied to this document — 0/undefined = no VAT. */
  taxRate?: number;
}

export interface StatementPaymentEntry {
  date: string;
  amount: number;
  method?: string;
  /** Number of the document this payment settles (shown as the ref). */
  docNumber?: string;
}

export interface StatementReceiptEntry {
  number: string;
  date: string;
  amount: number;
}

export interface StatementAdvanceEntry {
  date: string;
  amount: number;
  note?: string;
}

export interface BuildStatementInput {
  kind: StatementPartyKind;
  company: StatementData["company"];
  party: {
    name: string;
    contact?: string;
    trn?: string;
    email?: string;
    address?: string;
    /** Balance carried in from before Filey (+ = they owe you). */
    openingBalance?: number;
  };
  currency: string;
  /** ISO yyyy-mm-dd bounds; from = null → all time. */
  period: { from: string | null; to: string };
  /** Billed documents (issued invoices / live purchase orders), status-
   *  filtered by the caller. */
  docs: StatementDocEntry[];
  /** Dated settlements recorded against those documents. */
  payments: StatementPaymentEntry[];
  /** Standalone payment receipts (customers only). */
  receipts?: StatementReceiptEntry[];
  /** Advance deposits — positive amounts only; the negative `applied:inv#…`
   *  consumption rows are internal allocations and must be excluded by the
   *  caller (they are not new money). */
  advances?: StatementAdvanceEntry[];
}

export interface BuiltStatement {
  data: StatementData;
  /** False when the period holds no activity and no opening balance —
   *  the caller shows an EmptyState instead of a blank document. */
  hasContent: boolean;
}

const ymd = (d?: string | null) => (d || "").slice(0, 10);

export function buildStatement(input: BuildStatementInput): BuiltStatement {
  const { kind } = input;
  const docLabel = kind === "customer" ? "Sales invoice" : "Purchase order";
  const creditLabel = kind === "customer" ? "Credit note" : "Supplier credit";
  const payLabel = kind === "customer" ? "Payment received" : "Payment made";
  const advLabel = kind === "customer" ? "Advance received" : "Advance paid";

  type Event = {
    date: string;
    ref: string;
    description: string;
    debit: number;
    credit: number;
    net?: number;
    vat?: number;
  };
  const events: Event[] = [];

  for (const d of input.docs) {
    const date = ymd(d.date);
    const total = Number(d.total) || 0;
    if (!date || total === 0) continue;
    const rate = Number(d.taxRate) || 0;
    const vat = rate > 0 ? total - total / (1 + rate / 100) : 0;
    const net = total - vat;
    if (total > 0)
      events.push({ date, ref: d.number, description: docLabel, debit: total, credit: 0, net, vat: vat || undefined });
    else
      events.push({
        date,
        ref: d.number,
        description: creditLabel,
        debit: 0,
        credit: Math.abs(total),
      });
  }
  for (const p of input.payments) {
    const date = ymd(p.date);
    const amount = Number(p.amount) || 0;
    if (!date || amount <= 0) continue;
    events.push({
      date,
      ref: p.docNumber || "—",
      description: p.method ? `${payLabel} — ${p.method}` : payLabel,
      debit: 0,
      credit: amount,
    });
  }
  for (const r of input.receipts ?? []) {
    const date = ymd(r.date);
    const amount = Number(r.amount) || 0;
    if (!date || amount <= 0) continue;
    events.push({
      date,
      ref: r.number,
      description: "Payment receipt",
      debit: 0,
      credit: amount,
    });
  }
  for (const a of input.advances ?? []) {
    const date = ymd(a.date);
    const amount = Number(a.amount) || 0;
    if (!date || amount <= 0) continue;
    events.push({
      date,
      ref: "ADV",
      description: a.note ? `${advLabel} — ${a.note}` : advLabel,
      debit: 0,
      credit: amount,
    });
  }

  // Period split: activity before the window folds into the brought-forward
  // opening balance so the statement still reconciles to the true position.
  const { from, to } = input.period;
  const before = from ? events.filter((e) => e.date < from) : [];
  const within = events.filter((e) => (!from || e.date >= from) && e.date <= to);
  const preSum = before.reduce((s, e) => s + e.debit - e.credit, 0);
  const opening = (input.party.openingBalance || 0) + preSum;

  // Chronological; on a tie the bill precedes its settlement.
  within.sort((a, b) =>
    a.date === b.date ? b.debit - a.debit : a.date < b.date ? -1 : 1
  );

  const lines: StatementLine[] = [];
  let running = opening;
  const hasOpening = Math.abs(opening) > 0.004;
  if (hasOpening) {
    lines.push({
      date: from ?? within[0]?.date ?? to,
      ref: "—",
      description: opening > 0 ? "Opening balance b/f" : "Opening credit b/f",
      debit: 0,
      credit: 0,
      balance: opening,
      opening: true,
    });
  }
  let sl = 1;
  for (const e of within) {
    running += e.debit - e.credit;
    lines.push({ ...e, balance: running, sl: sl++ });
  }

  const totalDebit = within.reduce((s, e) => s + e.debit, 0);
  const totalCredit = within.reduce((s, e) => s + e.credit, 0);
  const totalVat = within.reduce((s, e) => s + (e.vat || 0), 0);
  const totalNet = within.reduce((s, e) => s + (e.net || e.debit), 0);
  const closing = opening + totalDebit - totalCredit;

  const earliest = events.reduce((m, e) => (e.date < m ? e.date : m), "9999-12-31");
  const fromDisplay = from
    ? fmtDate(from)
    : earliest !== "9999-12-31"
      ? fmtDate(earliest)
      : fmtDate(to);

  return {
    data: {
      company: input.company,
      party: {
        kind,
        name: input.party.name,
        contact: input.party.contact,
        trn: input.party.trn,
        email: input.party.email,
        address: input.party.address,
      },
      period: { from: fromDisplay, to: fmtDate(to) },
      currency: input.currency || "AED",
      openingBalance: opening,
      totalDebit,
      totalCredit,
      closingBalance: closing,
      totalVat,
      totalNet,
      generatedOn: fmtDate(new Date().toISOString()),
      lines: lines.map((l) => ({ ...l, date: fmtDate(l.date) })),
    },
    hasContent: within.length > 0 || hasOpening,
  };
}
