import { crm, billing, erp, quotes } from "./api";
import { money, getDisplayCurrency } from "./format";

/* Builds a compact, token-aware snapshot of the signed-in user's OWN business
 * data, injected into the copilot's system prompt so it can answer questions
 * and draft content grounded in their records. Every call is guarded — a
 * failing/empty section is simply omitted. Read-only. */

const CAP = 8;

type Row = Record<string, unknown>;
const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export async function buildAiContext(companyName?: string): Promise<string> {
  const [customers, invoices, products, quoteDocs, orders] = await Promise.all([
    crm.customers().catch(() => [] as Row[]),
    billing.listDocs().catch(() => [] as Row[]),
    erp.products().catch(() => [] as Row[]),
    quotes.listDocs().catch(() => [] as Row[]),
    erp.orders().catch(() => [] as Row[]),
  ]);

  const ccy = getDisplayCurrency();
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push(
    `CURRENT BUSINESS DATA (live snapshot — the user owns all of this; use it to answer and to draft):`
  );
  if (companyName) lines.push(`- Company: ${companyName} · display currency ${ccy}`);

  // Customers
  if (customers.length) {
    const names = (customers as Row[])
      .slice(0, CAP)
      .map((c) => s(c.name) + (c.trn ? ` (TRN ${s(c.trn)})` : ""))
      .filter(Boolean);
    lines.push(`- Customers: ${customers.length}. Recent: ${names.join("; ")}`);
  }

  // Invoices + overdue
  if (invoices.length) {
    const inv = invoices as Row[];
    const unpaid = inv.filter((d) => n(d.balance) > 0 && d.status !== "paid");
    const overdue = unpaid.filter((d) => d.due_date && s(d.due_date) < today);
    lines.push(
      `- Invoices: ${inv.length} total · ${unpaid.length} unpaid · ${overdue.length} overdue.`
    );
    if (overdue.length) {
      const list = overdue
        .slice(0, CAP)
        .map(
          (d) =>
            `${s(d.number)} — ${s(d.customer_name)} — ${money(
              n(d.balance),
              s(d.currency) || ccy
            )} due, due ${s(d.due_date)}`
        );
      lines.push(`  Overdue: ${list.join("; ")}`);
    }
  }

  // Quotes
  if (quoteDocs.length) lines.push(`- Quotes: ${quoteDocs.length}`);

  // Products
  if (products.length) {
    const p = products as Row[];
    const names = p
      .slice(0, CAP)
      .map((x) => {
        const price = x.price ?? x.unit_price ?? x.sell_price;
        return s(x.name) + (price != null ? ` (${money(n(price), ccy)})` : "");
      })
      .filter(Boolean);
    lines.push(`- Products: ${p.length}. e.g. ${names.join("; ")}`);
  }

  // Orders
  if (orders.length) lines.push(`- Orders: ${orders.length}`);

  lines.push(
    `If the user asks about data not shown here, say you may need them to open the relevant page so you can read more.`
  );

  return lines.join("\n");
}
