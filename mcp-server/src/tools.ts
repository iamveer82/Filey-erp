import { z } from "zod";
import { getCtx, type Ctx } from "./client.js";

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

function lineTotal(items: Array<{ qty?: number | null; unit_price?: number | null }>): number {
  return items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);
}

function invoiceTotal(
  head: { tax_rate?: number | null },
  items: Array<{ qty?: number | null; unit_price?: number | null }>
): number {
  const net = lineTotal(items);
  const tax = (net * (Number(head.tax_rate) || 0)) / 100;
  return Math.round((net + tax) * 100) / 100;
}

async function itemsForInvoices(
  ctx: Ctx,
  invoiceIds: string[]
): Promise<Map<string, Array<{ description: string; qty: number; unit_price: number; position: number }>>> {
  const map = new Map<string, any[]>();
  if (invoiceIds.length === 0) return map;
  const { data, error } = await ctx.supabase
    .from("invoice_doc_items")
    .select("invoice_id, description, qty, unit_price, position")
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

/** Generate the next sequential document number, e.g. INV-2025-A0042. */
async function nextNumber(
  ctx: Ctx,
  table: string,
  column: string,
  prefix: string
): Promise<string> {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-A%`;
  const { data, error } = await ctx.supabase
    .from(table)
    .select(column)
    .eq("org_id", ctx.orgId)
    .like(column, like)
    .order(column, { ascending: false })
    .limit(1);
  if (error) throw new Error(`${table} numbering query failed: ${error.message}`);
  let seq = 1;
  const firstRow = data?.[0] as unknown as Record<string, unknown> | undefined;
  const last = firstRow?.[column] as string | undefined;
  if (last) {
    const m = last.match(/A(\d{4,})$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}-${year}-A${String(seq).padStart(4, "0")}`;
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
        .select("id, status, tax_rate, due_date")
        .eq("org_id", ctx.orgId)
        .eq("doc_type", "invoice");
      if (invErr) throw new Error(`invoice_docs query failed: ${invErr.message}`);

      const counts: Record<string, number> = { draft: 0, sent: 0, paid: 0 };
      for (const inv of invoices ?? []) counts[inv.status] = (counts[inv.status] ?? 0) + 1;

      const sent = (invoices ?? []).filter((i) => i.status === "sent");
      const itemsMap = await itemsForInvoices(ctx, sent.map((i) => i.id));
      const todayStr = today();
      let receivables = 0;
      let overdueReceivables = 0;
      for (const inv of sent) {
        const total = invoiceTotal(inv, itemsMap.get(inv.id) ?? []);
        receivables += total;
        if (inv.due_date && inv.due_date < todayStr) overdueReceivables += total;
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
        outstanding_receivables: Math.round(receivables * 100) / 100,
        overdue_receivables: Math.round(overdueReceivables * 100) / 100,
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
        .select("id, number, customer_name, customer_email, status, issue_date, due_date, currency, tax_rate")
        .eq("org_id", ctx.orgId)
        .eq("doc_type", "invoice")
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
        .select("id, number, customer_name, customer_email, status, issue_date, due_date, currency, doc_type, tax_rate")
        .eq("org_id", ctx.orgId)
        .eq("number", args.number)
        .maybeSingle();
      if (error) throw new Error(`invoice_docs query failed: ${error.message}`);
      if (!head) return { error: `Invoice '${args.number}' not found.` };
      const itemsMap = await itemsForInvoices(ctx, [head.id]);
      const items = itemsMap.get(head.id) ?? [];
      const net = lineTotal(items);
      const tax = (net * (Number(head.tax_rate) || 0)) / 100;
      const { id: _id, ...headOut } = head;
      return {
        ...headOut,
        items,
        net: Math.round(net * 100) / 100,
        tax: Math.round(tax * 100) / 100,
        total: Math.round((net + tax) * 100) / 100,
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
      "Run a built-in report: sales_by_month (last 6 months of non-draft invoices, totals by YYYY-MM), " +
      "top_customers (last 90 days invoiced totals by customer, top 10), or " +
      "receivables_aging (sent invoices bucketed current / 1-30 / 31-60 / 61-90 / 90+ days overdue).",
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
          .select("id, issue_date, tax_rate")
          .eq("org_id", ctx.orgId)
          .eq("doc_type", "invoice")
          .neq("status", "draft")
          .gte("issue_date", since.toISOString().slice(0, 10));
        if (error) throw new Error(`invoice_docs query failed: ${error.message}`);
        const itemsMap = await itemsForInvoices(ctx, (data ?? []).map((i) => i.id));
        const months = new Map<string, { total: number; invoice_count: number }>();
        for (const inv of data ?? []) {
          const month = String(inv.issue_date).slice(0, 7);
          const bucket = months.get(month) ?? { total: 0, invoice_count: 0 };
          bucket.total += invoiceTotal(inv, itemsMap.get(inv.id) ?? []);
          bucket.invoice_count += 1;
          months.set(month, bucket);
        }
        return {
          report: "sales_by_month",
          months: [...months.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, b]) => ({
              month,
              invoice_count: b.invoice_count,
              total: Math.round(b.total * 100) / 100,
            })),
        };
      }

      if (args.report === "top_customers") {
        const { data, error } = await ctx.supabase
          .from("invoice_docs")
          .select("id, customer_name, tax_rate")
          .eq("org_id", ctx.orgId)
          .eq("doc_type", "invoice")
          .neq("status", "draft")
          .gte("issue_date", isoDaysAgo(90));
        if (error) throw new Error(`invoice_docs query failed: ${error.message}`);
        const itemsMap = await itemsForInvoices(ctx, (data ?? []).map((i) => i.id));
        const byCustomer = new Map<string, { total: number; invoice_count: number }>();
        for (const inv of data ?? []) {
          const key = inv.customer_name ?? "(unknown)";
          const bucket = byCustomer.get(key) ?? { total: 0, invoice_count: 0 };
          bucket.total += invoiceTotal(inv, itemsMap.get(inv.id) ?? []);
          bucket.invoice_count += 1;
          byCustomer.set(key, bucket);
        }
        return {
          report: "top_customers",
          period_days: 90,
          customers: [...byCustomer.entries()]
            .map(([customer_name, b]) => ({
              customer_name,
              invoice_count: b.invoice_count,
              total: Math.round(b.total * 100) / 100,
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 10),
        };
      }

      // receivables_aging
      const { data, error } = await ctx.supabase
        .from("invoice_docs")
        .select("id, number, customer_name, due_date, tax_rate")
        .eq("org_id", ctx.orgId)
        .eq("doc_type", "invoice")
        .eq("status", "sent");
      if (error) throw new Error(`invoice_docs query failed: ${error.message}`);
      const itemsMap = await itemsForInvoices(ctx, (data ?? []).map((i) => i.id));
      const buckets: Record<string, { total: number; invoices: string[] }> = {
        current: { total: 0, invoices: [] },
        "1-30": { total: 0, invoices: [] },
        "31-60": { total: 0, invoices: [] },
        "61-90": { total: 0, invoices: [] },
        "90+": { total: 0, invoices: [] },
      };
      const now = Date.now();
      for (const inv of data ?? []) {
        const total = invoiceTotal(inv, itemsMap.get(inv.id) ?? []);
        const daysOverdue = inv.due_date
          ? Math.floor((now - new Date(inv.due_date).getTime()) / 86_400_000)
          : 0;
        const key =
          daysOverdue <= 0 ? "current"
          : daysOverdue <= 30 ? "1-30"
          : daysOverdue <= 60 ? "31-60"
          : daysOverdue <= 90 ? "61-90"
          : "90+";
        buckets[key].total += total;
        buckets[key].invoices.push(inv.number);
      }
      return {
        report: "receivables_aging",
        buckets: Object.fromEntries(
          Object.entries(buckets).map(([k, v]) => [
            k,
            { total: Math.round(v.total * 100) / 100, invoice_count: v.invoices.length, invoices: v.invoices },
          ])
        ),
      };
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
      items: z.array(InvoiceItem).min(1),
      currency: z.string().optional().describe("ISO currency code (default AED)"),
      tax_rate: z.number().min(0).optional().describe("Tax rate % applied to the net total (default 5)"),
    },
    handler: safe(async (args: {
      customer_name: string;
      customer_email?: string;
      items: Array<{ description: string; qty?: number; unit_price: number }>;
      currency?: string;
      tax_rate?: number;
    }) => {
      const ctx = await getCtx();
      const number = await nextNumber(ctx, "invoice_docs", "number", "INV");
      const { data: head, error } = await ctx.supabase
        .from("invoice_docs")
        .insert({
          user_id: ctx.userId,
          org_id: ctx.orgId,
          number,
          customer_name: args.customer_name,
          customer_email: args.customer_email ?? null,
          status: "draft",
          doc_type: "invoice",
          issue_date: today(),
          currency: args.currency ?? "AED",
          tax_rate: args.tax_rate ?? 5,
        })
        .select("id, number, tax_rate")
        .single();
      if (error || !head) throw new Error(`Failed to create invoice: ${error?.message}`);

      const rows = args.items.map((it, i) => ({
        user_id: ctx.userId,
        org_id: ctx.orgId,
        invoice_id: head.id,
        description: it.description,
        qty: it.qty ?? 1,
        unit_price: it.unit_price,
        position: i,
      }));
      const { error: itemErr } = await ctx.supabase.from("invoice_doc_items").insert(rows);
      if (itemErr) throw new Error(`Invoice head ${number} created but items failed: ${itemErr.message}`);

      await audit(ctx, "create_draft_invoice", "invoice_docs", { number, customer: args.customer_name });
      return { number, status: "draft", total: invoiceTotal(head, rows) };
    }),
  },
  {
    name: "create_draft_quote",
    description: "Create a DRAFT quotation (head + line items).",
    inputSchema: {
      customer_name: z.string().min(1),
      items: z.array(InvoiceItem).min(1),
      currency: z.string().optional().describe("ISO currency code (default AED)"),
    },
    handler: safe(async (args: {
      customer_name: string;
      items: Array<{ description: string; qty?: number; unit_price: number }>;
      currency?: string;
    }) => {
      const ctx = await getCtx();
      const number = await nextNumber(ctx, "quotations", "number", "Q");
      const { data: head, error } = await ctx.supabase
        .from("quotations")
        .insert({
          user_id: ctx.userId,
          org_id: ctx.orgId,
          number,
          customer_name: args.customer_name,
          status: "draft",
          quote_date: today(),
          currency: args.currency ?? "AED",
        })
        .select("id, number")
        .single();
      if (error || !head) throw new Error(`Failed to create quotation: ${error?.message}`);

      const rows = args.items.map((it, i) => ({
        user_id: ctx.userId,
        org_id: ctx.orgId,
        quotation_id: head.id,
        description: it.description,
        qty: it.qty ?? 1,
        unit_price: it.unit_price,
        position: i,
      }));
      const { error: itemErr } = await ctx.supabase.from("quotation_items").insert(rows);
      if (itemErr) throw new Error(`Quotation head ${number} created but items failed: ${itemErr.message}`);

      await audit(ctx, "create_draft_quote", "quotations", { number, customer: args.customer_name });
      return { number, status: "draft", total: lineTotal(rows) };
    }),
  },
  {
    name: "create_draft_po",
    description:
      "Create a DRAFT purchase order for a supplier. The supplier is linked by name (fuzzy match) when a matching suppliers row exists.",
    inputSchema: {
      supplier_name: z.string().min(1),
      items: z.array(PoItem).min(1),
      currency: z.string().optional().describe("ISO currency code (default AED)"),
    },
    handler: safe(async (args: {
      supplier_name: string;
      items: Array<{ description: string; qty?: number; unit_cost: number }>;
      currency?: string;
    }) => {
      const ctx = await getCtx();

      // Best-effort supplier link by name.
      const q = args.supplier_name.replace(/[%,().]/g, "").trim();
      let supplierId: string | null = null;
      if (q) {
        const { data: sup } = await ctx.supabase
          .from("suppliers")
          .select("id")
          .eq("org_id", ctx.orgId)
          .ilike("name", `%${q}%`)
          .limit(1)
          .maybeSingle();
        supplierId = sup?.id ?? null;
      }

      const poNumber = await nextNumber(ctx, "purchase_orders", "po_number", "PO");
      const total = args.items.reduce((s, it) => s + (it.qty ?? 1) * it.unit_cost, 0);
      const { data: head, error } = await ctx.supabase
        .from("purchase_orders")
        .insert({
          user_id: ctx.userId,
          org_id: ctx.orgId,
          po_number: poNumber,
          supplier_id: supplierId,
          supplier_name: args.supplier_name,
          status: "draft",
          order_date: today(),
          currency: args.currency ?? "AED",
          total,
        })
        .select("id, po_number")
        .single();
      if (error || !head) throw new Error(`Failed to create purchase order: ${error?.message}`);

      const rows = args.items.map((it, i) => ({
        user_id: ctx.userId,
        org_id: ctx.orgId,
        po_id: head.id,
        description: it.description,
        quantity: it.qty ?? 1,
        unit_cost: it.unit_cost,
        position: i,
      }));
      const { error: itemErr } = await ctx.supabase.from("purchase_order_items").insert(rows);
      if (itemErr) throw new Error(`PO head ${poNumber} created but items failed: ${itemErr.message}`);

      await audit(ctx, "create_draft_po", "purchase_orders", { po_number: poNumber, supplier: args.supplier_name });
      return {
        po_number: poNumber,
        status: "draft",
        supplier_linked: supplierId !== null,
        total: Math.round(total * 100) / 100,
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
      "it creates a pending action that the owner must approve by replying APPROVE <code> on a connected channel.",
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

      const code = String(Math.floor(1000 + Math.random() * 9000)); // 4-digit approval code
      const { error: insErr } = await ctx.supabase.from("agent_pending_actions").insert({
        user_id: ctx.userId,
        org_id: ctx.orgId,
        code,
        action: "send_payment_reminder",
        payload: {
          invoice_id: inv.id,
          number: inv.number,
          customer_name: inv.customer_name,
          customer_email: inv.customer_email,
          due_date: inv.due_date,
        },
        status: "pending",
      });
      if (insErr) throw new Error(`Failed to create pending action: ${insErr.message}`);

      await audit(ctx, "request_payment_reminder", "agent_pending_actions", {
        invoice: inv.number,
        code,
      });
      return {
        approval_code: code,
        invoice: inv.number,
        status: "pending",
        note: `owner replies APPROVE ${code} on a connected channel`,
      };
    }),
  },
];

export const allTools: ToolDef[] = [...tools, ...writeTools];
