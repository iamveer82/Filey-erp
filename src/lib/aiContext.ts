import { crm, billing, erp, quotes } from "./api";
import { money, getDisplayCurrency, todayYmd } from "./format";

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

/** Building the brief reads five tables. A WhatsApp thread is a burst of
 *  messages seconds apart, and each was re-reading all of them; the answer to
 *  "who owes me money" does not change between two lines of the same
 *  conversation.
 *  ponytail: one shared 60s memo, no invalidation on write — a stale brief
 *  costs nothing because the agent looks the details up with tools anyway. */
let cached: { at: number; key: string; text: string } | null = null;
const CACHE_MS = 60_000;

export async function buildAiContext(companyName?: string): Promise<string> {
  const key = companyName ?? "";
  if (cached && cached.key === key && Date.now() - cached.at < CACHE_MS) {
    return cached.text;
  }
  const text = await composeContext(companyName);
  cached = { at: Date.now(), key, text };
  return text;
}

/** Drop the memo — used by tests, and worth calling after a bulk import. */
export function clearAiContextCache(): void {
  cached = null;
}

async function composeContext(companyName?: string): Promise<string> {
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
  // Identity is worth its handful of tokens: without the VAT rate and currency
  // the agent guesses them, and a guessed tax rate on a tax invoice is the
  // expensive kind of wrong.
  const company = await billing.getCompany().catch(() => null);

  const ccy = getDisplayCurrency();
  const today = todayYmd();
  const lines: string[] = [];

  lines.push(
    `CURRENT BUSINESS DATA (live snapshot — the user owns all of this; use it to answer and to draft):`
  );
  const name = companyName || s(company?.name);
  if (name || company) {
    const bits = [
      name && `Company: ${name}`,
      `display currency ${ccy}`,
      company?.trn && `TRN ${s(company.trn)}`,
      company?.default_tax_rate != null && `default VAT ${n(company.default_tax_rate)}%`,
    ].filter(Boolean);
    lines.push(`- ${bits.join(" · ")}`);
  }
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
    const owed = unpaid.reduce((t, d) => t + n(d.balance), 0);
    lines.push(
      `- Invoices: ${inv.length} total · ${unpaid.length} unpaid · ${overdue.length} overdue · ${money(owed, ccy)} outstanding.`
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

    // Worth naming: it is the thing an owner most often wants told to them
    // rather than asked about.
    const low = p.filter((x) => {
      const qty = n(x.stock ?? x.qty ?? x.quantity);
      const min = n(x.reorder_level ?? x.min_stock);
      return min > 0 && qty <= min;
    });
    if (low.length) {
      const names2 = low.slice(0, CAP).map((x) => s(x.name)).filter(Boolean);
      lines.push(`- Low stock: ${low.length} item(s) at or below reorder level — ${names2.join("; ")}`);
    }
  }

  // Orders
  if (orders.length) lines.push(`- Orders: ${orders.length}`);

  lines.push(
    `This is a summary, not the whole book: counts are exact, the examples are a sample. ` +
      `For anything beyond it — a specific invoice, a customer's history, a product's stock — ` +
      `use the find/list tools rather than answering from what is listed here.`
  );

  return lines.join("\n");
}
