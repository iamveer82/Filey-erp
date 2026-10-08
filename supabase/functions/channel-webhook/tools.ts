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
      "overdue they are). Amount reports return by_currency groups; never add " +
      "different currencies or rank customers across currencies without conversion. " +
      "Use for analytical questions — trends, who buys most, " +
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
        invoice_number: { type: "string", maxLength: 160, description: "Exact complete invoice number (up to 160 characters), e.g. INV-2026-0042." },
      },
      required: ["invoice_number"],
      additionalProperties: false,
    },
  },
  {
    name: "get_vat_summary",
    description:
      "Output vs input VAT over a period (default last 90 days), computed " +
      "using issued invoice calculations: output tax on sales documents, input " +
      "tax on purchase documents. Returns by_currency groups without currency " +
      "conversion; subtracts credit notes. Use for 'how much VAT do I owe/collect?'",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", format: "date", description: "Period start YYYY-MM-DD (inclusive)." },
        to: { type: "string", format: "date", description: "Period end YYYY-MM-DD (inclusive)." },
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
        from: { type: "string", format: "date", description: "Period start YYYY-MM-DD (inclusive)." },
        to: { type: "string", format: "date", description: "Period end YYYY-MM-DD (inclusive)." },
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
      qty: { type: "number", minimum: 0.001, description: "Quantity (default 1)." },
      unit_price: { type: "number", minimum: 0, description: "Unit price in the document currency." },
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
      "exists. The draft is never sent automatically. Keep physical qty, unit and unit_price unchanged. " +
      "For T.Liters pricing, use custom_columns [{key:'liters',label:'T.Liters'}], each line custom {liters:'1000'}, and price_by:'liters'; amount is liters × unit_price, not qty × unit_price. " +
      "Manual amounts and per-line formula overrides need Filey AI in the app; never flatten or omit requested calculation fields.",
    input_schema: {
      type: "object",
      properties: {
        customer_name: { type: "string", description: "Customer or company name." },
        customer_email: { type: "string", description: "Customer email, if known." },
        items: { ...LINE_ITEM_SCHEMA, items: {
          ...LINE_ITEM_SCHEMA.items, properties: {
            ...LINE_ITEM_SCHEMA.items.properties,
            unit: { type: "string", description: "Keep the user's physical unit, such as L, drum or carton." },
            custom: { type: "object", additionalProperties: { type: "string" }, description: "Values by custom column key; e.g. {liters:'1000'}. Active pricing values must be non-negative decimal text without separators." },
          },
        } },
        custom_columns: { type: "array", maxItems: 12, items: {
          type: "object", properties: {
            key: { type: "string", description: `Unique letters/digits/underscore key beginning with a letter, at most 40 characters. Cannot use built-in or metadata keys: ${[...RESERVED_ITEM_COLUMNS].join(", ")}.` },
            label: { type: "string", description: `Visible heading, such as T.Liters, up to 80 characters. Cannot reuse built-in headings: ${[...DEFAULT_COLUMN_LABELS].join(", ")}.` },
          }, required: ["key", "label"], additionalProperties: false,
        } },
        price_by: { type: "string", description: "Custom column key multiplied by unchanged unit_price. Omit for qty × unit_price." },
        currency: { type: "string", description: "3-letter currency; defaults to the saved company currency." },
        tax_rate: { type: "number", minimum: 0, maximum: 100, multipleOf: 0.001, description: "VAT %, at most three decimals; defaults to the saved company tax setting." },
        issue_date: { type: "string", format: "date", description: "Preserve the requested invoice date as YYYY-MM-DD. Defaults to today only when omitted." },
        due_date: { anyOf: [{ type: "string", format: "date" }, { type: "string", enum: [""] }], description: "Requested due date, YYYY-MM-DD; omit or use empty text for none." },
        notes: { type: "string", description: "Invoice notes, preserved as supplied, up to 4096 characters." },
        terms: { type: "string", description: "Payment/delivery terms, preserved as supplied, up to 4096 characters." },
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
              qty: { type: "number", minimum: 0.001, description: "Quantity (default 1)." },
              unit_cost: { type: "number", minimum: 0, description: "Unit cost." },
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
        expense_date: { type: "string", format: "date", description: "YYYY-MM-DD, defaults to today." },
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
        invoice_number: { type: "string", maxLength: 160, description: "Exact complete invoice number (up to 160 characters), e.g. INV-2026-0042." },
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
        app_secret: { type: "string", description: "WhatsApp only: Meta app secret, required to verify incoming webhook signatures." },
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
        replace_id: { type: "string", description: "When the user corrects a saved fact, use its id from recall to replace the outdated memory." },
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
      "memories; with a query, the 8 most relevant whose text or tag matches. " +
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
  proposeSendMessage,
  proposePaymentReminder,
  recallMemories,
  rememberMemory,
  runWriteTool,
} from "./tools-writes.ts";
import type { InboundMsg } from "./parse.ts";
import { storedDocTotals, sanitizeCustomColumns, RESERVED_ITEM_COLUMNS, DEFAULT_COLUMN_LABELS, type DocItem, type DocCustomColumn } from "../_shared/docItems.ts";
import { applyRoundOff, isCreditNote, POSTED_INVOICE_STATUSES, r2 } from "../_shared/money.ts";

type StoredItem = Omit<DocItem, "description"> & { description?: string; invoice_id?: number | string };
type StoredDocument = {
  id?: number | string; currency?: string; discount?: number; tax_rate?: number;
  unit_price_formula?: { a: string; b?: string } | null; round_off?: boolean;
  invoice_type_code?: string | null;
};

function documentAmounts(doc: StoredDocument, items: StoredItem[]) {
  const totals = applyRoundOff(storedDocTotals(items, num(doc.discount), num(doc.tax_rate), doc.unit_price_formula), doc.round_off);
  return { ...totals, net: r2(totals.total - totals.tax), sign: isCreditNote(doc.invoice_type_code) ? -1 : 1 };
}

const documentCurrency = (doc: StoredDocument) => String(doc.currency ?? "").trim().toUpperCase() || "AED";

function linesByDocument(items: StoredItem[]): Map<string, StoredItem[]> {
  const lines = new Map<string, StoredItem[]>();
  for (const item of items) {
    const key = String(item.invoice_id);
    const group = lines.get(key) ?? [];
    group.push(item);
    lines.set(key, group);
  }
  return lines;
}

/** Keep model context bounded without passing broken, sliced JSON as facts. */
export function boundedToolResult(result: unknown): string {
  const text = JSON.stringify(result ?? { error: "No result was returned." });
  return text.length <= 6000 ? text : JSON.stringify({
    truncated: true, data_preview: text.slice(0, 2800),
    note: "This is only a preview. Do not infer missing records or totals; narrow the lookup.",
  });
}

/** The provider's JSON schema is guidance, not validation at this boundary. */
export function validateToolInput(value: unknown, schema: Record<string, unknown>, path = "input"): string | null {
  const invalid = (reason: string) => `Invalid tool input: ${path} ${reason}.`;
  if (Array.isArray(schema.anyOf)) return schema.anyOf.some(option => !validateToolInput(value, option, path))
    ? null : invalid("does not match the supported field formats");
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("must be an object");
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const key of (schema.required ?? []) as string[]) {
      if (object[key] === undefined || (typeof object[key] === "string" && !String(object[key]).trim())) return invalid(`requires ${key}`);
    }
    for (const [key, child] of Object.entries(object)) {
      const extra = schema.additionalProperties;
      const childSchema = Object.hasOwn(properties, key) ? properties[key]
        : extra && typeof extra === "object" ? extra as Record<string, unknown> : undefined;
      if (!childSchema) return invalid("contains an unsupported field");
      const error = validateToolInput(child, childSchema, `${path}.${key}`);
      if (error) return error;
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < Number(schema.minItems ?? 0) || value.length > Number(schema.maxItems ?? 30)) return invalid("has an invalid number of items");
    for (let i = 0; i < value.length; i++) {
      const error = validateToolInput(value[i], schema.items as Record<string, unknown>, `${path}[${i}]`);
      if (error) return error;
    }
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e9 || (schema.type === "integer" && !Number.isInteger(value))) return invalid("must be a finite number");
    if (schema.minimum !== undefined && value < Number(schema.minimum)) return invalid("is below the allowed minimum");
  } else if (schema.type === "string") {
    if (typeof value !== "string" || value.length > 4096) return invalid("must be text within 4,096 characters");
    if (path.endsWith(".currency") && !/^[A-Za-z]{3}$/.test(value)) return invalid("must be a 3-letter currency code");
    if (schema.format === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) return invalid("must be a real calendar date");
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return invalid("has an unsupported value");
  return null;
}

export async function runTool(
  // deno-lint-ignore no-explicit-any
  client: any,
  orgId: string,
  name: string,
  // deno-lint-ignore no-explicit-any
  input: any,
  /** Required for write tools: the account the rows belong to. */
  ownerId?: string,
  source?: Pick<InboundMsg, "channel" | "externalId">,
  /** One map per user task; never reuse it across messages. */
  receipts?: Map<string, Promise<unknown>>,
): Promise<unknown> {
  const org = String(orgId);
  if (!org.trim()) return { error: "Workspace is not configured." };
  const definition = ALL_TOOLS.find((tool) => tool.name === name);
  if (!definition) return { error: `unknown tool: ${name}` };
  // This connection cannot represent manual/per-line overrides. Stop
  // before allocation instead of coaching a model to remove those fields.
  if (name === "create_draft_invoice" && input && typeof input === "object" &&
      ("unit_price_formula" in input ||
       Array.isArray(input.items) && input.items.some((item: unknown) => item && typeof item === "object" &&
         (["calcMode", "amount", "itemFormula"].some(key => key in item) ||
          "custom" in item && item.custom && typeof item.custom === "object" && Object.keys(item.custom).some(key => key.startsWith("__")))))) return {
    error: "This hosted chat connection cannot preserve manual amounts or per-line formula overrides. Use Filey AI in the app. Your quantities and rates have not been changed; no invoice was saved.",
    code: "unsupported_invoice_calculation", retry_safe: false,
  };
  const invalid = validateToolInput(input, definition.input_schema);
  if (invalid) return { error: invalid };
  if (name === "create_draft_invoice" && input.tax_rate !== undefined &&
      (input.tax_rate > 100 || Number(input.tax_rate.toFixed(3)) !== input.tax_rate)) return {
    error: "Invoice tax rate must be from 0 to 100 with at most three decimal places. No invoice was saved; the requested rate has not been rounded.",
    code: "invalid_arguments",
  };
  if (name === "create_draft_invoice" && Array.isArray(input.custom_columns)) {
    const columns = input.custom_columns as DocCustomColumn[];
    if (sanitizeCustomColumns(columns).length !== columns.length ||
        columns.some(column => !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(column.key) || !column.label.trim() || column.label.length > 80) ||
        new Set(columns.map(column => column.key)).size !== columns.length) return {
      error: "Invoice custom columns must have unique keys and headings that do not replace built-in or calculation fields. Keep the requested values; choose a different heading/key. No invoice was saved.",
      code: "invalid_arguments",
    };
  }

  // A model may repeat a successful write while continuing its tool loop.
  // Reuse its receipt, including an in-flight write, within this task only.
  // Different inputs/owners/conversations and later user tasks stay distinct.
  const mutation = async (execute: () => Promise<unknown>): Promise<unknown> => {
    if (!receipts) return execute();
    const key = JSON.stringify([org, ownerId, source ?? null, name, input], (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
        : value);
    const previous = receipts.get(key);
    if (previous) return previous;
    const pending = execute();
    receipts.set(key, pending);
    try {
      const result = await pending;
      // Known validation/lookup errors can be corrected after another tool.
      // An uncertain save must keep its receipt and stop the caller's loop.
      if (result && typeof result === "object" && "error" in result &&
          !("code" in result && result.code === "unconfirmed_write")) receipts.delete(key);
      return result;
    } catch (error) {
      receipts.delete(key);
      throw error;
    }
  };

  // ---- draft-only writes ----
  if (WRITE_TOOLS.some((t) => t.name === name)) {
    if (!ownerId) return { error: "writes are not configured (no owner)" };
    return mutation(() => runWriteTool(client, org, ownerId, name, input));
  }

  // ---- confirm-gated proposals ----
  if (name === "request_payment_reminder") {
    if (!ownerId) return { error: "actions are not configured (no owner)" };
    return mutation(() => proposePaymentReminder(client, org, ownerId, input, source));
  }
  if (name === "connect_channel") {
    if (!ownerId) return { error: "actions are not configured (no owner)" };
    return mutation(() => proposeConnectChannel(client, ownerId, input, source));
  }
  if (name === "send_message") {
    if (!ownerId) return { error: "actions are not configured (no owner)" };
    return mutation(() => proposeSendMessage(client, org, ownerId, input, source));
  }

  // ---- durable memory ----
  if (name === "remember" || name === "recall") {
    if (!ownerId) return { error: "memory is not configured (no owner)" };
    return name === "remember"
      ? rememberMemory(client, org, ownerId, input)
      : recallMemories(client, org, ownerId, input);
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
          .select("issue_date,status,doc_type,id,currency,tax_rate,discount,unit_price_formula,round_off,invoice_type_code")
          .eq("org_id", org)
          .in("status", [...POSTED_INVOICE_STATUSES])
          .gte("issue_date", since);
        if (error) return { error: error.message };
        // Totals need items; keep it cheap: count invoices per month + fetch totals per doc set.
        // deno-lint-ignore no-explicit-any
        const sales = (data ?? []).filter((d: any) => d.doc_type !== "purchase");
        // deno-lint-ignore no-explicit-any
        const ids = sales.map((d: any) => d.id);
        const { data: items, error: itemError } = ids.length
          ? await client.from("invoice_doc_items").select("invoice_id,qty,unit_price,custom,tax_category").eq("org_id", org).in("invoice_id", ids)
          : { data: [], error: null };
        if (itemError) return { error: "Invoice line details could not be loaded. No totals were calculated." };
        const byDoc = linesByDocument(items ?? []);
        const byCurrency = new Map<string, Record<string, { invoices: number; total: number }>>();
        for (const d of sales) {
          const mo = String(d.issue_date ?? "").slice(0, 7);
          if (!mo) continue;
          const currency = documentCurrency(d), byMonth = byCurrency.get(currency) ?? {};
          const amounts = documentAmounts(d, byDoc.get(String(d.id)) ?? []);
          byMonth[mo] ??= { invoices: 0, total: 0 };
          byMonth[mo].invoices++;
          byMonth[mo].total = r2(byMonth[mo].total + amounts.sign * amounts.total);
          byCurrency.set(currency, byMonth);
        }
        return { by_currency: [...byCurrency].map(([currency, months]) => ({ currency, months })) };
      }
      if (report === "top_customers") {
        const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
        const { data, error } = await client
          .from("invoice_docs")
          .select("id,customer_name,doc_type,status,issue_date,currency,tax_rate,discount,unit_price_formula,round_off,invoice_type_code")
          .eq("org_id", org)
          .in("status", [...POSTED_INVOICE_STATUSES])
          .gte("issue_date", since);
        if (error) return { error: error.message };
        // deno-lint-ignore no-explicit-any
        const sales = (data ?? []).filter((d: any) => d.doc_type !== "purchase");
        // deno-lint-ignore no-explicit-any
        const ids = sales.map((d: any) => d.id);
        const { data: items, error: itemError } = ids.length
          ? await client.from("invoice_doc_items").select("invoice_id,qty,unit_price,custom,tax_category").eq("org_id", org).in("invoice_id", ids)
          : { data: [], error: null };
        if (itemError) return { error: "Invoice line details could not be loaded. No totals were calculated." };
        const byDoc = linesByDocument(items ?? []);
        const byCurrency = new Map<string, Map<string, number>>();
        for (const d of sales) {
          const c = d.customer_name || "—";
          const currency = documentCurrency(d), byCustomer = byCurrency.get(currency) ?? new Map<string, number>();
          const amounts = documentAmounts(d, byDoc.get(String(d.id)) ?? []);
          byCustomer.set(c, r2((byCustomer.get(c) ?? 0) + amounts.sign * amounts.total));
          byCurrency.set(currency, byCustomer);
        }
        return { by_currency: [...byCurrency].map(([currency, customers]) => ({ currency,
          customers: [...customers].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([customer, total]) => ({ customer, total })),
        })) };
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
      const number = String(input?.invoice_number ?? "").trim();
      if (!number) return { error: "invoice_number is required" };
      // deno-lint-ignore no-control-regex
      if (number.length > 160 || /[\u0000-\u001f\u007f]/.test(number)) return { error: "Use the complete saved invoice number, up to 160 characters without control characters." };
      const { data: inv, error } = await client
        .from("invoice_docs")
        .select("id,number,status,currency,customer_name,customer_email,issue_date,due_date,tax_rate,discount,unit_price_formula,round_off,invoice_type_code")
        .eq("org_id", org)
        .eq("number", number)
        .maybeSingle();
      if (error) return { error: error.message };
      if (!inv) return { error: `invoice ${number} not found` };
      const { data: items, error: ie } = await client
        .from("invoice_doc_items")
        .select("description,qty,unit_price,custom,tax_category")
        .eq("org_id", org)
        .eq("invoice_id", inv.id)
        .order("position");
      if (ie) return { error: ie.message };
      const amounts = documentAmounts(inv, items ?? []);
      return {
        ...inv,
        items: items ?? [],
        currency: documentCurrency(inv),
        subtotal: amounts.subtotal,
        applied_discount: amounts.discount,
        net: amounts.net,
        tax: amounts.tax,
        total: amounts.total,
        round_off_adjustment: amounts.round_off,
        is_credit_note: amounts.sign < 0,
      };
    }
    case "get_vat_summary": {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.from)) ? String(input.from)
        : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const to = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.to)) ? String(input.to)
        : new Date().toISOString().slice(0, 10);
      const { data: docs, error } = await client
        .from("invoice_docs")
        .select("id,issue_date,tax_rate,discount,unit_price_formula,round_off,invoice_type_code,doc_type,currency")
        .eq("org_id", org)
        .in("status", [...POSTED_INVOICE_STATUSES])
        .gte("issue_date", date)
        .lte("issue_date", to);
      if (error) return { error: error.message };
      const ids = (docs ?? []).map((d: StoredDocument) => d.id);
      const { data: items, error: itemError } = ids.length
        ? await client.from("invoice_doc_items").select("invoice_id,qty,unit_price,custom,tax_category").eq("org_id", org).in("invoice_id", ids)
        : { data: [], error: null };
      if (itemError) return { error: "Invoice line details could not be loaded. No VAT totals were calculated." };
      const byDoc = linesByDocument(items ?? []);
      const byCurrency = new Map<string, { output_net: number; output_tax: number; input_net: number; input_tax: number }>();
      for (const d of docs ?? []) {
        const amounts = documentAmounts(d, byDoc.get(String(d.id)) ?? []);
        const net = amounts.sign * amounts.net, tax = amounts.sign * amounts.tax;
        const currency = documentCurrency(d), totals = byCurrency.get(currency) ?? { output_net: 0, output_tax: 0, input_net: 0, input_tax: 0 };
        if (d.doc_type === "purchase") { totals.input_net += net; totals.input_tax += tax; }
        else { totals.output_net += net; totals.output_tax += tax; }
        byCurrency.set(currency, totals);
      }
      return {
        from: date,
        to,
        by_currency: [...byCurrency].map(([currency, totals]) => ({ currency,
          output_net: r2(totals.output_net), output_tax: r2(totals.output_tax),
          input_net: r2(totals.input_net), input_tax: r2(totals.input_tax),
          net_vat: r2(totals.output_tax - totals.input_tax),
        })),
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
