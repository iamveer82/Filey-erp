// ERP data tools for the channel agent: reads + DRAFT-ONLY writes.
//
// SECURITY: the caller passes a *service-role* Supabase client, which bypasses
// RLS. The `.eq("org_id", org)` on every read and the explicit
// { user_id, org_id } on every insert are therefore the ONLY tenant boundary.
// Never remove them.
//
// WRITE POLICY (phase 1 of the autonomy plan): every write tool creates a
// DRAFT or an additive record — reversible by definition, reviewed and
// finalized by the owner in the app. No tool may send, finalize, pay, delete
// or modify an existing record. Actions with external effect come later
// behind an explicit confirm step. Every write is logged to audit_log.

export type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export const TOOLS: ToolDef[] = [
  {
    name: "get_financial_summary",
    description:
      "Current accounting balances: receivables (money owed to you), payables " +
      "(money you owe), cash/bank, income and expense accounts. Use for cash " +
      "position, what you're owed, revenue or expense questions. Amounts are in " +
      "the account currency (AED unless stated).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_invoices",
    description:
      "List recent invoices, newest first. Optionally filter by status: 'draft', " +
      "'sent', 'paid', or 'overdue' (sent and past due date). Use for questions " +
      "about specific invoices, who hasn't paid, or recent billing.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "sent", "paid", "overdue"],
          description: "Filter by invoice status.",
        },
        limit: {
          type: "integer",
          description: "Max invoices to return (default 10, max 25).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_low_stock",
    description:
      "Products at or below their reorder level — what needs restocking. Use for " +
      "inventory and reorder questions.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "run_report",
    description:
      "Run a predefined business report. Reports: 'sales_by_month' (last 6 " +
      "months of finalized sales invoices), 'top_customers' (by invoiced total, " +
      "last 90 days), 'receivables_aging' (unpaid invoices bucketed by how " +
      "overdue they are). Use for analytical questions — trends, who buys most, " +
      "what's stuck unpaid.",
    input_schema: {
      type: "object",
      properties: {
        report: {
          type: "string",
          enum: ["sales_by_month", "top_customers", "receivables_aging"],
        },
      },
      required: ["report"],
      additionalProperties: false,
    },
  },
  {
    name: "find_customer",
    description:
      "Search customers by name or company (partial match). Returns contact " +
      "details. Use to look up a customer's email, phone or segment.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name or company to search for." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

const LINE_ITEM_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: 30,
  items: {
    type: "object",
    properties: {
      description: { type: "string", description: "Line description." },
      qty: { type: "number", description: "Quantity (default 1)." },
      unit_price: { type: "number", description: "Unit price in the document currency." },
    },
    required: ["description", "unit_price"],
    additionalProperties: false,
  },
};

/** Draft-only write tools — see WRITE POLICY at the top of this file. */
export const WRITE_TOOLS: ToolDef[] = [
  {
    name: "create_draft_invoice",
    description:
      "Create a DRAFT invoice the owner will review and finalize in Filey. " +
      "Use find_customer first to get the exact name/email when the customer " +
      "exists. The draft is never sent automatically.",
    input_schema: {
      type: "object",
      properties: {
        customer_name: { type: "string", description: "Customer or company name." },
        customer_email: { type: "string", description: "Customer email, if known." },
        items: LINE_ITEM_SCHEMA,
        currency: { type: "string", description: "3-letter currency, default AED." },
        tax_rate: { type: "number", description: "VAT % — default 5 (UAE standard)." },
      },
      required: ["customer_name", "items"],
      additionalProperties: false,
    },
  },
  {
    name: "create_draft_quote",
    description:
      "Create a DRAFT quotation the owner will review and send from Filey.",
    input_schema: {
      type: "object",
      properties: {
        customer_name: { type: "string", description: "Customer or company name." },
        items: LINE_ITEM_SCHEMA,
        currency: { type: "string", description: "3-letter currency, default AED." },
      },
      required: ["customer_name", "items"],
      additionalProperties: false,
    },
  },
  {
    name: "create_draft_po",
    description:
      "Create a DRAFT purchase order to a supplier; the owner reviews and " +
      "sends it from Filey.",
    input_schema: {
      type: "object",
      properties: {
        supplier_name: { type: "string", description: "Supplier name." },
        items: {
          ...LINE_ITEM_SCHEMA,
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              qty: { type: "number", description: "Quantity (default 1)." },
              unit_cost: { type: "number", description: "Unit cost." },
            },
            required: ["description", "unit_cost"],
            additionalProperties: false,
          },
        },
        currency: { type: "string", description: "3-letter currency, default AED." },
      },
      required: ["supplier_name", "items"],
      additionalProperties: false,
    },
  },
  {
    name: "add_customer",
    description:
      "Add a new customer to the CRM. Check with find_customer first to avoid " +
      "duplicates.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Contact name." },
        company: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "add_product",
    description:
      "Add a new product to inventory (stock starts at 0 — receiving stock is " +
      "done in the app).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        sku: { type: "string" },
        unit_price: { type: "number", description: "Selling price." },
        cost_price: { type: "number", description: "Cost price." },
        reorder_level: { type: "number", description: "Low-stock threshold." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
];

/** Actions with EXTERNAL effect (they leave the org: emails to customers).
 *  These are never executed directly — the tool creates a pending action and
 *  the owner must reply "APPROVE <code>" on the channel to fire it. */
export const CONFIRM_TOOLS: ToolDef[] = [
  {
    name: "request_payment_reminder",
    description:
      "Propose sending a payment-reminder email to the customer of an unpaid " +
      "invoice. This does NOT send anything — it returns an approval code the " +
      "owner must reply with (APPROVE <code>) before the email goes out. Use " +
      "list_invoices first to find the invoice number.",
    input_schema: {
      type: "object",
      properties: {
        invoice_number: { type: "string", description: "Exact invoice number, e.g. INV-2026-0042." },
      },
      required: ["invoice_number"],
      additionalProperties: false,
    },
  },
];

/** Reads + draft-writes + confirm-gated proposals — the channel agent's set. */
export const ALL_TOOLS: ToolDef[] = [...TOOLS, ...WRITE_TOOLS, ...CONFIRM_TOOLS];

const num = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Suffix marks agent-created drafts; the owner renumbers on finalize if needed. */
const draftNumber = (prefix: string) =>
  `${prefix}-${new Date().getFullYear()}-A${Math.floor(Math.random() * 9000) + 1000}`;

// deno-lint-ignore no-explicit-any
async function logAgentAction(client: any, ownerId: string, action: string, entity: string, details: string) {
  try {
    await client.from("audit_log").insert({
      user_id: ownerId,
      actor: "agent",
      action,
      entity,
      details,
    });
  } catch (e) {
    console.error("agent audit log failed", e); // best-effort, never blocks
  }
}

// deno-lint-ignore no-explicit-any
export async function runTool(
  // deno-lint-ignore no-explicit-any
  client: any,
  orgId: string,
  name: string,
  // deno-lint-ignore no-explicit-any
  input: any,
  /** Required for write tools: the account the rows belong to. */
  ownerId?: string,
): Promise<unknown> {
  const org = String(orgId);

  // ---- draft-only writes ----
  if (WRITE_TOOLS.some((t) => t.name === name)) {
    if (!ownerId) return { error: "writes are not configured (no owner)" };
    return runWriteTool(client, org, ownerId, name, input);
  }

  // ---- confirm-gated proposals ----
  if (name === "request_payment_reminder") {
    if (!ownerId) return { error: "actions are not configured (no owner)" };
    return proposePaymentReminder(client, org, ownerId, input);
  }

  switch (name) {
    case "get_financial_summary": {
      const { data, error } = await client
        .from("accounts")
        .select("name,account_type,balance")
        .eq("org_id", org);
      if (error) return { error: error.message };
      return (data ?? [])
        // deno-lint-ignore no-explicit-any
        .map((a: any) => ({ name: a.name, type: a.account_type, balance: Number(a.balance) }))
        // deno-lint-ignore no-explicit-any
        .filter((a: any) => a.balance !== 0);
    }
    case "list_invoices": {
      const limit = Math.min(Math.max(Number(input?.limit) || 10, 1), 25);
      const status = typeof input?.status === "string" ? input.status : undefined;
      let q = client
        .from("invoice_docs")
        .select("number,customer_name,status,issue_date,due_date,currency")
        .eq("org_id", org)
        .order("issue_date", { ascending: false })
        .limit(limit);
      if (status === "overdue") {
        const today = new Date().toISOString().slice(0, 10);
        q = q.eq("status", "sent").lt("due_date", today);
      } else if (status) {
        q = q.eq("status", status);
      }
      const { data, error } = await q;
      if (error) return { error: error.message };
      return data ?? [];
    }
    case "list_low_stock": {
      const { data, error } = await client
        .from("products")
        .select("sku,name,quantity,reorder_level")
        .eq("org_id", org);
      if (error) return { error: error.message };
      return (data ?? [])
        // deno-lint-ignore no-explicit-any
        .filter((p: any) => Number(p.reorder_level) > 0 && Number(p.quantity) <= Number(p.reorder_level))
        // deno-lint-ignore no-explicit-any
        .map((p: any) => ({
          sku: p.sku,
          name: p.name,
          quantity: Number(p.quantity),
          reorder_level: Number(p.reorder_level),
        }))
        .slice(0, 50);
    }
    case "run_report": {
      const report = String(input?.report ?? "");
      const t = new Date();
      if (report === "sales_by_month") {
        const since = new Date(t.getFullYear(), t.getMonth() - 5, 1).toISOString().slice(0, 10);
        const { data, error } = await client
          .from("invoice_docs")
          .select("issue_date,status,doc_type,id")
          .eq("org_id", org)
          .neq("status", "draft")
          .gte("issue_date", since);
        if (error) return { error: error.message };
        // Totals need items; keep it cheap: count invoices per month + fetch totals per doc set.
        // deno-lint-ignore no-explicit-any
        const sales = (data ?? []).filter((d: any) => d.doc_type !== "purchase");
        // deno-lint-ignore no-explicit-any
        const ids = sales.map((d: any) => d.id);
        const { data: items } = ids.length
          ? await client.from("invoice_doc_items").select("invoice_id,qty,unit_price").in("invoice_id", ids)
          : { data: [] };
        const totalByDoc = new Map<number, number>();
        // deno-lint-ignore no-explicit-any
        for (const it of items ?? []) {
          totalByDoc.set(it.invoice_id, (totalByDoc.get(it.invoice_id) ?? 0) + Number(it.qty) * Number(it.unit_price));
        }
        const byMonth: Record<string, { invoices: number; total: number }> = {};
        // deno-lint-ignore no-explicit-any
        for (const d of sales) {
          const mo = String(d.issue_date ?? "").slice(0, 7);
          if (!mo) continue;
          byMonth[mo] ??= { invoices: 0, total: 0 };
          byMonth[mo].invoices++;
          byMonth[mo].total += Math.round((totalByDoc.get(d.id) ?? 0) * 100) / 100;
        }
        return byMonth;
      }
      if (report === "top_customers") {
        const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
        const { data, error } = await client
          .from("invoice_docs")
          .select("id,customer_name,doc_type,status,issue_date")
          .eq("org_id", org)
          .neq("status", "draft")
          .gte("issue_date", since);
        if (error) return { error: error.message };
        // deno-lint-ignore no-explicit-any
        const sales = (data ?? []).filter((d: any) => d.doc_type !== "purchase");
        // deno-lint-ignore no-explicit-any
        const ids = sales.map((d: any) => d.id);
        const { data: items } = ids.length
          ? await client.from("invoice_doc_items").select("invoice_id,qty,unit_price").in("invoice_id", ids)
          : { data: [] };
        const totalByDoc = new Map<number, number>();
        // deno-lint-ignore no-explicit-any
        for (const it of items ?? []) {
          totalByDoc.set(it.invoice_id, (totalByDoc.get(it.invoice_id) ?? 0) + Number(it.qty) * Number(it.unit_price));
        }
        const byCustomer: Record<string, number> = {};
        // deno-lint-ignore no-explicit-any
        for (const d of sales) {
          const c = d.customer_name || "—";
          byCustomer[c] = Math.round(((byCustomer[c] ?? 0) + (totalByDoc.get(d.id) ?? 0)) * 100) / 100;
        }
        return Object.entries(byCustomer)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([customer, total]) => ({ customer, total }));
      }
      if (report === "receivables_aging") {
        const todayIso = new Date().toISOString().slice(0, 10);
        const { data, error } = await client
          .from("invoice_docs")
          .select("number,customer_name,due_date,status,doc_type")
          .eq("org_id", org)
          .eq("status", "sent");
        if (error) return { error: error.message };
        const buckets: Record<string, { number: string; customer: string }[]> = {
          current: [], "1-30": [], "31-60": [], "61-90": [], "90+": [],
        };
        // deno-lint-ignore no-explicit-any
        for (const d of (data ?? []).filter((x: any) => x.doc_type !== "purchase")) {
          const days = d.due_date
            ? Math.floor((Date.parse(todayIso) - Date.parse(d.due_date)) / 86400000)
            : 0;
          const key = days <= 0 ? "current" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
          buckets[key].push({ number: d.number, customer: d.customer_name });
        }
        return buckets;
      }
      return { error: `unknown report: ${report}` };
    }
    case "find_customer": {
      const term = String(input?.query ?? "").trim();
      if (!term) return [];
      // Strip characters that have meaning in a PostgREST or() filter so a chat
      // message can't break out of the ilike pattern.
      const safe = term.replace(/[%,().]/g, " ").slice(0, 80);
      const { data, error } = await client
        .from("crm_customers")
        .select("name,company,email,phone,segment")
        .eq("org_id", org)
        .or(`name.ilike.%${safe}%,company.ilike.%${safe}%`)
        .limit(10);
      if (error) return { error: error.message };
      return data ?? [];
    }
    default:
      return { error: `unknown tool: ${name}` };
  }
}

/** Create a pending payment-reminder action; the webhook executes it when the
 *  owner replies APPROVE <code>. Validates the invoice up front so the owner
 *  only ever approves something executable. */
// deno-lint-ignore no-explicit-any
async function proposePaymentReminder(client: any, org: string, ownerId: string, input: any): Promise<unknown> {
  const number = String(input?.invoice_number ?? "").trim().slice(0, 60);
  if (!number) return { error: "invoice_number is required" };
  const { data: inv, error } = await client
    .from("invoice_docs")
    .select("id,number,customer_name,customer_email,due_date,status,currency")
    .eq("org_id", org)
    .eq("number", number)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!inv) return { error: `invoice ${number} not found` };
  if (inv.status === "paid" || inv.status === "draft")
    return { error: `invoice ${number} is ${inv.status} — no reminder needed/possible` };
  if (!inv.customer_email)
    return { error: `invoice ${number} has no customer email on file — add one in Filey first` };

  const code = String(Math.floor(Math.random() * 9000) + 1000);
  const { error: pe } = await client.from("agent_pending_actions").insert({
    user_id: ownerId,
    org_id: org,
    code,
    action: "send_payment_reminder",
    payload: {
      invoice_id: inv.id,
      number: inv.number,
      customer_name: inv.customer_name,
      customer_email: inv.customer_email,
      due_date: inv.due_date,
    },
  });
  if (pe) return { error: pe.message };
  return {
    proposed: "send_payment_reminder",
    invoice: inv.number,
    to: inv.customer_email,
    approval_code: code,
    note:
      `Tell the user: reply "APPROVE ${code}" to send the reminder to ` +
      `${inv.customer_email}, or "CANCEL ${code}" to drop it. Codes expire in 24h.`,
  };
}

// deno-lint-ignore no-explicit-any
async function runWriteTool(
  // deno-lint-ignore no-explicit-any
  client: any,
  org: string,
  ownerId: string,
  name: string,
  // deno-lint-ignore no-explicit-any
  input: any,
): Promise<unknown> {
  // Service role bypasses column defaults tied to auth.uid()/current_org(),
  // so ownership is pinned explicitly on every insert.
  const owned = { user_id: ownerId, org_id: org };

  switch (name) {
    case "create_draft_invoice":
    case "create_draft_quote": {
      const isInvoice = name === "create_draft_invoice";
      // deno-lint-ignore no-explicit-any
      const items = (Array.isArray(input?.items) ? input.items : []).map((it: any) => ({
        description: String(it?.description ?? "").slice(0, 300),
        qty: Math.max(num(it?.qty, 1), 0.001),
        unit_price: Math.max(num(it?.unit_price), 0),
      }));
      if (!items.length) return { error: "at least one line item is required" };
      const number = draftNumber(isInvoice ? "INV" : "Q");
      const taxRate = isInvoice ? Math.min(Math.max(num(input?.tax_rate, 5), 0), 100) : 0;
      const head = {
        ...owned,
        number,
        status: "draft",
        currency: String(input?.currency ?? "AED").toUpperCase().slice(0, 3),
        customer_name: String(input?.customer_name ?? "").slice(0, 200),
        customer_email: input?.customer_email ? String(input.customer_email).slice(0, 200) : null,
        ...(isInvoice
          ? { doc_type: "invoice", tax_rate: taxRate, issue_date: new Date().toISOString().slice(0, 10) }
          : { quote_date: new Date().toISOString().slice(0, 10) }),
      };
      const table = isInvoice ? "invoice_docs" : "quotations";
      const { data: doc, error } = await client.from(table).insert(head).select("id").single();
      if (error) return { error: error.message };
      const itemTable = isInvoice ? "invoice_doc_items" : "quotation_items";
      const fk = isInvoice ? "invoice_id" : "quotation_id";
      const { error: ie } = await client.from(itemTable).insert(
        // deno-lint-ignore no-explicit-any
        items.map((it: any, i: number) => ({
          ...owned,
          [fk]: doc.id,
          description: it.description,
          qty: it.qty,
          unit_price: it.unit_price,
          position: i,
        })),
      );
      if (ie) return { error: ie.message };
      // deno-lint-ignore no-explicit-any
      const subtotal = items.reduce((s: number, it: any) => s + it.qty * it.unit_price, 0);
      const total = Math.round(subtotal * (1 + taxRate / 100) * 100) / 100;
      await logAgentAction(
        client,
        ownerId,
        name,
        `${table}:${doc.id}`,
        `${number} for ${head.customer_name} — ${head.currency} ${total}`,
      );
      return {
        created: "draft",
        number,
        total,
        currency: head.currency,
        note: "Draft saved in Filey — the owner reviews and finalizes it there.",
      };
    }

    case "create_draft_po": {
      // deno-lint-ignore no-explicit-any
      const items = (Array.isArray(input?.items) ? input.items : []).map((it: any) => ({
        description: String(it?.description ?? "").slice(0, 300),
        quantity: Math.max(num(it?.qty, 1), 0.001),
        unit_cost: Math.max(num(it?.unit_cost), 0),
      }));
      if (!items.length) return { error: "at least one line item is required" };
      const supplierName = String(input?.supplier_name ?? "").slice(0, 200);
      // Link the supplier when one matches by name (optional).
      let supplierId: number | null = null;
      try {
        const { data: sup } = await client
          .from("suppliers")
          .select("id")
          .eq("org_id", org)
          .ilike("name", `%${supplierName.replace(/[%,().]/g, " ")}%`)
          .limit(1)
          .maybeSingle();
        supplierId = sup?.id ?? null;
      } catch {
        /* optional linkage only */
      }
      const po_number = draftNumber("PO");
      // deno-lint-ignore no-explicit-any
      const total = items.reduce((s: number, it: any) => s + it.quantity * it.unit_cost, 0);
      const { data: po, error } = await client
        .from("purchase_orders")
        .insert({
          ...owned,
          po_number,
          status: "draft",
          supplier_id: supplierId,
          supplier_name: supplierName,
          currency: String(input?.currency ?? "AED").toUpperCase().slice(0, 3),
          total: Math.round(total * 100) / 100,
          order_date: new Date().toISOString().slice(0, 10),
        })
        .select("id")
        .single();
      if (error) return { error: error.message };
      const { error: ie } = await client.from("purchase_order_items").insert(
        // deno-lint-ignore no-explicit-any
        items.map((it: any, i: number) => ({ ...owned, po_id: po.id, ...it, position: i })),
      );
      if (ie) return { error: ie.message };
      await logAgentAction(
        client,
        ownerId,
        name,
        `purchase_orders:${po.id}`,
        `${po_number} to ${supplierName} — ${total}`,
      );
      return { created: "draft", number: po_number, total, note: "Draft PO saved in Filey." };
    }

    case "add_customer": {
      const row = {
        ...owned,
        name: String(input?.name ?? "").slice(0, 200),
        company: input?.company ? String(input.company).slice(0, 200) : null,
        email: input?.email ? String(input.email).slice(0, 200) : null,
        phone: input?.phone ? String(input.phone).slice(0, 50) : null,
      };
      if (!row.name) return { error: "customer name is required" };
      const { data, error } = await client.from("crm_customers").insert(row).select("id").single();
      if (error) return { error: error.message };
      await logAgentAction(client, ownerId, name, `crm_customers:${data.id}`, row.name);
      return { created: "customer", name: row.name };
    }

    case "add_product": {
      const row = {
        ...owned,
        name: String(input?.name ?? "").slice(0, 200),
        sku: input?.sku ? String(input.sku).slice(0, 80) : "",
        unit_price: Math.max(num(input?.unit_price), 0),
        cost_price: Math.max(num(input?.cost_price), 0),
        quantity: 0,
        reorder_level: Math.max(num(input?.reorder_level), 0),
      };
      if (!row.name) return { error: "product name is required" };
      const { data, error } = await client.from("products").insert(row).select("id").single();
      if (error) return { error: error.message };
      await logAgentAction(client, ownerId, name, `products:${data.id}`, row.name);
      return { created: "product", name: row.name, note: "Stock starts at 0 — receive stock in Filey." };
    }

    default:
      return { error: `unknown tool: ${name}` };
  }
}
