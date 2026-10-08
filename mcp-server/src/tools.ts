import { z } from "zod";
import { getCtx, type Ctx } from "./client.js";
import { loadDraftPresets } from "./draftPresets.js";

export interface ToolDef {
  name: string;
  description: string;
  /** zod raw shape, passed to McpServer.tool() */
  inputSchema: z.ZodRawShape;
  handler: (args: any) => Promise<unknown>;
}

const Limit = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("Max rows to return (default 10, max 100)");

/**
 * `invoice_docs` holds sales AND purchase documents. The app tags purchases with
 * `doc_type = "purchase"` and strips the field on sales docs (older rows kept a
 * printed title there, e.g. "Tax Invoice") — see src/lib/api.ts, which reads
 * anything that isn't "purchase" as a sales document. So the sales filter is
 * "not a purchase", with NULL matched explicitly because SQL `<>` drops NULLs.
 */
const SALES_ONLY = "doc_type.is.null,doc_type.neq.purchase";
const POSTED = ["sent", "paid", "overdue"];
const credit = (document: any) => ["381", "81"].includes(String(document.invoice_type_code ?? ""));
const currencyOf = (document: any) => String(document.currency || "AED").toUpperCase();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function audit(ctx: Ctx, action: string, entity: string, details: unknown): Promise<void> {
  const { error } = await ctx.supabase.from("audit_log").insert({
    user_id: ctx.userId,
    actor: "mcp-agent",
    action,
    entity,
    details: details as any,
  });
  if (error) console.error(`[filey-erp-mcp] audit_log insert failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Money math, ported from src/lib/money.ts (invoiceTotals) and src/lib/docItems.ts
// (splitItemMeta/docLineGross/docTotals) so report totals agree to the cent with
// the app's own Reports page and agent tools. A local port because the MCP
// server cannot import from src/.
// ---------------------------------------------------------------------------

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

interface DocHead {
  tax_rate?: number | null;
  discount?: number | null;
  round_off?: boolean | null;
  unit_price_formula?: { a: string; b?: string } | null;
}

interface DocItemRow {
  qty?: number | null;
  unit_price?: number | null;
  /** Per-line meta is packed inside the item's `custom` jsonb (see src/lib/docItems.ts). */
  custom?: Record<string, string> | null;
  tax_category?: string | null;
  discount?: number | null;
  tax?: number | null;
}

const CM_KEY = "__calc_mode";
const MA_KEY = "__manual_amount";
const FA_KEY = "__formula_a";
const FB_KEY = "__formula_b";
const DISC_KEY = "__disc_pct";
const TAXP_KEY = "__tax_pct";

const num = (v: string): number => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

function splitItemMeta(custom?: Record<string, string> | null) {
  const c: Record<string, string> = { ...(custom ?? {}) };
  const calcMode =
    c[CM_KEY] === "manual" || c[CM_KEY] === "formula"
      ? (c[CM_KEY] as "manual" | "formula")
      : undefined;
  delete c[CM_KEY];
  const amount = num(c[MA_KEY] ?? "");
  delete c[MA_KEY];
  const itemFormula = c[FA_KEY] ? { a: c[FA_KEY], b: c[FB_KEY] || undefined } : undefined;
  delete c[FA_KEY];
  delete c[FB_KEY];
  const discount = num(c[DISC_KEY] ?? "") || undefined;
  delete c[DISC_KEY];
  const tax = num(c[TAXP_KEY] ?? "") || undefined;
  delete c[TAXP_KEY];
  return { custom: c, calcMode, amount, itemFormula, discount, tax };
}

/** Gross for a line before doc-level or line-level discount/tax (docLineGross). */
function docLineGross(
  it: {
    qty?: number | null;
    unit_price?: number | null;
    custom?: Record<string, string> | null;
    calcMode?: "manual" | "formula";
    amount?: number;
    itemFormula?: { a: string; b?: string } | null;
  },
  formula?: { a: string; b?: string } | null
): number {
  if (it.calcMode === "manual") return r2(it.amount ?? 0);
  const rate = Number(it.unit_price) || 0;
  const active = it.calcMode === "formula" && it.itemFormula?.a ? it.itemFormula : formula;
  if (active?.a) {
    const multiplier =
      active.a === "qty" ? Number(it.qty) || 0 : num(String(it.custom?.[active.a] ?? ""));
    return r2(multiplier * rate);
  }
  return r2((Number(it.qty) || 0) * rate);
}

/** Mirrors shared docTotals/taxBreakdown: allocate document discounts in cents
 *  and round VAT once per category/rate, including explicit per-line rates. */
function computeDocTotals(
  head: DocHead,
  items: DocItemRow[]
): { net: number; tax: number; total: number } {
  const groups = new Map<string, { net: number; rate: number }>();
  for (const item of items) {
    const meta = splitItemMeta(item.custom);
    const line = { ...item, ...meta };
    const discount = meta.discount ?? item.discount ?? 0;
    const net = r2(docLineGross(line, head.unit_price_formula) * (1 - discount / 100));
    const category = item.tax_category || "S";
    const rate = category === "S" ? (meta.tax ?? item.tax) || head.tax_rate || 0 : 0;
    const key = `${category}:${rate}`;
    const group = groups.get(key) ?? { net: 0, rate };
    group.net += Math.round(net * 100);
    groups.set(key, group);
  }
  const rows = [...groups.values()];
  const subtotal = rows.reduce((sum, row) => sum + row.net, 0);
  const discount = Math.min(Math.max(0, Math.round((head.discount || 0) * 100)), subtotal);
  const shares = rows.map(row => subtotal > 0 ? discount * row.net / subtotal : 0);
  const allocated = shares.map(Math.floor);
  const order = shares.map((share, index) => ({ index, remainder: share - allocated[index] }))
    .sort((a, b) => b.remainder - a.remainder);
  const remaining = discount - allocated.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < remaining; index++) allocated[order[index].index]++;
  const net = r2((subtotal - discount) / 100);
  const tax = r2(rows.reduce((sum, row, index) => sum + r2((row.net - allocated[index]) / 100 * row.rate / 100), 0));
  return { net, tax, total: r2(net + tax) };
}

/** Round-off nudges the grand total to the whole unit AFTER tax (applyRoundOff). */
function docTotal(head: DocHead, items: DocItemRow[]): number {
  const t = computeDocTotals(head, items);
  return head.round_off ? Math.round(t.total) : t.total;
}

/** Kept for callers that just need the gross total (draft writes). */
function invoiceTotal(head: DocHead, items: DocItemRow[]): number {
  return docTotal(head, items);
}

async function itemsForInvoices(
  ctx: Ctx,
  invoiceIds: string[]
): Promise<Map<string, DocItemRow[]>> {
  const map = new Map<string, any[]>();
  if (invoiceIds.length === 0) return map;
  const { data, error } = await ctx.supabase
    .from("invoice_doc_items")
    .select("invoice_id, description, qty, unit_price, position, custom, tax_category")
    .eq("org_id", ctx.orgId)
    .in("invoice_id", invoiceIds)
    .order("position", { ascending: true });
  if (error) throw new Error(`invoice_doc_items query failed: ${error.message}`);
  for (const row of data ?? []) {
    const arr = map.get(row.invoice_id) ?? [];
    arr.push(row);
    map.set(row.invoice_id, arr);
  }
  return map;
}

/** Payments recorded against invoices — receivables must age the outstanding
 *  balance, not the billed total, or partly paid invoices are chased in full. */
async function paymentsForInvoices(ctx: Ctx, invoiceIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (invoiceIds.length === 0) return map;
  const { data, error } = await ctx.supabase
    .from("invoice_payments")
    .select("invoice_id, amount")
    .eq("org_id", ctx.orgId)
    .in("invoice_id", invoiceIds);
  if (error) throw new Error(`invoice_payments query failed: ${error.message}`);
  for (const p of data ?? []) {
    map.set(p.invoice_id, (map.get(p.invoice_id) ?? 0) + (Number(p.amount) || 0));
  }
  return map;
}

/** Header and lines commit together under the current user's RLS. No partial
 * fallback is used when the cloud needs its document-save migration. */
async function saveDraft(ctx: Ctx, table: string, header: Record<string, unknown>, items: Record<string, unknown>[]): Promise<void> {
  const { data, error } = await ctx.supabase.rpc("filey_save_document", {
    p_table: table, p_header: header, p_items: items, p_id: null,
  });
  if (error || data == null) throw new Error("Draft could not be saved atomically. " + (error?.message ?? "No document receipt returned."));
}

/** Reserve an authoritative number rather than predicting it from a stale list. */
async function nextNumber(
  ctx: Ctx,
  table: string,
  column: string,
  pattern: string,
  date: string,
): Promise<string> {
  const year = Number(date.slice(0, 4));
  const kinds: Record<string, string> = { invoice_docs: "invoice", quotations: "quote", purchase_orders: "purchase_order" };
  const kind = kinds[table];
  if (!kind || column !== (table === "purchase_orders" ? "po_number" : "number")) throw new Error("Unsupported document numbering type.");
  const { data, error } = await ctx.supabase.rpc("filey_reserve_document_number", {
    p_kind: kind, p_pattern: pattern, p_year: year,
    p_request: crypto.randomUUID(), p_actor: ctx.userId, p_org: ctx.orgId,
  });
  if (error || typeof data !== "string" || !data.trim())
    throw new Error("Document number could not be reserved. " + (error?.message ?? "Update the document-number migration before retrying."));
  return data;
}

/** Wrap a handler so failures come back as {error} payloads instead of throwing. */
function safe(fn: (args: any) => Promise<unknown>): (args: any) => Promise<unknown> {
  return async (args: any) => {
    try {
      return await fn(args);
    } catch (err: any) {
      return { error: err?.message ?? String(err) };
    }
  };
}

const InvoiceItem = z.object({
  description: z.string().min(1),
  qty: z.number().positive().optional().describe("Quantity (default 1)"),
  unit_price: z.number().min(0).describe("Unit price before tax"),
});

const PoItem = z.object({
  description: z.string().min(1),
  qty: z.number().positive().optional().describe("Quantity (default 1)"),
  unit_cost: z.number().min(0).describe("Unit cost"),
});

export const tools: ToolDef[] = [
  // ------------------------------------------------------------------ reads
  {
    name: "get_financial_summary",
    description:
      "High-level financial snapshot for the org: account balances, invoice counts by status, outstanding receivables and low-stock count.",
    inputSchema: {},
    handler: safe(async () => {
      const ctx = await getCtx();
      const { data: accounts, error: accErr } = await ctx.supabase
        .from("accounts")
        .select("name, account_type, balance")
        .eq("org_id", ctx.orgId);
      if (accErr) throw new Error(`accounts query failed: ${accErr.message}`);

      const { data: invoices, error: invErr } = await ctx.supabase
        .from("invoice_docs")
        .select("id, status, tax_rate, discount, round_off, unit_price_formula, due_date, currency, invoice_type_code")
        .eq("org_id", ctx.orgId)
        .or(SALES_ONLY);
      if (invErr) throw new Error(`invoice_docs query failed: ${invErr.message}`);

      const counts: Record<string, number> = { draft: 0, sent: 0, paid: 0 };
      for (const inv of invoices ?? []) counts[inv.status] = (counts[inv.status] ?? 0) + 1;

      const sent = (invoices ?? []).filter((i) => ["sent", "overdue"].includes(i.status) && !credit(i));
      const itemsMap = await itemsForInvoices(ctx, sent.map((i) => i.id));
      const paidMap = await paymentsForInvoices(ctx, sent.map((i) => i.id));
      const todayStr = today();
      const balances = new Map<string, { outstanding: number; overdue: number }>();
      for (const inv of sent) {
        const total = Math.max(0, r2(invoiceTotal(inv, itemsMap.get(inv.id) ?? []) - (paidMap.get(inv.id) ?? 0)));
        const currency = currencyOf(inv), balance = balances.get(currency) ?? { outstanding: 0, overdue: 0 };
        balance.outstanding += total;
        if (inv.due_date && inv.due_date < todayStr) balance.overdue += total;
        balances.set(currency, balance);
      }

      const { data: products, error: prodErr } = await ctx.supabase
        .from("products")
        .select("quantity, reorder_level")
        .eq("org_id", ctx.orgId);
      if (prodErr) throw new Error(`products query failed: ${prodErr.message}`);
      const lowStock = (products ?? []).filter(
        (p) => (p.reorder_level ?? 0) > 0 && (p.quantity ?? 0) <= (p.reorder_level ?? 0)
      ).length;

      return {
        account_balances: (accounts ?? []).map((a) => ({
          name: a.name,
          account_type: a.account_type,
          balance: a.balance,
        })),
        total_balance: (accounts ?? []).reduce((s, a) => s + (Number(a.balance) || 0), 0),
        invoice_counts: counts,
        receivables_by_currency: [...balances].map(([currency, balance]) => ({ currency,
          outstanding: r2(balance.outstanding), overdue: r2(balance.overdue) })),
        ...(balances.size <= 1 ? { currency: [...balances.keys()][0] ?? "AED",
          outstanding_receivables: r2([...balances.values()][0]?.outstanding ?? 0),
          overdue_receivables: r2([...balances.values()][0]?.overdue ?? 0) } : {}),
        low_stock_products: lowStock,
      };
    }),
  },
  {
    name: "list_invoices",
    description:
      "List invoices with totals. Optional status filter: draft | sent | paid | overdue (overdue = sent and due_date before today).",
    inputSchema: {
      status: z.enum(["draft", "sent", "paid", "overdue"]).optional(),
      limit: Limit.describe("Max invoices to return (default 10, max 25)"),
    },
    handler: safe(async (args: { status?: string; limit?: number }) => {
      const ctx = await getCtx();
      const limit = Math.min(args.limit ?? 10, 25);
      let q = ctx.supabase
        .from("invoice_docs")
        .select("id, number, customer_name, customer_email, status, issue_date, due_date, currency, tax_rate, discount, round_off, unit_price_formula")
        .eq("org_id", ctx.orgId)
        .or(SALES_ONLY)
        .order("issue_date", { ascending: false })
        .limit(limit);
      if (args.status && args.status !== "overdue") q = q.eq("status", args.status);
      if (args.status === "overdue") q = q.eq("status", "sent").lt("due_date", today());
      const { data, error } = await q;
      if (error) throw new Error(`invoice_docs query failed: ${error.message}`);
      const itemsMap = await itemsForInvoices(ctx, (data ?? []).map((i) => i.id));
      return {
        count: data?.length ?? 0,
        invoices: (data ?? []).map((inv) => ({
          number: inv.number,
          customer_name: inv.customer_name,
          status: inv.status,
          issue_date: inv.issue_date,
          due_date: inv.due_date,
          currency: inv.currency,
          total: invoiceTotal(inv, itemsMap.get(inv.id) ?? []),
        })),
      };
    }),
  },
  {
    name: "get_invoice",
    description: "Fetch a single invoice by number (e.g. INV-2025-A0001), including line items and computed totals.",
    inputSchema: {
      number: z.string().min(1).describe("Invoice number, e.g. INV-2025-A0001"),
    },
    handler: safe(async (args: { number: string }) => {
      const ctx = await getCtx();
      const { data: head, error } = await ctx.supabase
        .from("invoice_docs")
        .select("id, number, customer_name, customer_email, status, issue_date, due_date, currency, doc_type, tax_rate, discount, round_off, unit_price_formula")
        .eq("org_id", ctx.orgId)
        .eq("number", args.number)
        .maybeSingle();
      if (error) throw new Error(`invoice_docs query failed: ${error.message}`);
      if (!head) return { error: `Invoice '${args.number}' not found.` };
      const itemsMap = await itemsForInvoices(ctx, [head.id]);
      const items = itemsMap.get(head.id) ?? [];
      const { net, tax } = computeDocTotals(head, items);
      const { id: _id, ...headOut } = head;
      return {
        ...headOut,
        items,
        net,
        tax,
        total: docTotal(head, items),
      };
    }),
  },
  {
    name: "list_quotes",
    description: "List quotations (newest first).",
    inputSchema: { limit: Limit },
    handler: safe(async (args: { limit?: number }) => {
      const ctx = await getCtx();
      const { data, error } = await ctx.supabase
        .from("quotations")
        .select("id, number, customer_name, status, quote_date, currency")
        .eq("org_id", ctx.orgId)
        .order("quote_date", { ascending: false })
        .limit(args.limit ?? 10);
      if (error) throw new Error(`quotations query failed: ${error.message}`);
      return { count: data?.length ?? 0, quotations: data ?? [] };
    }),
  },
  {
    name: "list_orders",
    description: "List sales orders. NOTE: the underlying 'orders' table may not exist in this deployment.",
    inputSchema: { limit: Limit },
    handler: safe(async (args: { limit?: number }) => {
      const ctx = await getCtx();
      const { data, error } = await ctx.supabase
        .from("orders")
        .select("*")
        .eq("org_id", ctx.orgId)
        .limit(args.limit ?? 10);
      if (error) {
        return {
          error: `Could not list orders: ${error.message}`,
          hint: "The 'orders' table does not appear to exist in this Filey deployment. " +
            "Sales in Filey are tracked via invoices — try list_invoices instead. " +
            "For purchasing, use list_purchase_orders.",
        };
      }
      return { count: data?.length ?? 0, orders: data ?? [] };
    }),
  },
  {
    name: "list_purchase_orders",
    description: "List purchase orders (newest first).",
    inputSchema: { limit: Limit },
    handler: safe(async (args: { limit?: number }) => {
      const ctx = await getCtx();
      const { data, error } = await ctx.supabase
        .from("purchase_orders")
        .select("id, po_number, supplier_id, supplier_name, status, order_date, currency, total")
        .eq("org_id", ctx.orgId)
        .order("order_date", { ascending: false })
        .limit(args.limit ?? 10);
      if (error) throw new Error(`purchase_orders query failed: ${error.message}`);
      return { count: data?.length ?? 0, purchase_orders: data ?? [] };
    }),
  },
  {
    name: "list_customers",
    description: "List CRM customers.",
    inputSchema: { limit: Limit },
    handler: safe(async (args: { limit?: number }) => {
      const ctx = await getCtx();
      const { data, error } = await ctx.supabase
        .from("crm_customers")
        .select("id, name, company, email, phone, segment")
        .eq("org_id", ctx.orgId)
        .order("name", { ascending: true })
        .limit(args.limit ?? 10);
      if (error) throw new Error(`crm_customers query failed: ${error.message}`);
      return { count: data?.length ?? 0, customers: data ?? [] };
    }),
  },
  {
    name: "find_customer",
    description: "Search customers by name or company (case-insensitive substring match).",
    inputSchema: {
      query: z.string().min(1).describe("Name or company fragment to search for"),
    },
    handler: safe(async (args: { query: string }) => {
      const ctx = await getCtx();
      // Strip characters that are special in PostgREST ilike patterns / or() filters.
      const q = args.query.replace(/[%,().]/g, "").trim();
      if (!q) return { error: "Query contained only special characters; provide letters or digits." };
      const { data, error } = await ctx.supabase
        .from("crm_customers")
        .select("id, name, company, email, phone, segment")
        .eq("org_id", ctx.orgId)
        .or(`name.ilike.%${q}%,company.ilike.%${q}%`)
        .limit(20);
      if (error) throw new Error(`crm_customers query failed: ${error.message}`);
      return { count: data?.length ?? 0, customers: data ?? [] };
    }),
  },
  {
    name: "list_products",
    description: "List products / inventory items.",
    inputSchema: { limit: Limit },
    handler: safe(async (args: { limit?: number }) => {
      const ctx = await getCtx();
      const { data, error } = await ctx.supabase
        .from("products")
        .select("id, sku, name, quantity, reorder_level, unit_price, cost_price")
        .eq("org_id", ctx.orgId)
        .order("name", { ascending: true })
        .limit(args.limit ?? 10);
      if (error) throw new Error(`products query failed: ${error.message}`);
      return { count: data?.length ?? 0, products: data ?? [] };
    }),
  },
  {
    name: "list_low_stock",
    description: "List products at or below their reorder level (reorder_level > 0 and quantity <= reorder_level).",
    inputSchema: {},
    handler: safe(async () => {
      const ctx = await getCtx();
      const { data, error } = await ctx.supabase
        .from("products")
        .select("id, sku, name, quantity, reorder_level, unit_price, cost_price")
        .eq("org_id", ctx.orgId)
        .gt("reorder_level", 0);
      if (error) throw new Error(`products query failed: ${error.message}`);
      const low = (data ?? []).filter((p) => (p.quantity ?? 0) <= (p.reorder_level ?? 0));
      return { count: low.length, products: low };
    }),
  },
  {
    name: "run_report",
    description:
      "Run a built-in report: sales_by_month (last 6 months of posted sales minus credit notes, totals by YYYY-MM), " +
      "top_customers (last 90 days invoiced totals by customer, top 10), or " +
      "receivables_aging (unpaid sent/overdue invoices by age). Amounts are grouped by currency; never add different currencies.",
    inputSchema: {
      report: z.enum(["sales_by_month", "top_customers", "receivables_aging"]),
    },
    handler: safe(async (args: { report: string }) => {
      const ctx = await getCtx();

      if (args.report === "sales_by_month") {
        const since = new Date();
        since.setMonth(since.getMonth() - 6);
        const { data, error } = await ctx.supabase
          .from("invoice_docs")
          .select("id, issue_date, tax_rate, discount, round_off, unit_price_formula, currency, invoice_type_code")
          .eq("org_id", ctx.orgId)
          .or(SALES_ONLY)
          .in("status", POSTED)
          .gte("issue_date", since.toISOString().slice(0, 10));
        if (error) throw new Error(`invoice_docs query failed: ${error.message}`);
        const itemsMap = await itemsForInvoices(ctx, (data ?? []).map((i) => i.id));
        const currencies = new Map<string, Map<string, { total: number; invoice_count: number }>>();
        for (const inv of data ?? []) {
          const currency = currencyOf(inv), months = currencies.get(currency) ?? new Map();
          const month = String(inv.issue_date).slice(0, 7);
          const bucket = months.get(month) ?? { total: 0, invoice_count: 0 };
          bucket.total += (credit(inv) ? -1 : 1) * invoiceTotal(inv, itemsMap.get(inv.id) ?? []);
          bucket.invoice_count++;
          months.set(month, bucket); currencies.set(currency, months);
        }
        const by_currency = [...currencies].map(([currency, months]) => ({ currency,
          months: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, bucket]) => ({
            month, invoice_count: bucket.invoice_count, total: r2(bucket.total),
          })),
        }));
        return { report: "sales_by_month", by_currency,
          ...(by_currency.length <= 1 ? { currency: by_currency[0]?.currency ?? "AED", months: by_currency[0]?.months ?? [] } : {}) };

      }

      if (args.report === "top_customers") {
        const { data, error } = await ctx.supabase
          .from("invoice_docs")
          .select("id, customer_name, tax_rate, discount, round_off, unit_price_formula, currency, invoice_type_code")
          .eq("org_id", ctx.orgId)
          .or(SALES_ONLY)
          .in("status", POSTED)
          .gte("issue_date", isoDaysAgo(90));
        if (error) throw new Error(`invoice_docs query failed: ${error.message}`);
        const itemsMap = await itemsForInvoices(ctx, (data ?? []).map((i) => i.id));
        const currencies = new Map<string, Map<string, { total: number; invoice_count: number }>>();
        for (const inv of data ?? []) {
          const currency = currencyOf(inv), customers = currencies.get(currency) ?? new Map();
          const name = inv.customer_name ?? "(unknown)";
          const bucket = customers.get(name) ?? { total: 0, invoice_count: 0 };
          bucket.total += (credit(inv) ? -1 : 1) * invoiceTotal(inv, itemsMap.get(inv.id) ?? []);
          bucket.invoice_count++;
          customers.set(name, bucket); currencies.set(currency, customers);
        }
        const by_currency = [...currencies].map(([currency, customers]) => ({ currency,
          customers: [...customers].map(([customer_name, bucket]) => ({
            customer_name, invoice_count: bucket.invoice_count, total: r2(bucket.total),
          })).sort((a, b) => b.total - a.total).slice(0, 10),
        }));
        return { report: "top_customers", period_days: 90, by_currency,
          ...(by_currency.length <= 1 ? { currency: by_currency[0]?.currency ?? "AED", customers: by_currency[0]?.customers ?? [] } : {}) };

      }

      // Receivables are the unpaid balance of posted sales invoices; credit
      // notes and cancelled/draft documents are never collection targets.
      const { data, error } = await ctx.supabase
        .from("invoice_docs")
        .select("id, number, customer_name, status, due_date, tax_rate, discount, round_off, unit_price_formula, currency, invoice_type_code")
        .eq("org_id", ctx.orgId)
        .or(SALES_ONLY)
        .in("status", ["sent", "overdue"]);
      if (error) throw new Error(`invoice_docs query failed: ${error.message}`);
      const itemsMap = await itemsForInvoices(ctx, (data ?? []).map((i) => i.id));
      const paidMap = await paymentsForInvoices(ctx, (data ?? []).map((i) => i.id));
      const currencies = new Map<string, Record<string, { total: number; invoices: string[] }>>();
      const emptyBuckets = () => Object.fromEntries(["current", "1-30", "31-60", "61-90", "90+"].map(key => [key, { total: 0, invoices: [] as string[] }]));
      const todayMs = Date.parse(today());
      for (const inv of data ?? []) {
        if (credit(inv)) continue;
        const currency = currencyOf(inv), buckets = currencies.get(currency) ?? emptyBuckets();
        const total = docTotal(inv, itemsMap.get(inv.id) ?? []);
        // Fall back to total less paid so docs written before balances were
        // tracked still count.
        const due = total - (paidMap.get(inv.id) ?? 0);
        if (due <= 0.005) continue;
        // Calendar-day diff from UTC midnight — same as the app's aging, so an
        // invoice never lands in a different bucket depending on the hour.
        const daysOverdue = inv.due_date
          ? Math.floor((todayMs - Date.parse(inv.due_date)) / 86_400_000)
          : 0;
        const key =
          daysOverdue <= 0 ? "current"
          : daysOverdue <= 30 ? "1-30"
          : daysOverdue <= 60 ? "31-60"
          : daysOverdue <= 90 ? "61-90"
          : "90+";
        buckets[key].total += due;
        buckets[key].invoices.push(inv.number);
        currencies.set(currency, buckets);
      }
      const by_currency = [...currencies].map(([currency, buckets]) => ({ currency,
        buckets: Object.fromEntries(Object.entries(buckets).map(([key, bucket]) => [key, {
          total: r2(bucket.total), invoice_count: bucket.invoices.length, invoices: bucket.invoices,
        }])),
      }));
      return { report: "receivables_aging", by_currency,
        ...(by_currency.length <= 1 ? { currency: by_currency[0]?.currency ?? "AED",
          buckets: by_currency[0]?.buckets ?? Object.fromEntries(Object.entries(emptyBuckets()).map(([key, bucket]) => [key, { ...bucket, invoice_count: 0 }])) } : {}) };

    }),
  },
];

// ------------------------------------------------------------- draft writes
const writeTools: ToolDef[] = [
  {
    name: "create_draft_invoice",
    description:
      "Create a DRAFT invoice (head + line items). Nothing is sent; the owner reviews and sends it in the Filey UI.",
    inputSchema: {
      customer_name: z.string().min(1),
      customer_email: z.string().email().optional(),
      items: z.array(InvoiceItem).min(1).max(500),
      currency: z.string().optional().describe("ISO currency code (defaults to saved company currency)"),
      tax_rate: z.number().min(0).max(100).optional().describe("Tax rate % (defaults to saved company tax settings)"),
    },
    handler: safe(async (args: {
      customer_name: string;
      customer_email?: string;
      items: Array<{ description: string; qty?: number; unit_price: number }>;
      currency?: string;
      tax_rate?: number;
    }) => {
      const ctx = await getCtx();
      const date = today();
      const preset = await loadDraftPresets(ctx, "invoice", args.customer_name, args);
      const number = await nextNumber(ctx, "invoice_docs", "number", preset.pattern, date);
      const head = {
        ...preset.header, number, customer_name: args.customer_name,
        customer_email: args.customer_email ?? preset.header.customer_email ?? null,
        status: "draft", doc_type: "invoice", issue_date: date, tax_rate: preset.taxRate,
      };
      const rows = args.items.map((item, position) => ({
        description: item.description, qty: item.qty ?? 1, unit_price: item.unit_price, position,
      }));
      await saveDraft(ctx, "invoice_docs", head, rows);

      await audit(ctx, "create_draft_invoice", "invoice_docs", { number, customer: args.customer_name });
      return { number, status: "draft", total: invoiceTotal(head, rows) };
    }),
  },
  {
    name: "create_draft_quote",
    description: "Create a DRAFT quotation (head + line items).",
    inputSchema: {
      customer_name: z.string().min(1),
      items: z.array(InvoiceItem).min(1).max(500),
      currency: z.string().optional().describe("ISO currency code (defaults to saved company currency)"),
      tax_rate: z.number().min(0).max(100).optional().describe("Tax rate % (defaults to saved company tax settings)"),
    },
    handler: safe(async (args: {
      customer_name: string;
      items: Array<{ description: string; qty?: number; unit_price: number }>;
      currency?: string;
      tax_rate?: number;
    }) => {
      const ctx = await getCtx();
      const date = today();
      const preset = await loadDraftPresets(ctx, "quote", args.customer_name, args);
      const number = await nextNumber(ctx, "quotations", "number", preset.pattern, date);
      const head = {
        ...preset.header, number, customer_name: args.customer_name, status: "draft",
        quote_date: date, tax_rate: preset.taxRate,
      };
      const rows = args.items.map((item, position) => ({
        product: item.description, qty: item.qty ?? 1, rate: item.unit_price, position,
      }));
      await saveDraft(ctx, "quotations", head, rows);

      await audit(ctx, "create_draft_quote", "quotations", { number, customer: args.customer_name });
      return { number, status: "draft", total: invoiceTotal(head, args.items.map(item => ({ ...item, qty: item.qty ?? 1 }))) };
    }),
  },
  {
    name: "create_draft_po",
    description:
      "Create a DRAFT purchase order for a supplier. The supplier is linked only when the name uniquely identifies an existing supplier.",
    inputSchema: {
      supplier_name: z.string().min(1),
      items: z.array(PoItem).min(1).max(500),
      currency: z.string().optional().describe("ISO currency code (defaults to saved company currency)"),
      tax_rate: z.number().min(0).max(100).optional().describe("Tax rate % (defaults to saved company tax settings)"),
    },
    handler: safe(async (args: {
      supplier_name: string;
      items: Array<{ description: string; qty?: number; unit_cost: number }>;
      currency?: string;
      tax_rate?: number;
    }) => {
      const ctx = await getCtx();
      const date = today();
      const preset = await loadDraftPresets(ctx, "purchase_order", args.supplier_name, args);
      const poNumber = await nextNumber(ctx, "purchase_orders", "po_number", preset.pattern, date);
      const total = invoiceTotal({ tax_rate: preset.taxRate }, args.items.map(item => ({ qty: item.qty ?? 1, unit_price: item.unit_cost })));
      const head = {
        ...preset.header, po_number: poNumber, supplier_name: args.supplier_name,
        status: "draft", order_date: date, total,
      };
      const rows = args.items.map((item, position) => ({
        description: item.description, quantity: item.qty ?? 1, unit_cost: item.unit_cost, position,
      }));
      await saveDraft(ctx, "purchase_orders", head, rows);

      await audit(ctx, "create_draft_po", "purchase_orders", { po_number: poNumber, supplier: args.supplier_name });
      return {
        po_number: poNumber,
        status: "draft",
        supplier_linked: preset.header.supplier_id !== null,
        total,
      };
    }),
  },
  {
    name: "add_customer",
    description: "Add a customer to the CRM.",
    inputSchema: {
      name: z.string().min(1),
      company: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
    },
    handler: safe(async (args: { name: string; company?: string; email?: string; phone?: string }) => {
      const ctx = await getCtx();
      const { data, error } = await ctx.supabase
        .from("crm_customers")
        .insert({
          user_id: ctx.userId,
          org_id: ctx.orgId,
          name: args.name,
          company: args.company ?? null,
          email: args.email ?? null,
          phone: args.phone ?? null,
        })
        .select("id, name")
        .single();
      if (error || !data) throw new Error(`Failed to add customer: ${error?.message}`);
      await audit(ctx, "add_customer", "crm_customers", { id: data.id, name: data.name });
      return { id: data.id, name: data.name };
    }),
  },
  {
    name: "add_product",
    description: "Add a product to inventory. Stock quantity starts at 0.",
    inputSchema: {
      name: z.string().min(1),
      sku: z.string().optional(),
      unit_price: z.number().min(0).optional(),
      cost_price: z.number().min(0).optional(),
      reorder_level: z.number().int().min(0).optional(),
    },
    handler: safe(async (args: {
      name: string;
      sku?: string;
      unit_price?: number;
      cost_price?: number;
      reorder_level?: number;
    }) => {
      const ctx = await getCtx();
      const { data, error } = await ctx.supabase
        .from("products")
        .insert({
          user_id: ctx.userId,
          org_id: ctx.orgId,
          name: args.name,
          sku: args.sku ?? null,
          unit_price: args.unit_price ?? 0,
          cost_price: args.cost_price ?? 0,
          reorder_level: args.reorder_level ?? 0,
          quantity: 0,
        })
        .select("id, name, sku")
        .single();
      if (error || !data) throw new Error(`Failed to add product: ${error?.message}`);
      await audit(ctx, "add_product", "products", { id: data.id, name: data.name, sku: data.sku });
      return { id: data.id, name: data.name, sku: data.sku, quantity: 0 };
    }),
  },

  // ------------------------------------------------------------ confirm-gated
  {
    name: "request_payment_reminder",
    description:
      "Request that a payment reminder email be sent for a SENT invoice. This does NOT send anything: " +
      "the owner must request and approve it in their paired channel so the approval is bound to that authenticated conversation.",
    inputSchema: {
      invoice_number: z.string().min(1).describe("Invoice number, e.g. INV-2025-A0001"),
    },
    handler: safe(async (args: { invoice_number: string }) => {
      const ctx = await getCtx();
      const { data: inv, error } = await ctx.supabase
        .from("invoice_docs")
        .select("id, number, customer_name, customer_email, status, due_date")
        .eq("org_id", ctx.orgId)
        .eq("number", args.invoice_number)
        .maybeSingle();
      if (error) throw new Error(`invoice_docs query failed: ${error.message}`);
      if (!inv) return { error: `Invoice '${args.invoice_number}' not found.` };
      if (inv.status !== "sent") {
        return {
          error: `Invoice ${inv.number} has status '${inv.status}'. ` +
            "Payment reminders can only be requested for invoices with status 'sent'.",
        };
      }
      if (!inv.customer_email) {
        return { error: `Invoice ${inv.number} has no customer_email on file; cannot send a reminder.` };
      }

      // MCP stdio has no authenticated messaging actor to bind an approval to.
      // Ask the owner to propose it in that channel instead of creating a code
      // that hardened channel approvals must (correctly) reject.
      return {
        invoice: inv.number,
        status: "requires_channel_proposal",
        note: "Ask Filey AI on your paired channel to prepare this payment reminder, then review and approve it there. Nothing has been sent or queued.",
      };
    }),
  },
];

export const allTools: ToolDef[] = [...tools, ...writeTools];
