import { billing, type InvoiceDoc, type CompanyProfile, type CrmCustomer, type ReceiptSummary } from "../../lib/api";
import { applyRoundOff, r2 } from "../../lib/money";
import { docLineAmount, docTotals, splitItemMeta } from "../../lib/docItems";
import { isCreditNote } from "../../lib/einvoice";
import { fmtDate, todayYmd } from "../../lib/format";

/* ------------------------------------------------------------------ */
/*  Sales & Collections Journal — itemised statement showing every     */
/*  invoice line item (product, qty, rate, amount, VAT, total) plus     */
/*  payments received, matching the DEMO reference design.             */
/* ------------------------------------------------------------------ */

export interface JournalLine {
  sl?: number;
  date: string;
  description: string;
  unit: string;
  qty: string;
  rate: string;
  amount: string;
  vat: string;
  total: string;
  invoiceNo: string;
  received: string;
}

export interface JournalSummary {
  totalSales: number;
  totalReceived: number;
  totalVat: number;
  netBalance: number;
}

export interface SalesJournal {
  currency: string;
  /** Other currencies are excluded, never silently added without conversion. */
  excludedCurrencies?: string[];
  company: {
    country_code?: string;
    name: string;
    address?: string;
    trn?: string;
    email?: string;
    phone?: string;
  };
  customer: {
    name: string;
    company?: string;
    trn?: string;
    email?: string;
    phone?: string;
  };
  period: { from: string; to: string };
  summary: JournalSummary;
  transactions: JournalLine[];
}

export async function buildSalesJournal(opts: {
  customerId: number;
  customer: CrmCustomer;
  company: CompanyProfile | null;
  invoiceIds: number[];
  receipts: ReceiptSummary[];
  currency?: string;
}): Promise<SalesJournal> {
  const { customer, company, invoiceIds, receipts: allReceipts } = opts;

  // Fetch full invoice docs (with line items) in parallel. An invoice that
  // fails to load used to be dropped silently, so the journal simply came out
  // short — wrong totals in an accounting document, with nothing to say so.
  const ids = [...new Set(invoiceIds)];
  const settled = await Promise.allSettled(ids.map((id) => billing.getDoc(id)));
  const unreadable = settled.filter((r) => r.status === "rejected" || !r.value).length;
  if (unreadable)
    throw new Error(
      `${unreadable} of ${ids.length} invoices could not be loaded, so the journal would be missing entries and its totals would be wrong. Retry before sharing it.`
    );
  const validDocs = settled
    .map((r) => (r as PromiseFulfilledResult<InvoiceDoc | null>).value)
    .filter((d): d is InvoiceDoc => d !== null);
  if (validDocs.some(doc => doc.customer_id != null && doc.customer_id !== opts.customerId))
    throw new Error("An invoice belongs to a different customer. Reload this customer's records before building the journal.");

  const companyInfo = {
    country_code: company?.country_code,
    name: company?.name || "Company",
    address: [company?.address, company?.city].filter(Boolean).join("\n") || undefined,
    trn: company?.trn || undefined,
    email: company?.email || undefined,
    phone: company?.phone || undefined,
  };

  const customerInfo = {
    name: customer.name,
    company: customer.company,
    trn: customer.trn,
    email: customer.email,
    phone: customer.phone,
  };

  // Customer's receipts (match by name — receipts store customer_name)
  const customerNames = new Set([
    customer.name,
    customer.company,
  ].filter(Boolean) as string[]);
  const issued = (status: string) => !!status && !["draft", "cancelled", "canceled", "void"].includes(status.toLowerCase());
  const issuedDocs = validDocs.filter(doc => issued(doc.status));
  const customerReceipts = allReceipts.filter(r => customerNames.has(r.customer_name) && issued(r.status));
  const currencyOf = (value?: string) => value?.trim().toUpperCase() || "AED";
  const counts = new Map<string, number>();
  for (const doc of issuedDocs) {
    const ccy = currencyOf(doc.currency);
    counts.set(ccy, (counts.get(ccy) ?? 0) + 1);
  }
  const currency = currencyOf(opts.currency || [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || company?.currency);
  const excludedCurrencies = [...new Set([...issuedDocs, ...customerReceipts].map(row => currencyOf(row.currency)))].filter(ccy => ccy !== currency).sort();
  const myReceipts = customerReceipts.filter(r => currencyOf(r.currency) === currency);
  const events: { date: string; payment: boolean; line: JournalLine }[] = [];
  const calendarDate = (value: string | undefined, label: string): string => {
    const date = value?.slice(0, 10) || "";
    const parsed = new Date(`${date}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value || "") || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
      throw new Error(`${label} has no valid date. Correct it before building the journal.`);
    return date;
  };
  let totalSales = 0;
  let totalReceived = 0;
  let totalVat = 0;

  // Sort docs by issue_date
  const sortedDocs = issuedDocs.filter(doc => currencyOf(doc.currency) === currency).sort((a, b) =>
    (a.issue_date || "").localeCompare(b.issue_date || "")
  );
  const invoicePayments = await Promise.all(sortedDocs.map(async doc => {
    try {
      return { doc, payments: await billing.payments(doc.id) };
    } catch {
      throw new Error(`Payments for invoice ${doc.number} could not be loaded. Retry before sharing the journal.`);
    }
  }));

  for (const doc of sortedDocs) {
    const date = calendarDate(doc.issue_date || doc.created_at, `Invoice ${doc.number}`);
    const sign = isCreditNote(doc.invoice_type_code) ? -1 : 1;
    const items = doc.items.map(item => ({ ...item, ...splitItemMeta(item.custom) }));
    const totals = applyRoundOff(docTotals(items, doc.discount, doc.tax_rate, doc.unit_price_formula), doc.round_off);
    const append = (line: Omit<JournalLine, "date" | "invoiceNo" | "received">) => {
      events.push({ date, payment: false, line: { ...line, date: fmtDate(date), invoiceNo: doc.number, received: "—" } });
    };
    let lineNet = 0, lineTax = 0;
    for (const item of items) {
      const amount = docLineAmount(item, doc.unit_price_formula);
      const rate = (item.tax_category ?? "S") === "S" ? (item.tax || doc.tax_rate || 0) : 0;
      const itemVat = r2(amount * rate / 100);
      lineNet = r2(lineNet + amount);
      lineTax = r2(lineTax + itemVat);
      append({
        description: item.description,
        unit: item.unit || "—",
        qty: String(item.qty || 0),
        rate: String(item.unit_price || 0),
        amount: (sign * amount).toFixed(2),
        vat: rate > 0 ? (sign * itemVat).toFixed(2) : "—",
        total: (sign * r2(amount + itemVat)).toFixed(2),
      });
    }
    // Line amounts include their own discounts. Show document discount and
    // category-level tax rounding explicitly so the itemised journal adds up
    // to the same total as the invoice, ledger and PDF.
    const netAdjustment = r2(totals.total - totals.round_off - totals.tax - lineNet);
    const taxAdjustment = r2(totals.tax - lineTax);
    if (netAdjustment || taxAdjustment) append({
      description: netAdjustment ? "Invoice discount and tax adjustment" : "Tax rounding adjustment",
      unit: "", qty: "", rate: "", amount: (sign * netAdjustment).toFixed(2),
      vat: (sign * taxAdjustment).toFixed(2), total: (sign * r2(netAdjustment + taxAdjustment)).toFixed(2),
    });
    if (totals.round_off) append({
      description: "Round-off adjustment", unit: "", qty: "", rate: "",
      amount: (sign * totals.round_off).toFixed(2), vat: "—", total: (sign * totals.round_off).toFixed(2),
    });
    totalSales = r2(totalSales + sign * totals.total);
    totalVat = r2(totalVat + sign * totals.tax);
  }

  const appendPayment = (date: string, amount: number, description: string, invoiceNo = "") => {
    events.push({ date, payment: true, line: {
      date: fmtDate(date), description, unit: "", qty: "", rate: "", amount: "", vat: "", total: "",
      invoiceNo, received: amount.toFixed(2),
    } });
    totalReceived = r2(totalReceived + amount);
  };
  // Invoice settlements and standalone receipts are independent sources, as
  // in buildStatement. Recording an invoice payment does not create a receipt.
  for (const { doc, payments } of invoicePayments) {
    for (const payment of payments) {
      const amount = Number(payment.amount) || 0;
      if (amount <= 0) continue;
      appendPayment(calendarDate(payment.paid_at, `Payment for invoice ${doc.number}`), amount,
        payment.method ? `Payment received — ${payment.method}` : "Payment received", doc.number);
    }
  }
  for (const r of myReceipts) {
    const amt = Number(r.amount) || 0;
    if (amt <= 0) continue;
    const date = calendarDate(r.payment_date, `Receipt ${r.number}`);
    appendPayment(date, amt, `Payment receipt ${r.number}${r.payment_method ? ` — ${r.payment_method}` : ""}`);
  }

  // Sort by date — payments after invoices on the same day
  events.sort((a, b) => a.date.localeCompare(b.date) || Number(a.payment) - Number(b.payment));
  const transactions = events.map(event => event.line);

  // Re-number SL
  let slN = 1;
  for (const t of transactions) {
    if (t.amount) t.sl = slN++;
    else t.sl = undefined;
  }

  const netBalance = r2(totalReceived - totalSales);
  const today = todayYmd();
  const earliest = events[0]?.date || today;
  const lastDate = events[events.length - 1]?.date || today;
  const latest = lastDate > today ? lastDate : today;

  return {
    currency,
    excludedCurrencies,
    company: companyInfo,
    customer: customerInfo,
    period: { from: fmtDate(earliest), to: fmtDate(latest) },
    summary: { totalSales, totalReceived, totalVat, netBalance },
    transactions,
  };
}

export function fmt(n: number, currency = "AED"): string {
  return `${currency} ${num(n)}`;
}

function num(n: number): string {
  return (Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
