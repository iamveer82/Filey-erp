import { crm, billing, erp, quotes } from "./api";
import { money, getDisplayCurrency } from "./format";

/* Builds a compact, token-aware snapshot of the signed-in user's OWN business
 * data, injected into the copilot's system prompt so it can answer questions
 * and draft content grounded in their records. Every call is guarded, but a
 * section that FAILED to load is reported as unavailable rather than just
 * omitted: omitting it is indistinguishable from "the user has none of these",
 * and the model will confidently answer "you have no overdue invoices" when it
 * simply could not read them. Read-only. */

const CAP = 8;

type Row = Record<string, unknown>;
const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export async function buildAiContext(companyName?: string): Promise<string> {
  const unreadable: string[] = [];
  const section = (label: string, p: Promise<unknown[]>): Promise<Row[]> =>
    p
      .then((rows) => rows as Row[])
      .catch(() => {
        unreadable.push(label);
        return [] as Row[];
      });

  const [customers, invoices, products, quoteDocs, orders] = await Promise.all([
    section("customers", crm.customers()),
    section("invoices", billing.listDocs()),
    section("products", erp.products()),
    section("quotations", quotes.listDocs()),
    section("orders", erp.orders()),
  ]);

  const ccy = getDisplayCurrency();
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push(
    `CURRENT BUSINESS DATA (live snapshot — the user owns all of this; use it to answer and to draft):`
  );
  if (companyName) lines.push(`- Company: ${companyName} · display currency ${ccy}`);
  if (unreadable.length)
    lines.push(
      `- UNAVAILABLE THIS TURN: ${unreadable.join(", ")} could not be read. ` +
        `Their absence below means "unknown", NOT "none". Do not state or imply the user has none of these, ` +
        `and do not compute totals that depend on them — say you could not read them and offer to retry.`
    );

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
      lines.push(` Overdue: ${list.join("; ")}`);
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
