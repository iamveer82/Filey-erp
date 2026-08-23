// ERP data tools for the channel agent: reads + DRAFT-ONLY writes + memory.
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
//
// MEMORY: remember/recall give the agent durable, self-improving memory in
// agent_memories (see migration 2026-07-26-agent-memories.sql). Both tools
// FAIL SOFT — if the table doesn't exist yet they return { error } instead
// of breaking the reply.

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
  {
    name: "get_invoice_detail",
    description:
      "Full detail for one invoice by its exact number: status, customer, " +
      "dates, currency, every line item, plus computed subtotal / VAT / " +
      "total. Use when list_invoices isn't enough — 'what's on INV-…?'",
    input_schema: {
      type: "object",
      properties: {
        invoice_number: { type: "string", description: "Exact invoice number, e.g. INV-2026-0042." },
      },
      required: ["invoice_number"],
      additionalProperties: false,
    },
  },
  {
    name: "get_vat_summary",
    description:
      "Output vs input VAT over a period (default last 90 days), computed " +
      "from issued invoices' tax rates: output tax on sales documents, input " +
      "tax on purchase documents. Use for 'how much VAT do I owe/collect?'",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Period start YYYY-MM-DD (inclusive)." },
        to: { type: "string", description: "Period end YYYY-MM-DD (inclusive)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_expenses",
    description:
      "List recent expenses, newest first, optionally filtered by category. " +
      "Use for spending questions.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Exact category filter." },
        limit: { type: "integer", description: "Max expenses to return (default 10, max 25)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "expense_totals",
    description:
      "Total spend grouped by category over a period (default last 90 days). " +
      "Use for 'where is my money going?' style questions.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Period start YYYY-MM-DD (inclusive)." },
        to: { type: "string", description: "Period end YYYY-MM-DD (inclusive)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "stock_valuation",
    description:
      "Inventory value: sum of quantity × cost price across all products " +
      "(plus the retail value at selling prices). Use for 'what's my stock " +
      "worth?'",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
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
  {
    name: "log_expense",
    description:
      "Record a business expense in the books (category, amount, optional " +
      "note and date — defaults to today). Additive only; deleting or editing " +
      "expenses happens in Filey.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Expense category, e.g. 'fuel', 'rent'." },
        amount: { type: "number", description: "Amount spent, greater than zero." },
        description: { type: "string", description: "Optional note." },
        expense_date: { type: "string", description: "YYYY-MM-DD, defaults to today." },
      },
      required: ["category", "amount"],
      additionalProperties: false,
    },
  },
];

/** Actions with EXTERNAL effect or money-state changes (emails to customers,
 *  marking invoices paid). These are never executed directly — the tool
 *  creates a pending action and the owner must reply "APPROVE <code>" on the
 *  channel to fire it. */
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
  {
    name: "send_message",
    description:
      "Propose sending a chat message OUT to someone — a customer, a supplier, " +
      "any number or chat id — on a connected channel (whatsapp, telegram, " +
      "slack). Give either `to` (phone / chat id / slack channel) or " +
      "`customer_name` to look the number up from the CRM. This does NOT send " +
      "anything: it returns an approval code the owner must reply with " +
      "(APPROVE <code>) before the message goes out.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", enum: ["whatsapp", "telegram", "slack"] },
        to: { type: "string", description: "Phone (any format), chat id, or Slack channel." },
        customer_name: { type: "string", description: "Look the phone up from the CRM instead." },
        text: { type: "string", description: "The message body to send." },
      },
      required: ["channel", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_mark_invoice_paid",
    description:
      "Propose marking an invoice as PAID in the books. This does NOT change " +
      "anything — it returns an approval code the owner must reply with " +
      "(APPROVE <code>) before the invoice is flipped to paid. Use " +
      "list_invoices first to find the invoice number, and confirm with the " +
      "owner when they say 'invoice X is paid'.",
    input_schema: {
      type: "object",
      properties: {
        invoice_number: { type: "string", description: "Exact invoice number, e.g. INV-2026-0042." },
      },
      required: ["invoice_number"],
      additionalProperties: false,
    },
  },
  {
    name: "connect_channel",
    description:
      "Propose connecting a NEW chat channel (telegram, whatsapp or slack) so " +
      "the owner can also reach you there. Takes the credentials the owner " +
      "pasted into this conversation. This does NOT connect anything — it " +
      "returns an approval code the owner must reply with (APPROVE <code>). " +
      "After approval you hand back a PAIR code to send from the new channel, " +
      "which is what proves the new account belongs to the owner.",
    input_schema: {
      type: "object",
      properties: {
        provider: { type: "string", enum: ["telegram", "whatsapp", "slack"] },
        token: {
          type: "string",
          description:
            "Telegram: the @BotFather bot token. Slack: the xoxb- bot token. " +
            "WhatsApp: the Meta permanent access token.",
        },
        phone_number_id: {
          type: "string",
          description: "WhatsApp only: the phone number id from the Meta app.",
        },
        signing_secret: {
          type: "string",
          description: "Slack only: the app's signing secret.",
        },
      },
      required: ["provider", "token"],
      additionalProperties: false,
    },
  },
];

/** Durable agent memory — the agent's long-term memory of facts, preferences
 *  and standing instructions about this user/business (agent_memories table).
 *  Both tools fail soft with { error } when the table doesn't exist yet. */
export const MEMORY_TOOLS: ToolDef[] = [
  {
    name: "remember",
    description:
      "Save a durable fact, preference, standing instruction or correction " +
      "about this user/business to long-term memory (e.g. 'prefers AED " +
      "figures rounded', 'main supplier is Al Noor', 'never draft invoices " +
      "for customer X without asking'). Re-saving the same fact just refreshes " +
      "it. Do NOT use for one-off questions or transient data.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The fact to remember (max 500 chars)." },
        tag: {
          type: "string",
          description: "Optional short category, e.g. 'preference', 'customer', 'instruction' (max 40 chars).",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "recall",
    description:
      "Search long-term memory. Without a query, returns the 8 most recent " +
      "memories; with a query, the 8 most recent whose text or tag matches. " +
      "Use for older context that may have fallen out of the conversation.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional search term matched against memory text/tag." },
      },
      additionalProperties: false,
    },
  },
];

/** Reads + draft-writes + confirm-gated proposals + memory — the channel agent's set. */
export const ALL_TOOLS: ToolDef[] = [...TOOLS, ...WRITE_TOOLS, ...CONFIRM_TOOLS, ...MEMORY_TOOLS];

import {
  num,
  proposeConnectChannel,
  proposeMarkInvoicePaid,
  proposeSendMessage,
  proposePaymentReminder,
  recallMemories,
  rememberMemory,
  runWriteTool,
} from "./tools-writes.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;

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
  if (name === "propose_mark_invoice_paid") {
    if (!ownerId) return { error: "actions are not configured (no owner)" };
    return proposeMarkInvoicePaid(client, org, ownerId, input);
  }
  if (name === "connect_channel") {
    if (!ownerId) return { error: "actions are not configured (no owner)" };
    return proposeConnectChannel(client, ownerId, input);
  }
  if (name === "send_message") {
    if (!ownerId) return { error: "actions are not configured (no owner)" };
    return proposeSendMessage(client, org, ownerId, input);
  }

  // ---- durable memory ----
  if (name === "remember" || name === "recall") {
    if (!ownerId) return { error: "memory is not configured (no owner)" };
    return name === "remember"
      ? rememberMemory(client, org, ownerId, input)
      : recallMemories(client, ownerId, input);
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
    case "get_invoice_detail": {
      const number = String(input?.invoice_number ?? "").trim().slice(0, 60);
      if (!number) return { error: "invoice_number is required" };
      const { data: inv, error } = await client
        .from("invoice_docs")
        .select("id,number,status,currency,customer_name,customer_email,issue_date,due_date,tax_rate,discount")
        .eq("org_id", org)
        .eq("number", number)
        .maybeSingle();
      if (error) return { error: error.message };
      if (!inv) return { error: `invoice ${number} not found` };
      const { data: items, error: ie } = await client
        .from("invoice_doc_items")
        .select("description,qty,unit_price")
        .eq("invoice_id", inv.id)
        .order("position");
      if (ie) return { error: ie.message };
      // Same math the app's totals use: net lines, doc-level discount, then
      // the doc-level tax rate. There is no stored tax_amount column.
      const subtotal = r2((items ?? []).reduce((s: number, it: any) => s + num(it.qty) * num(it.unit_price), 0));
      const taxable = Math.max(subtotal - num(inv.discount), 0);
      const tax = r2((taxable * Math.max(num(inv.tax_rate), 0)) / 100);
      return {
        ...inv,
        items: items ?? [],
        subtotal,
        tax,
        total: r2(taxable + tax),
      };
    }
    case "get_vat_summary": {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.from)) ? String(input.from)
        : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const to = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.to)) ? String(input.to)
        : new Date().toISOString().slice(0, 10);
      const { data: docs, error } = await client
        .from("invoice_docs")
        .select("id,issue_date,tax_rate,doc_type")
        .eq("org_id", org)
        .neq("status", "draft")
        .gte("issue_date", date)
        .lte("issue_date", to);
      if (error) return { error: error.message };
      const ids = (docs ?? []).map((d: any) => d.id);
      const { data: items } = ids.length
        ? await client.from("invoice_doc_items").select("invoice_id,qty,unit_price").in("invoice_id", ids)
        : { data: [] };
      const netByDoc = new Map<number, number>();
      for (const it of items ?? []) {
        netByDoc.set(it.invoice_id, (netByDoc.get(it.invoice_id) ?? 0) + num(it.qty) * num(it.unit_price));
      }
      let outputNet = 0, outputTax = 0, inputNet = 0, inputTax = 0;
      for (const d of docs ?? []) {
        const net = Math.max(netByDoc.get(d.id) ?? 0, 0);
        const tax = r2((net * Math.max(num(d.tax_rate), 0)) / 100);
        if (d.doc_type === "purchase") { inputNet += net; inputTax += tax; }
        else { outputNet += net; outputTax += tax; }
      }
      return {
        from: date,
        to,
        output_tax: r2(outputTax),
        output_net: r2(outputNet),
        input_tax: r2(inputTax),
        input_net: r2(inputNet),
        net_vat: r2(outputTax - inputTax),
      };
    }
    case "list_expenses": {
      const limit = Math.min(Math.max(Number(input?.limit) || 10, 1), 25);
      let q = client
        .from("expenses")
        .select("id,category,description,amount,expense_date")
        .eq("org_id", org);
      if (input?.category) q = q.eq("category", String(input.category).trim().slice(0, 80));
      const { data, error } = await q.order("expense_date", { ascending: false }).limit(limit);
      if (error) return { error: error.message };
      return data ?? [];
    }
    case "expense_totals": {
      const from = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.from)) ? String(input.from)
        : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const to = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.to)) ? String(input.to)
        : new Date().toISOString().slice(0, 10);
      const { data, error } = await client
        .from("expenses")
        .select("category,amount")
        .eq("org_id", org)
        .gte("expense_date", from)
        .lte("expense_date", to);
      if (error) return { error: error.message };
      const byCat = new Map<string, number>();
      let total = 0;
      for (const e of data ?? []) {
        const amt = num(e.amount);
        total += amt;
        byCat.set(e.category || "—", (byCat.get(e.category || "—") ?? 0) + amt);
      }
      return {
        from,
        to,
        total: r2(total),
        by_category: [...byCat.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([category, amount]) => ({ category, amount: r2(amount) })),
      };
    }
    case "stock_valuation": {
      const { data, error } = await client
        .from("products")
        .select("sku,name,quantity,cost_price,unit_price")
        .eq("org_id", org);
      if (error) return { error: error.message };
      let costValue = 0, retailValue = 0;
      for (const p of data ?? []) {
        costValue += num(p.quantity) * num(p.cost_price);
        retailValue += num(p.quantity) * num(p.unit_price);
      }
      return {
        products: (data ?? []).length,
        cost_value: r2(costValue),
        retail_value: r2(retailValue),
        currency_note: "Amounts in the account currency (AED unless stated).",
      };
    }
    default:
      return { error: `unknown tool: ${name}` };
  }
}
