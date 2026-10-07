import { crm, billing, erp, quotes } from "./api";
import { aed, money, getDisplayCurrency, todayYmd } from "./format";
import { agentStorageScope } from "./agentStorage";
import { canUseModule, loadModuleAccess, type ModuleAccess } from "./moduleAccess";

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
const accessKey = (access: ModuleAccess) => JSON.stringify([access.admin, access.modules?.slice().sort() ?? null]);

/** An optional business snapshot must not wedge chat or ignore its Stop button. */
export async function buildAiContext(companyName?: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException("Stopped", "AbortError"));
  signal?.addEventListener("abort", abort, { once: true });
  let rejectAborted!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAborted, { once: true });
  });
  const timer = setTimeout(() => controller.abort(new DOMException("Business snapshot timed out", "TimeoutError")), 12_000);
  try {
    return await Promise.race([prepareAiContext(companyName, controller.signal), aborted]);
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason?.name === "TimeoutError")
      return "CURRENT BUSINESS DATA: unavailable because the snapshot timed out. Use tools to look up the records needed for this task; missing data is unknown, not empty.";
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAborted);
  }
}

async function prepareAiContext(companyName: string | undefined, signal: AbortSignal): Promise<string> {
  const scope = agentStorageScope();
  if (!scope) return "CURRENT BUSINESS DATA: unavailable until the user signs in to their workspace.";
  const currency = getDisplayCurrency();
  const current = () => {
    signal.throwIfAborted();
    if (scope !== agentStorageScope() || currency !== getDisplayCurrency())
      throw new DOMException("Workspace changed before preparing the business brief.", "AbortError");
  };
  // Verify permissions before reusing a brief: a same-account revocation must
  // not keep yesterday's accessible records in today's model context.
  const access = await loadModuleAccess();
  current();
  const permissions = accessKey(access);
  const key = JSON.stringify([scope, currency, companyName ?? "", permissions]);
  // Staff visibility can narrow without changing the module list. Re-read
  // through RLS instead of reusing rows that were shared earlier.
  if (access.admin && cached && cached.key === key && Date.now() - cached.at < CACHE_MS) {
    return cached.text;
  }
  const text = await composeContext(companyName, currency, current, access);
  current();
  const latestAccess = await loadModuleAccess();
  current();
  if (accessKey(latestAccess) !== permissions)
    throw new DOMException("Workspace access changed while preparing the business brief.", "AbortError");
  cached = access.admin ? { at: Date.now(), key, text } : null;
  return text;
}

/** Drop the memo — used by tests, and worth calling after a bulk import. */
export function clearAiContextCache(): void {
  cached = null;
}

async function composeContext(companyName: string | undefined, ccy: string, current: () => void, access: ModuleAccess): Promise<string> {
  const unreadable: string[] = [];
  const section = (label: string, module: string, read: () => Promise<unknown[]>): Promise<Row[]> => {
    if (!canUseModule(access, module)) {
      unreadable.push(`${label} (workspace access restricted)`);
      return Promise.resolve([]);
    }
    return read()
      .then((rows) => rows as Row[])
      .catch(() => {
        unreadable.push(label);
        return [] as Row[];
      });
  };

  const [customers, invoices, products, quoteDocs, orders] = await Promise.all([
    section("customers", "customers", () => crm.customers()),
    section("invoices", "invoicing", () => billing.listDocs()),
    section("products", "inventory", () => erp.products()),
    section("quotations", "quoting", () => quotes.listDocs()),
    section("orders", "orders", () => erp.orders()),
  ]);
  current();
  // Identity is worth its handful of tokens: without the VAT rate and currency
  // the agent guesses them, and a guessed tax rate on a tax invoice is the
  // expensive kind of wrong.
  const company = await billing.getCompany().catch(() => null);
  current();

  const today = todayYmd();
  const lines: string[] = [];

  lines.push(
    `CURRENT BUSINESS DATA (workspace overview; may be cached, not a verified individual document):`
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
    const unpaid = inv.filter((d) => n(d.balance) > 0 && !["draft", "paid", "cancelled"].includes(s(d.status).trim().toLowerCase()));
    const overdue = unpaid.filter((d) => d.due_date && s(d.due_date) < today);
    // Document balances are in their own currencies, not the display currency.
    // Keep them separate rather than inventing a mixed-currency total.
    const owed = new Map<string, number>();
    for (const doc of unpaid) {
      const currency = s(doc.currency).trim().toUpperCase() || "AED";
      owed.set(currency, (owed.get(currency) ?? 0) + n(doc.balance));
    }
    const outstanding = [...owed].map(([currency, balance]) => money(balance, currency)).join(" + ") || money(0, "AED");
    lines.push(
      `- Invoices: ${inv.length} total · ${unpaid.length} unpaid · ${overdue.length} overdue · ${outstanding} outstanding${owed.size > 1 ? " (separate currencies; not a converted total)" : ""} across the workspace, NOT the total of any one invoice.`
    );
    if (overdue.length) {
      const list = overdue
        .slice(0, CAP)
        .map(
          (d) =>
            `${s(d.number)} — ${s(d.customer_name)} — ${money(
              n(d.balance),
              s(d.currency) || "AED"
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
        return s(x.name) + (price != null ? ` (${aed(n(price))})` : "");
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
    `This is a workspace summary: counts reflect the loaded snapshot and the examples are a sample. Never use its outstanding balance as an individual invoice total. ` +
      `For anything beyond it — a specific invoice, a customer's history, a product's stock — ` +
      `use the find/list tools rather than answering from what is listed here. Read get_invoice for a requested invoice's own dates, lines and total; if that result is missing or incomplete, retrieve it rather than substituting an overview figure.`
  );

  return lines.join("\n");
}
