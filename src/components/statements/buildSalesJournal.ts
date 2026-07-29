import { billing, type InvoiceDoc, type CompanyProfile, type CrmCustomer, type ReceiptSummary } from "../../lib/api";
import { invoiceLineAmount } from "../../lib/money";
import { fmtDate } from "../../lib/format";

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
  company: {
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
}): Promise<SalesJournal> {
  const { customer, company, invoiceIds, receipts: allReceipts } = opts;

  // Fetch full invoice docs (with line items) in parallel. An invoice that
  // fails to load used to be dropped silently, so the journal simply came out
  // short — wrong totals in an accounting document, with nothing to say so.
  const settled = await Promise.allSettled(
    invoiceIds.map((id) => billing.getDoc(id))
  );
  const unreadable = settled.filter((r) => r.status === "rejected").length;
  if (unreadable)
    throw new Error(
      `${unreadable} of ${invoiceIds.length} invoices could not be loaded, so the journal would be missing entries and its totals would be wrong.`
    );
  const validDocs = settled
    .map((r) => (r as PromiseFulfilledResult<InvoiceDoc | null>).value)
    .filter((d): d is InvoiceDoc => d !== null);

  const companyInfo = {
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
  const myReceipts = allReceipts.filter((r) =>
    customerNames.has(r.customer_name)
  );

  const transactions: JournalLine[] = [];
  let sl = 1;
  let totalSales = 0;
  let totalReceived = 0;
  let totalVat = 0;

  // Sort docs by issue_date
  const sortedDocs = [...validDocs].sort((a, b) =>
    (a.issue_date || "").localeCompare(b.issue_date || "")
  );

  for (const doc of sortedDocs) {
    const date = fmtDate(doc.issue_date || doc.created_at);
    const rate = Number(doc.tax_rate) || 0;
    const vatRate = rate / 100;

    for (const item of doc.items) {
      const amount = invoiceLineAmount(item, doc.unit_price_formula);
      const itemVat = rate > 0 ? amount * vatRate : 0;
      const lineTotal = amount + itemVat;

      transactions.push({
        sl: sl++,
        date,
        description: item.description,
        unit: item.unit || "—",
        qty: String(item.qty || 0),
        rate: String(item.unit_price || 0),
        amount: amount.toFixed(2),
        vat: rate > 0 ? itemVat.toFixed(2) : "—",
        total: lineTotal.toFixed(2),
        invoiceNo: doc.number,
        received: "—",
      });

      totalSales += lineTotal;
      totalVat += itemVat;
    }
  }

  // Add payment lines
  for (const r of myReceipts) {
    const amt = Number(r.amount) || 0;
    if (amt <= 0) continue;
    transactions.push({
      date: fmtDate(r.payment_date),
      description: r.payment_method ? `Payment — ${r.payment_method}` : "Payment received",
      unit: "",
      qty: "",
      rate: "",
      amount: "",
      vat: "",
      total: "",
      invoiceNo: "",
      received: amt.toFixed(2),
    });
    totalReceived += amt;
  }

  // Sort by date — payments after invoices on the same day
  transactions.sort((a, b) => {
    if (a.date === b.date) return a.received === "—" ? -1 : 1;
    return a.date < b.date ? -1 : 1;
  });

  // Re-number SL
  let slN = 1;
  for (const t of transactions) {
    if (t.amount) t.sl = slN++;
    else t.sl = undefined;
  }

  const netBalance = totalReceived - totalSales;

  const earliest = sortedDocs[0]?.issue_date || new Date().toISOString();
  const latest = new Date().toISOString();

  return {
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