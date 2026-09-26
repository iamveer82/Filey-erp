import { isPostedStatus, type CrmCustomer, type Expense, type InvoiceDocSummary, type InvoicePayment, type Order, type ReceiptSummary } from "../lib/api";
import { localYmd } from "../lib/format";
import { reportMoney } from "../lib/reportMoney";
import type { Rates } from "../lib/exchange-rates";

/** Payments use the saved sales invoice currency/rate. Purchase invoices and
 * unavailable/non-posted parents cannot contribute to customer receipts. These
 * records are separate from receipt documents, which have no stable payment ID. */
export function invoicePaymentsInAed(payments: InvoicePayment[], salesInvoices: InvoiceDocSummary[], rates: Rates): InvoicePayment[] {
  const sales = new Map(salesInvoices.filter(invoice => isPostedStatus(invoice.status)).map(invoice => [invoice.id, invoice]));
  return payments.flatMap(payment => {
    const invoice = sales.get(payment.invoice_id);
    if (!invoice) return [];
    const normalized = reportMoney({ amount: payment.amount, currency: invoice.currency, fx_rate: invoice.fx_rate }, ["amount"], rates);
    return [{ ...payment, amount: normalized.amount }];
  });
}

/** Both dashboards compare the same two complete, local-calendar 30-day windows. */
export function overviewDeltas(
  invoices: InvoiceDocSummary[],
  receipts: ReceiptSummary[],
  customers: CrmCustomer[],
  orders: Order[],
  today = new Date(),
) {
  const before = (days: number) => {
    const date = new Date(today);
    date.setDate(today.getDate() - days);
    return localYmd(date);
  };
  const end = localYmd(today);
  const currentStart = before(29);
  const previousStart = before(59);
  const change = <T,>(rows: T[], day: (row: T) => string, amount: (row: T) => number) => {
    let current = 0;
    let previous = 0;
    for (const row of rows) {
      const date = day(row);
      if (!date || date > end) continue;
      if (date >= currentStart) current += amount(row);
      else if (date >= previousStart) previous += amount(row);
    }
    return previous > 0 ? ((current - previous) / previous) * 100 : null;
  };
  const createdDay = (row: { created_at?: string }) => {
    const date = new Date(row.created_at || "");
    return Number.isFinite(date.getTime()) ? localYmd(date) : "";
  };
  return {
    revenue: change(invoices.filter(row => isPostedStatus(row.status)), row => row.issue_date?.slice(0, 10) || "", row => row.total || 0),
    cash: change(receipts.filter(row => row.status === "paid"), row => row.payment_date?.slice(0, 10) || "", row => Number(row.amount) || 0),
    customers: change(customers, createdDay, () => 1),
    orders: change(orders, createdDay, () => 1),
  };
}

/** All values are reporting copies in AED. Invoice payments and standalone
 * receipt documents stay separate: adding them could count the same payment
 * twice. An invoice balance cannot tell us when money arrived. */
export function overviewTrend(
  invoices: InvoiceDocSummary[],
  receipts: ReceiptSummary[],
  expenses: Expense[],
  days: number,
  today = new Date(),
  invoicePayments: InvoicePayment[] = [],
) {
  const series = Array.from({ length: days }, (_, i) => {
    const date = new Date(today);
    date.setDate(today.getDate() - days + i + 1);
    return {
      date: localYmd(date),
      d: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      invoiced: 0,
      received: 0,
      invoicePayments: 0,
      expenses: 0,
    };
  });
  const byDay = new Map(series.map((row) => [row.date, row]));
  for (const invoice of invoices) {
    if (!isPostedStatus(invoice.status)) continue;
    const row = byDay.get(invoice.issue_date?.slice(0, 10) ?? "");
    if (row) row.invoiced += Number(invoice.total) || 0;
  }
  for (const receipt of receipts) {
    if (receipt.status !== "paid") continue;
    const row = byDay.get(receipt.payment_date?.slice(0, 10));
    if (row) row.received += Number(receipt.amount) || 0;
  }
  for (const payment of invoicePayments) {
    const row = byDay.get(payment.paid_at?.slice(0, 10));
    if (row) row.invoicePayments += Number(payment.amount) || 0;
  }
  for (const expense of expenses) {
    const row = byDay.get(expense.expense_date?.slice(0, 10));
    if (row) row.expenses += Number(expense.amount) || 0;
  }
  return series;
}
