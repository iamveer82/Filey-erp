import {
  crm,
  erp,
  fin,
  billing,
  recurrences,
  followups,
  hr,
  pos,
  computeVatReturn,
  computeTrialBalance,
  computeBalanceSheet,
  computeCashSummary,
  type InvoiceDocInput,
} from "./api";
import { sendEmail, emailShell, esc } from "./email";
import { getDisplayCurrency, todayYmd } from "./format";
import { getExchangeRates, docAmountInAed } from "./exchange-rates";
import { addMemory, searchMemories } from "./aiMemory";
import { composioExecute } from "./composio";
import { findSkill, loadSkills } from "./agentSkills";
import { isToolAllowed } from "./capabilities";
import { readUrl, searchWeb, asUntrustedContext } from "./reach";
import { enrichFromWebsite, scoreLead } from "./scout";
import {
  listAccounts as listSocialAccounts,
  listPosts as listSocialPosts,
  createPost as createSocialPost,
  overLimit as overSocialLimit,
} from "./zernio";

/* Tools the BYOK copilot can call (function-calling) — Filey as a personal
 * finance agent. Reads everything; writes are creates/updates only (no deletes,
 * no settings/password — see AI_GUARDRAILS). Each write is additive and
 * reversible by the user in the UI. */

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
  /** Mutates money/inventory state or sends something outbound — must be
   * confirmed by the user before running (prompt-injection guard). */
  sensitive?: boolean;
}

/* Sensitive tools require explicit user approval before they run, so injected
 * instructions (e.g. text inside an attached document) can't silently move
 * money or send email. The UI registers a real prompt via setToolConfirm();
 * the default falls back to window.confirm, and denies if neither exists. */
type ConfirmFn = (
  toolName: string,
  args: Record<string, unknown>
) => boolean | Promise<boolean>;
let confirmTool: ConfirmFn = (name, args) => {
  if (typeof window === "undefined" || typeof window.confirm !== "function") return false;
  const detail = Object.keys(args).length ? `\n\n${JSON.stringify(args)}` : "";
  return window.confirm(`Allow the assistant to run "${name}"?${detail}`);
};
export function setToolConfirm(fn: ConfirmFn) {
  confirmTool = fn;
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const lc = (v: unknown) => str(v).toLowerCase();
const numOf = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const today = () => todayYmd();

// The file the user attached to the current chat turn (for run_file_tool).
let attachment: File | null = null;
export function setAttachment(f: File | null) {
  attachment = f;
}
export function getAttachment(): File | null {
  return attachment;
}

// Files produced by run_file_tool, surfaced as chips in the chat. The chat UI
// drains this right after each turn (blob URLs live until reload). On the
// desktop the file is already written to disk, so the chip carries a path to
// reveal rather than a URL to download.
export interface FileOutput {
  name: string;
  url?: string;
  path?: string;
}
let fileOutputs: FileOutput[] = [];
export function drainFileOutputs(): FileOutput[] {
  const out = fileOutputs;
  fileOutputs = [];
  return out;
}

async function findInvoice(numberOrId: unknown) {
  const docs = (await billing.listDocs()) as unknown as Record<string, unknown>[];
  const q = lc(numberOrId);
  return (
    docs.find((d) => lc(d.number) === q || String(d.id) === str(numberOrId)) ||
    docs.find((d) => lc(d.number).includes(q))
  );
}
async function findProduct(name: unknown) {
  const all = (await erp.products()) as unknown as Record<string, unknown>[];
  const q = lc(name);
  return all.find((p) => lc(p.name) === q) || all.find((p) => lc(p.name).includes(q));
}

/* ---------- the file toolbox ----------
 *
 * The agent used to reach the toolbox through a hand-written switch of
 * thirteen operations, while the Tools page carried eighty-eight. Every tool
 * added since was invisible to it. Both now read the same registry, so a tool
 * that exists on the page exists for the agent on the day it ships.
 *
 * Names the earlier switch accepted, kept working so saved skills and habits
 * don't break. */
export const LEGACY_OPS: Record<string, { id: string; params?: Record<string, string> }> = {
  compress_pdf: { id: "compress" },
  pdf_to_text: { id: "pdf2txt" },
  pdf_to_images: { id: "pdf2img" },
  image_to_pdf: { id: "img2pdf" },
  compress_image: { id: "img-compress" },
  convert_image_png: { id: "img-compress", params: { imgFormat: "png" } },
  convert_image_jpeg: { id: "img-compress", params: { imgFormat: "jpeg" } },
  convert_image_webp: { id: "img-compress", params: { imgFormat: "webp" } },
  rotate_pdf: { id: "rotate-custom" },
  add_page_numbers: { id: "numbers" },
  remove_metadata: { id: "remove-meta" },
  reverse_pdf: { id: "reverse" },
  pdf_info: { id: "pdf-info" },
};

const loadToolbox = async () => (await import("../components/PdfToolbox")).PDF_TOOLS;

/* Cheques, bank accounts and email templates have no table of their own: each
 * page keeps a JSON array in app_settings under one key. Reading and writing
 * them through the same key is what keeps the agent and the page looking at the
 * same list. */
async function readSettingList(key: string): Promise<Record<string, unknown>[]> {
  const { tools } = await import("./api");
  const rows = await tools.settings();
  const raw = rows.find((r) => r.key === key)?.value;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeSettingList(key: string, list: unknown[]): Promise<void> {
  const { tools } = await import("./api");
  await tools.setSetting(key, JSON.stringify(list));
}

const NAV_PAGES = [
  "overview",
  "inventory",
  "orders",
  "invoicing",
  "quoting",
  "crm",
  "customers",
  "suppliers",
  "purchase",
  "purchase-orders",
  "reports",
  "people",
  "accounting",
  "tools",
];

export const TOOLS: ToolDef[] = [
  // ---------- read ----------
  {
    name: "get_stats",
    description:
      "High-level counts: customers, products, orders, invoices, quotes, overdue invoices.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const [c, p, o, inv, q] = await Promise.all([
        crm.customers(),
        erp.products(),
        erp.orders(),
        billing.listDocs(),
        (await import("./api")).quotes.listDocs(),
      ]);
      const t = today();
      const overdue = (inv as unknown as Record<string, unknown>[]).filter(
        (d) =>
          numOf(d.balance) > 0 && d.due_date && str(d.due_date) < t && d.status !== "paid"
      ).length;
      return {
        customers: c.length,
        products: p.length,
        orders: o.length,
        invoices: inv.length,
        quotes: q.length,
        overdue_invoices: overdue,
      };
    },
  },
  {
    name: "financial_summary",
    description:
      "The business's financial position right now: assets, liabilities, equity, revenue, expenses, net profit and cash. Use this for 'how are we doing', 'what's our profit', 'how much cash do we have'.",
    parameters: { type: "object", properties: {} },
    run: async () => fin.report(),
  },
  {
    name: "vat_return",
    description:
      "The UAE VAT 201 figures for a period: standard-rated supplies and output tax, zero-rated and exempt supplies, reverse charge, recoverable input tax and the net VAT payable or refundable. Dates are YYYY-MM-DD; omit them for all time. This is a calculation from the books, not a filing — say so.",
    parameters: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
    },
    run: async (a) => {
      const [txns, invoices, company] = await Promise.all([
        fin.transactions(),
        billing.listDocs(),
        billing.getCompany(),
      ]);
      const rate = numOf(company?.default_tax_rate) || 5;
      return computeVatReturn(txns, rate, str(a.from) || undefined, str(a.to) || undefined, invoices);
    },
  },
  {
    name: "financial_statements",
    description:
      "Trial balance and balance sheet from the ledger, plus cash in/out for an optional period (YYYY-MM-DD). Use for 'are the books balanced', 'show me the balance sheet', 'how much came in last month'.",
    parameters: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
    },
    run: async (a) => {
      const [accounts, txns] = await Promise.all([fin.accounts(), fin.transactions()]);
      return {
        trial_balance: computeTrialBalance(accounts),
        balance_sheet: computeBalanceSheet(accounts),
        cash: computeCashSummary(txns, str(a.from) || undefined, str(a.to) || undefined),
      };
    },
  },
  {
    name: "receivables_aging",
    description:
      "Who owes money and for how long — outstanding invoices bucketed by how overdue they are (current, 1-30, 31-60, 61-90, 90+ days), with a per-customer total. Use for 'who owes us', 'what's overdue', 'chase the late payers'.",
    parameters: { type: "object", properties: { customer: { type: "string" } } },
    run: async (a) => {
      const [docs, rates] = (await Promise.all([
        billing.listDocs(),
        getExchangeRates().catch(() => ({})),
      ])) as unknown as [Record<string, unknown>[], Record<string, number>];
      const t = today();
      const days = (due: string) =>
        Math.floor((Date.parse(t) - Date.parse(due)) / 86_400_000);
      const bucketOf = (d: number) =>
        d <= 0 ? "current" : d <= 30 ? "1-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : "90+";
      const q = lc(a.customer);
      const buckets: Record<string, number> = {
        current: 0,
        "1-30": 0,
        "31-60": 0,
        "61-90": 0,
        "90+": 0,
      };
      const byCustomer: Record<string, number> = {};
      const items: Record<string, unknown>[] = [];
      for (const d of docs) {
        const status = lc(d.status);
        if (status === "draft" || status === "paid" || status === "cancelled") continue;
        // balance is what the doc itself reports; fall back to total less paid
        // so a document written before balances were tracked still counts.
        const due = numOf(d.balance) || numOf(d.total) - numOf(d.paid);
        if (due <= 0.005) continue;
        const name = str(d.customer_name);
        if (q && !lc(name).includes(q)) continue;
        const overdueBy = d.due_date ? days(str(d.due_date)) : 0;
        const bucket = bucketOf(overdueBy);
        // Totals are in AED at each document's own frozen rate — adding a USD
        // invoice to an AED one at face value answers the question wrongly.
        const dueAed = docAmountInAed(due, str(d.currency), numOf(d.fx_rate), rates);
        buckets[bucket] += dueAed;
        byCustomer[name] = (byCustomer[name] ?? 0) + dueAed;
        items.push({
          number: d.number,
          customer: name,
          due_date: d.due_date ?? null,
          days_overdue: Math.max(0, overdueBy),
          outstanding: due,
          currency: d.currency ?? "AED",
          outstanding_aed: dueAed,
          bucket,
        });
      }
      items.sort((x, y) => numOf(y.days_overdue) - numOf(x.days_overdue));
      return {
        currency: "AED",
        total_outstanding: Object.values(buckets).reduce((s, v) => s + v, 0),
        buckets,
        by_customer: byCustomer,
        invoices: items.slice(0, 40),
        counted: items.length,
      };
    },
  },
  {
    name: "list_transactions",
    description:
      "Ledger entries, newest first — optionally filtered by account name and date range (YYYY-MM-DD). Use to explain a balance or trace where a number came from.",
    parameters: {
      type: "object",
      properties: {
        account: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        limit: { type: "number" },
      },
    },
    run: async (a) => {
      const rows = (await fin.transactions()) as unknown as Record<string, unknown>[];
      const acct = lc(a.account);
      const from = str(a.from);
      const to = str(a.to);
      const hits = rows.filter((r) => {
        if (acct && !lc(r.account_name).includes(acct)) return false;
        const d = str(r.txn_date);
        return (!from || d >= from) && (!to || d <= to);
      });
      return {
        count: hits.length,
        transactions: hits.slice(0, Math.min(numOf(a.limit) || 50, 200)).map((r) => ({
          date: r.txn_date,
          account: r.account_name,
          type: r.txn_type,
          amount: r.amount,
          description: r.description ?? null,
          reference: r.reference ?? null,
        })),
      };
    },
  },
  {
    name: "list_expenses",
    description:
      "Recorded expenses, newest first, optionally within a date range (YYYY-MM-DD). Use for 'what did we spend on X', 'expenses last month'.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        category: { type: "string" },
        limit: { type: "number" },
      },
    },
    run: async (a) => {
      const rows = (await fin.expenses()) as unknown as Record<string, unknown>[];
      const from = str(a.from);
      const to = str(a.to);
      const cat = lc(a.category);
      const hits = rows.filter((r) => {
        const d = str(r.expense_date);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return !cat || lc(r.category).includes(cat);
      });
      return {
        count: hits.length,
        total: hits.reduce((s, r) => s + numOf(r.amount), 0),
        expenses: hits.slice(0, Math.min(numOf(a.limit) || 50, 200)).map((r) => ({
          date: r.expense_date,
          category: r.category,
          description: r.description ?? null,
          amount: r.amount,
        })),
      };
    },
  },
  {
    name: "find_customers",
    description: "Search customers by name (omit query to list recent).",
    parameters: { type: "object", properties: { query: { type: "string" } } },
    run: async ({ query }) => {
      const all = (await crm.customers()) as unknown as Record<string, unknown>[];
      const q = lc(query);
      return all
        .filter((c) => !q || lc(c.name).includes(q))
        .slice(0, 20)
        .map((c) => ({
          id: c.id,
          name: c.name,
          trn: c.trn,
          email: c.email,
          phone: c.phone,
        }));
    },
  },
  {
    name: "find_products",
    description: "Search products by name. Returns name, price and stock quantity.",
    parameters: { type: "object", properties: { query: { type: "string" } } },
    run: async ({ query }) => {
      const all = (await erp.products()) as unknown as Record<string, unknown>[];
      const q = lc(query);
      return all
        .filter((p) => !q || lc(p.name).includes(q))
        .slice(0, 30)
        .map((p) => ({
          id: p.id,
          name: p.name,
          price: p.unit_price,
          stock: p.quantity,
          sku: p.sku,
        }));
    },
  },
  {
    name: "list_invoices",
    description: "List invoices. Optional status: draft | sent | paid | overdue.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "sent", "paid", "overdue"] },
      },
    },
    run: async ({ status }) => {
      const docs = (await billing.listDocs()) as unknown as Record<string, unknown>[];
      const t = today();
      let rows = docs;
      if (status === "overdue")
        rows = docs.filter(
          (d) =>
            numOf(d.balance) > 0 &&
            d.due_date &&
            str(d.due_date) < t &&
            d.status !== "paid"
        );
      else if (status) rows = docs.filter((d) => d.status === status);
      return rows.slice(0, 30).map((d) => ({
        number: d.number,
        customer: d.customer_name,
        total: d.total,
        balance: d.balance,
        currency: d.currency,
        status: d.status,
        due: d.due_date,
      }));
    },
  },

  // ---------- create / modify ----------
  {
    name: "create_customer",
    description: "Add a new customer.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        company: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        trn: { type: "string" },
        address: { type: "string" },
      },
      required: ["name"],
    },
    run: async (a) => {
      await crm.createCustomer({
        name: str(a.name),
        company: str(a.company) || undefined,
        email: str(a.email) || undefined,
        phone: str(a.phone) || undefined,
        trn: str(a.trn) || undefined,
        address: str(a.address) || undefined,
      });
      return { ok: true, message: `Customer "${str(a.name)}" created.` };
    },
  },
  {
    name: "create_product",
    description: "Add a product to inventory.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        sku: { type: "string" },
        unit_price: { type: "number" },
        cost_price: { type: "number" },
        quantity: { type: "number" },
        reorder_level: { type: "number" },
        category: { type: "string" },
      },
      required: ["name"],
    },
    run: async (a) => {
      const name = str(a.name);
      await erp.createProduct({
        sku:
          str(a.sku) ||
          name
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, "-")
            .slice(0, 16),
        name,
        category: str(a.category) || undefined,
        unit_price: numOf(a.unit_price),
        cost_price: numOf(a.cost_price),
        quantity: numOf(a.quantity),
        reorder_level: numOf(a.reorder_level),
      });
      return { ok: true, message: `Product "${name}" added.` };
    },
  },
  {
    name: "adjust_stock",
    sensitive: true,
    description:
      "Change a product's stock. Provide either delta (e.g. -3) or set (absolute quantity).",
    parameters: {
      type: "object",
      properties: {
        product: { type: "string" },
        delta: { type: "number" },
        set: { type: "number" },
      },
      required: ["product"],
    },
    run: async (a) => {
      const p = await findProduct(a.product);
      if (!p) return { error: `No product matching "${str(a.product)}"` };
      const current = numOf(p.quantity);
      const delta = a.set != null ? numOf(a.set) - current : numOf(a.delta);
      await erp.updateStock(Number(p.id), delta);
      return { ok: true, message: `${p.name}: ${current} → ${current + delta}` };
    },
  },
  {
    name: "log_expense",
    description: "Record an expense.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string" },
        description: { type: "string" },
        amount: { type: "number" },
        date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["amount"],
    },
    run: async (a) => {
      await fin.createExpense(
        str(a.category) || "Other",
        str(a.description) || null,
        numOf(a.amount),
        str(a.date) || today(),
        null
      );
      return { ok: true, message: `Logged ${numOf(a.amount)} expense.` };
    },
  },
  {
    name: "create_invoice_draft",
    description:
      "Create a DRAFT invoice for a customer with line items (always a draft the user reviews).",
    parameters: {
      type: "object",
      properties: {
        customer_name: { type: "string" },
        currency: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              qty: { type: "number" },
              unit_price: { type: "number" },
            },
            required: ["description", "qty", "unit_price"],
          },
        },
      },
      required: ["customer_name", "items"],
    },
    run: async (args) => {
      // Not swallowed: these details carry the company's TRN onto the document,
      // and a UAE tax invoice issued without one is a compliance problem. Fail
      // loudly rather than quietly draft an invalid invoice.
      const co = await billing.getCompany();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
      const items = Array.isArray(args.items)
        ? (args.items as Record<string, unknown>[])
        : [];
      const input: InvoiceDocInput = {
        number: `DRAFT-${stamp}`,
        status: "draft",
        template: co?.default_template || "minimal",
        accent: co?.default_accent || "#FFD600",
        currency: str(args.currency) || getDisplayCurrency(),
        seller_name: co?.name || "",
        seller_address: co?.address,
        seller_trn: co?.trn,
        seller_email: co?.email,
        seller_phone: co?.phone,
        logo: co?.logo,
        customer_name: str(args.customer_name),
        issue_date: today(),
        tax_rate: co?.default_tax_rate ?? 0,
        discount: 0,
        items: items.map((it) => ({
          description: str(it.description),
          qty: numOf(it.qty) || 1,
          unit_price: numOf(it.unit_price),
        })),
      };
      await billing.saveDoc(input);
      return {
        ok: true,
        number: input.number,
        message: "Draft invoice created — open Invoicing to review/send.",
      };
    },
  },
  {
    name: "send_invoice",
    sensitive: true,
    description: "Mark an invoice as sent (by its number).",
    parameters: {
      type: "object",
      properties: { invoice_number: { type: "string" } },
      required: ["invoice_number"],
    },
    run: async (a) => {
      const d = await findInvoice(a.invoice_number);
      if (!d) return { error: `No invoice matching "${str(a.invoice_number)}"` };
      await billing.setStatus(Number(d.id), "sent");
      return { ok: true, message: `${d.number} marked sent.` };
    },
  },
  {
    name: "mark_invoice_paid",
    sensitive: true,
    description: "Mark an invoice as paid (by its number).",
    parameters: {
      type: "object",
      properties: { invoice_number: { type: "string" } },
      required: ["invoice_number"],
    },
    run: async (a) => {
      const d = await findInvoice(a.invoice_number);
      if (!d) return { error: `No invoice matching "${str(a.invoice_number)}"` };
      await billing.setStatus(Number(d.id), "paid");
      return { ok: true, message: `${d.number} marked paid.` };
    },
  },
  {
    name: "set_recurring",
    sensitive: true,
    description:
      "Make an invoice recur (by number). interval: weekly | monthly | yearly.",
    parameters: {
      type: "object",
      properties: {
        invoice_number: { type: "string" },
        interval: { type: "string", enum: ["weekly", "monthly", "yearly"] },
      },
      required: ["invoice_number"],
    },
    run: async (a) => {
      const d = await findInvoice(a.invoice_number);
      if (!d) return { error: `No invoice matching "${str(a.invoice_number)}"` };
      const interval = ["weekly", "monthly", "yearly"].includes(str(a.interval))
        ? (str(a.interval) as "weekly" | "monthly" | "yearly")
        : "monthly";
      await recurrences.create(Number(d.id), interval);
      return { ok: true, message: `${d.number} now repeats ${interval}.` };
    },
  },
  {
    name: "create_order",
    description: "Create a sales order for a customer.",
    parameters: {
      type: "object",
      properties: {
        customer_name: { type: "string" },
        total: { type: "number" },
        order_number: { type: "string" },
      },
      required: ["customer_name"],
    },
    run: async (a) => {
      const number =
        str(a.order_number) ||
        `ORD-${today().replace(/-/g, "")}-${Math.floor(Math.random() * 900 + 100)}`;
      await erp.createOrder(number, str(a.customer_name), numOf(a.total));
      return {
        ok: true,
        message: `Order ${number} created for ${str(a.customer_name)}.`,
      };
    },
  },
  {
    name: "add_reminder",
    description:
      "Add a follow-up reminder (shows in Follow-ups and notifies on the due date).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        customer_name: { type: "string" },
      },
      required: ["title"],
    },
    run: async (a) => {
      await followups.create({
        title: str(a.title),
        due_date: str(a.due_date) || today(),
        customer_name: str(a.customer_name) || undefined,
      });
      return { ok: true, message: `Reminder added: ${str(a.title)}` };
    },
  },
  {
    name: "list_file_tools",
    description:
      "List the document tools available (the same catalogue as the Tools page: PDF, image, Office, OCR, data). Call this FIRST when the user asks for something to be done to a file and no obvious tool id comes to mind — then call run_file_tool with the id. Pass `query` to narrow the list (matched against name, description and category); omit it only when you genuinely need the whole catalogue.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        category: { type: "string" },
      },
    },
    run: async (a) => {
      const all = await loadToolbox();
      const q = lc(a.query);
      const cat = lc(a.category);
      const hits = all.filter((t) => {
        if (cat && lc(t.cat) !== cat) return false;
        if (!q) return true;
        return `${t.id} ${t.name} ${t.desc} ${t.cat}`.toLowerCase().includes(q);
      });
      return {
        count: hits.length,
        of: all.length,
        tools: hits.map((t) => ({
          id: t.id,
          name: t.name,
          what: t.desc,
          category: t.cat,
          accepts: t.accept,
          // An interactive tool has no headless path — its run() deliberately
          // throws and tells the user to open the workspace. Say so here so the
          // agent offers the page instead of failing into it.
          needs_the_user: !!t.interactive,
          options: t.fields.map((f) => ({
            key: f.key,
            type: f.type,
            default: f.default,
            ...(f.options ? { choices: f.options.map((o) => o.value) } : {}),
          })),
        })),
      };
    },
  },
  {
    name: "run_file_tool",
    description:
      "Run one of the document tools on the file the user attached to this chat. `tool_id` comes from list_file_tools (e.g. 'compress', 'pdf2txt', 'merge', 'ocr-pdf', 'word2pdf', 'encrypt'). Pass that tool's options as `options`, keyed exactly as list_file_tools reports them. The result is SAVED to the user's computer — the export folder from Settings, or their desktop — and the path comes back in the result; tell the user where it went.",
    parameters: {
      type: "object",
      properties: {
        tool_id: { type: "string" },
        options: { type: "object" },
        /** Also file the result in My Files, so it lives in the app and not
         *  only on this one computer. */
        save_to_app: { type: "boolean" },
        // Accepted for older prompts that named an operation rather than an id.
        operation: { type: "string" },
        degrees: { type: "number" },
      },
    },
    run: async (a) => {
      const f = getAttachment();
      if (!f)
        return {
          error: "No file attached — ask the user to attach a PDF or image first.",
        };
      const asked = str(a.tool_id) || str(a.operation);
      const legacy = LEGACY_OPS[lc(asked)];
      const id = legacy?.id ?? lc(asked);
      const all = await loadToolbox();
      const tool = all.find((t) => t.id === id);
      if (!tool) {
        const near = all
          .filter((t) => `${t.id} ${t.name}`.toLowerCase().includes(id.slice(0, 6)))
          .slice(0, 8)
          .map((t) => t.id);
        return {
          error: `No tool with id "${asked}".`,
          did_you_mean: near,
          hint: "Call list_file_tools to see what exists.",
        };
      }

      // Options: the tool's own defaults, then anything the caller set. Values
      // reach a tool as strings — that is what the options panel hands it.
      const params: Record<string, string> = {};
      for (const fld of tool.fields) if (fld.default != null) params[fld.key] = fld.default;
      Object.assign(params, legacy?.params ?? {});
      const given = (a.options ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(given))
        if (v !== null && v !== undefined) params[k] = String(v);
      if (a.degrees !== undefined && params.degrees === undefined)
        params.degrees = String(numOf(a.degrees));

      let out: { name: string; bytes: Uint8Array }[];
      try {
        out = await tool.run([f], params);
      } catch (e) {
        // Interactive tools throw on purpose, and a real failure reads the same
        // way to the agent: report it, don't dress it up as success.
        return {
          error: e instanceof Error ? e.message : String(e),
          ...(tool.interactive
            ? { hint: `"${tool.name}" needs its workspace — use open_page with "tools".` }
            : {}),
        };
      }
      if (!out?.length) return { error: `"${tool.name}" produced no output.` };

      const { deliverFile, outputDir } = await import("./agentFiles");
      const saved = [];
      let filedInApp = 0;
      for (const o of out) {
        const d = await deliverFile(o);
        saved.push(d);
        fileOutputs.push({ name: d.name, path: d.path, url: d.url });
        if (a.save_to_app) {
          try {
            await (await import("./files")).saveOutput(o, tool.name);
            filedInApp++;
          } catch {
            /* the file is already on disk — failing to also file it is not fatal */
          }
        }
      }
      const where = await outputDir();
      const paths = saved.map((s) => s.path).filter(Boolean);
      return {
        ok: true,
        tool: tool.name,
        files: saved.map((s) => s.name),
        saved_to: paths.length ? paths : undefined,
        folder: where
          ? `${where.dir} (${where.source === "settings" ? "your export folder from Settings" : "your desktop"})`
          : undefined,
        filed_in_my_files: a.save_to_app ? filedInApp : undefined,
        message: paths.length
          ? `Saved ${saved.length} file(s) to ${where?.dir ?? "disk"}.`
          : `${saved.length} file(s) ready in the chat.`,
      };
    },
  },
  {
    name: "list_my_files",
    description:
      "Files saved in the app's My Files, newest first — optionally filtered by name. These are the user's stored documents, separate from whatever is attached to this chat.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
    },
    run: async (a) => {
      const { listFiles } = await import("./files");
      const files = await listFiles();
      const q = lc(a.query);
      const hits = files.filter((f) => !q || f.name.toLowerCase().includes(q));
      return {
        count: hits.length,
        files: hits.slice(0, Math.min(numOf(a.limit) || 25, 100)).map((f) => ({
          name: f.name,
          size_kb: Math.max(1, Math.round(f.size / 1024)),
          type: f.mime,
          made_by: f.tool ?? null,
          saved_at: new Date(f.createdAt).toISOString().slice(0, 10),
        })),
      };
    },
  },
  {
    name: "use_saved_file",
    description:
      "Pick a file out of My Files and make it the file this chat is working on, exactly as if the user had just attached it — then run_file_tool and read_attached_document act on it. Use for 'compress the quote I saved last week'. Match by name; find_it first with list_my_files if unsure.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    run: async (a) => {
      const { listFiles, fileBytes } = await import("./files");
      const q = lc(a.name);
      if (!q) return { error: "Which file? Give me its name." };
      const files = await listFiles();
      const hit =
        files.find((f) => f.name.toLowerCase() === q) ??
        files.find((f) => f.name.toLowerCase().includes(q));
      if (!hit)
        return {
          error: `No saved file matching "${str(a.name)}".`,
          hint: "Call list_my_files to see what is there.",
        };
      const bytes = await fileBytes(hit);
      if (!bytes) return { error: `Could not read "${hit.name}" back out of storage.` };
      // A File, not a Blob: the tools read .name for the output filename and
      // .type to decide whether they are looking at a PDF or an image.
      setAttachment(
        new File([bytes as BlobPart], hit.name, {
          type: hit.mime || "application/octet-stream",
        })
      );
      return {
        ok: true,
        name: hit.name,
        message: `Working on ${hit.name} from My Files.`,
      };
    },
  },
  {
    name: "read_attached_document",
    description:
      "Read the TEXT of the file the user attached to this chat, so you can act on its contents (e.g. read an invoice/receipt then create a draft). PDFs are extracted to text; images are already visible to you directly. Returns the document text (truncated for long files).",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const f = getAttachment();
      if (!f)
        return {
          error: "No file attached — ask the user to attach a PDF or image first.",
        };
      if (f.type.startsWith("image/"))
        return {
          note: "The attached image is already visible to you in this conversation — read it directly.",
        };
      const pt = await import("./pdfTools");
      const out = await pt.pdfToText(f);
      const first = Array.isArray(out) ? out[0] : out;
      if (!first?.bytes) return { error: "Could not extract text from this file." };
      const text = new TextDecoder().decode(first.bytes).trim();
      if (!text)
        return {
          note: "No selectable text found (the PDF may be scanned — use run_file_tool pdf_to_images then read it as an image).",
        };
      const LIMIT = 8000;
      return {
        text: text.length > LIMIT ? `${text.slice(0, LIMIT)}\n…[truncated]` : text,
        truncated: text.length > LIMIT,
      };
    },
  },
  {
    name: "open_page",
    description: `Navigate the app to a page so the user can act there. Pages: ${NAV_PAGES.join(", ")}. Use 'tools' for PDF/image tools.`,
    parameters: {
      type: "object",
      properties: { page: { type: "string" } },
      required: ["page"],
    },
    run: async (a) => {
      const page = lc(a.page).replace(/^\/+/, "");
      if (!NAV_PAGES.includes(page))
        return { error: `Unknown page. Choose: ${NAV_PAGES.join(", ")}` };
      if (typeof window !== "undefined") window.location.hash = `#/${page}`;
      return { ok: true, message: `Opened ${page}.` };
    },
  },
  {
    name: "list_employees",
    description: "List all employees with their status.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const emps = (await hr.employees()) as unknown as Record<string, unknown>[];
      return emps.map((e) => ({
        id: e.id,
        name: e.name,
        status: e.status,
        department: e.department,
        email: e.email,
      }));
    },
  },
  {
    name: "mark_attendance",
    description:
      "Mark an employee present or absent for today (or a specific date). status: present | absent | half_day | leave.",
    parameters: {
      type: "object",
      properties: {
        employee_name: {
          type: "string",
          description: "Employee name (partial match OK)",
        },
        status: { type: "string", enum: ["present", "absent", "half_day", "leave"] },
        date: { type: "string", description: "YYYY-MM-DD, defaults to today" },
      },
      required: ["employee_name", "status"],
    },
    run: async (a) => {
      const emps = (await hr.employees()) as unknown as Record<string, unknown>[];
      const q = lc(a.employee_name);
      const emp =
        emps.find((e) => lc(e.name) === q) || emps.find((e) => lc(e.name).includes(q));
      if (!emp) return { error: `No employee matching "${str(a.employee_name)}"` };
      await hr.markAttendance(Number(emp.id), str(a.date) || today(), str(a.status));
      return {
        ok: true,
        message: `${emp.name} marked ${str(a.status)} for ${str(a.date) || today()}.`,
      };
    },
  },
  {
    name: "create_quote",
    description:
      "Create a quotation for a customer with line items (draft — user reviews in Quoting).",
    parameters: {
      type: "object",
      properties: {
        customer_name: { type: "string" },
        currency: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              qty: { type: "number" },
              rate: { type: "number" },
            },
            required: ["description", "qty", "rate"],
          },
        },
      },
      required: ["customer_name", "items"],
    },
    run: async (args) => {
      const quoteApi = (await import("./api")).quotes;
      const items = Array.isArray(args.items)
        ? (args.items as Record<string, unknown>[])
        : [];
      const qtNo = `QT-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900000) + 100000)}`;
      await quoteApi.saveDoc({
        number: qtNo,
        status: "draft",
        template: "minimal",
        accent: "#FFD600",
        currency: str(args.currency) || getDisplayCurrency(),
        customer_name: str(args.customer_name),
        quote_date: today(),
        items: items.map((it) => ({
          product: str(it.description),
          description: str(it.description),
          qty: numOf(it.qty) || 1,
          rate: numOf(it.rate),
          discount: 0,
          tax: 0,
        })),
      });
      return {
        ok: true,
        number: qtNo,
        message: "Draft quotation created — open Quoting to review/send.",
      };
    },
  },
  {
    name: "create_purchase_order",
    description: "Create a purchase order with line items (draft).",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              qty: { type: "number" },
              unit_price: { type: "number" },
            },
            required: ["description", "qty", "unit_price"],
          },
        },
      },
      required: ["items"],
    },
    run: async (args) => {
      const items = Array.isArray(args.items)
        ? (args.items as Record<string, unknown>[])
        : [];
      const poNumber = `PO-${today().replace(/-/g, "")}-${Math.floor(Math.random() * 9000 + 1000)}`;
      await pos.save({
        po_number: poNumber,
        status: "draft",
        template: "uae",
        accent: "#222222",
        currency: "AED",
        order_date: today(),
        total: 0,
        items: items.map((it) => ({
          description: str(it.description),
          quantity: numOf(it.qty) || 1,
          unit_cost: numOf(it.unit_price),
        })),
      });
      return {
        ok: true,
        number: poNumber,
        message: `Purchase order ${poNumber} created.`,
      };
    },
  },
  {
    name: "crm_pipeline",
    description:
      "The sales pipeline: open deals by stage with values, a month-by-month forecast weighted by probability, win/loss rates, and which deals have gone quiet. Use for 'how's the pipeline', 'what will we close this quarter', 'which deals am I neglecting'.",
    parameters: { type: "object", properties: { months_ahead: { type: "number" } } },
    run: async (a) => {
      const pl = await import("./pipeline");
      const [opps, acts, tasks] = await Promise.all([
        crm.opportunities(),
        crm.activities(),
        crm.tasks(),
      ]);
      const t = today();
      const health = pl.dealHealth(opps, acts, tasks, t);
      return {
        summary: await crm.summary(),
        stages: pl.stageBreakdown(opps),
        forecast: pl.forecast(opps, t, Math.min(numOf(a.months_ahead) || 6, 12)),
        win_loss: pl.winLoss(opps),
        // Only the deals carrying a risk — a full health dump is noise the
        // model would have to filter anyway.
        needs_attention: health
          .filter((h) => h.risks.length)
          .slice(0, 15)
          .map((h) => ({
            id: h.opportunity.id,
            title: h.opportunity.title,
            customer: h.opportunity.customer_name,
            stage: h.opportunity.stage,
            value: h.opportunity.value,
            risks: h.risks,
            days_since_touched: h.daysSinceTouched,
            has_next_step: h.hasNextStep,
          })),
      };
    },
  },
  {
    name: "list_deals",
    description:
      "Open (or all) deals in the pipeline, optionally filtered by stage or by customer/title text. Stages: qualification, proposal, negotiation, won, lost.",
    parameters: {
      type: "object",
      properties: {
        stage: { type: "string" },
        query: { type: "string" },
        include_closed: { type: "boolean" },
        limit: { type: "number" },
      },
    },
    run: async (a) => {
      const all = (await crm.opportunities()) as unknown as Record<string, unknown>[];
      const stage = lc(a.stage);
      const q = lc(a.query);
      const closed = new Set(["won", "lost"]);
      const hits = all.filter((o) => {
        if (stage && lc(o.stage) !== stage) return false;
        if (!a.include_closed && !stage && closed.has(lc(o.stage))) return false;
        return !q || `${lc(o.title)} ${lc(o.customer_name)}`.includes(q);
      });
      return {
        count: hits.length,
        open_value: hits
          .filter((o) => !closed.has(lc(o.stage)))
          .reduce((s, o) => s + numOf(o.value), 0),
        deals: hits.slice(0, Math.min(numOf(a.limit) || 25, 100)).map((o) => ({
          id: o.id,
          title: o.title,
          customer: o.customer_name,
          stage: o.stage,
          value: o.value,
          probability: o.probability,
          expected_close: o.expected_close ?? null,
          owner: o.owner ?? null,
        })),
      };
    },
  },
  {
    name: "create_deal",
    description:
      "Open a deal in the pipeline for a customer. Stage defaults to qualification; the probability follows the stage automatically.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        customer_name: { type: "string" },
        value: { type: "number" },
        stage: { type: "string" },
        expected_close: { type: "string" },
        owner: { type: "string" },
      },
      required: ["title", "customer_name"],
    },
    run: async (a) => {
      const stage = lc(a.stage) || "qualification";
      const prob: Record<string, number> = {
        qualification: 20,
        proposal: 45,
        negotiation: 70,
        won: 100,
        lost: 0,
      };
      const id = await crm.createOpportunity({
        title: str(a.title),
        customer_name: str(a.customer_name),
        stage,
        value: numOf(a.value),
        probability: prob[stage] ?? 30,
        expected_close: str(a.expected_close) || undefined,
        owner: str(a.owner) || undefined,
      } as never);
      return { ok: true, id, message: `Deal "${str(a.title)}" opened at ${stage}.` };
    },
  },
  {
    name: "set_deal_stage",
    description:
      "Move a deal to another stage (qualification, proposal, negotiation, won, lost). Find the id with list_deals first. Marking a deal won or lost closes it.",
    parameters: {
      type: "object",
      properties: { deal_id: { type: "number" }, stage: { type: "string" } },
      required: ["deal_id", "stage"],
    },
    run: async (a) => {
      const stage = lc(a.stage);
      const valid = ["qualification", "proposal", "negotiation", "won", "lost"];
      if (!valid.includes(stage))
        return { error: `Stage must be one of: ${valid.join(", ")}.` };
      await crm.setOppStage(numOf(a.deal_id), stage);
      return { ok: true, message: `Deal moved to ${stage}.` };
    },
  },
  {
    name: "log_activity",
    description:
      "Record a call, meeting, email or note against a deal or customer, so the pipeline knows it was touched. kind: call | meeting | email | note | task.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string" },
        subject: { type: "string" },
        related_to: { type: "string" },
        deal_id: { type: "number" },
        due_date: { type: "string" },
      },
      required: ["kind", "subject"],
    },
    run: async (a) => {
      const id = await crm.createActivity({
        kind: lc(a.kind) || "note",
        subject: str(a.subject),
        related_to: str(a.related_to) || undefined,
        // A deal is addressed as target_type "deal" — the same wiring the
        // neglect detector reads, so a logged call actually revives a deal.
        ...(a.deal_id ? { target_type: "deal", target_id: numOf(a.deal_id) } : {}),
        due_date: str(a.due_date) || undefined,
      } as never);
      return { ok: true, id, message: "Logged." };
    },
  },
  {
    name: "list_activities",
    description:
      "Recent CRM activity — calls, meetings, emails and notes — newest first, optionally for one deal.",
    parameters: {
      type: "object",
      properties: { deal_id: { type: "number" }, limit: { type: "number" } },
    },
    run: async (a) => {
      const all = (await crm.activities()) as unknown as Record<string, unknown>[];
      const dealId = numOf(a.deal_id);
      const hits = dealId
        ? all.filter((x) => lc(x.target_type) === "deal" && numOf(x.target_id) === dealId)
        : all;
      return {
        count: hits.length,
        activities: hits.slice(0, Math.min(numOf(a.limit) || 25, 100)).map((x) => ({
          kind: x.kind,
          subject: x.subject,
          related_to: x.related_to ?? null,
          due_date: x.due_date ?? null,
          done: x.done,
          created_at: x.created_at,
        })),
      };
    },
  },
  {
    name: "find_leads",
    description:
      "Search leads by name, company or email; optionally filter by status. Use convert_lead once one turns into a real customer.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, status: { type: "string" } },
    },
    run: async (a) => {
      const all = (await crm.leads()) as unknown as Record<string, unknown>[];
      const q = lc(a.query);
      const st = lc(a.status);
      return {
        leads: all
          .filter((l) => {
            if (st && lc(l.status) !== st) return false;
            return !q || `${lc(l.name)} ${lc(l.company)} ${lc(l.email)}`.includes(q);
          })
          .slice(0, 25)
          .map((l) => ({
            id: l.id,
            name: l.name,
            company: l.company ?? null,
            email: l.email ?? null,
            phone: l.phone ?? null,
            status: l.status,
            est_value: l.est_value,
            source: l.source ?? null,
          })),
      };
    },
  },
  {
    name: "create_lead",
    description: "Add a lead to the CRM. Name is required.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        company: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        source: { type: "string" },
        est_value: { type: "number" },
      },
      required: ["name"],
    },
    run: async (a) => {
      const name = str(a.name).trim();
      if (!name) return { error: "A lead needs a name." };
      const id = await crm.createLead({
        name,
        company: str(a.company) || undefined,
        email: str(a.email) || undefined,
        phone: str(a.phone) || undefined,
        source: str(a.source) || undefined,
        est_value: numOf(a.est_value),
      } as never);
      return { ok: true, id, message: `Lead ${name} added.` };
    },
  },
  {
    name: "find_suppliers",
    description:
      "Search suppliers by name (omit query to list them all). The agent could raise a purchase order but had no way to look up who it was for.",
    parameters: { type: "object", properties: { query: { type: "string" } } },
    run: async ({ query }) => {
      const all = (await (await import("./api")).suppliers.list()) as unknown as Record<
        string,
        unknown
      >[];
      const q = lc(query);
      return all
        .filter((s) => !q || lc(s.name).includes(q))
        .slice(0, 25)
        .map((s) => ({
          id: s.id,
          name: s.name,
          contact: s.contact_person ?? null,
          email: s.email ?? null,
          phone: s.phone ?? null,
          trn: s.tax_id ?? null,
        }));
    },
  },
  {
    name: "create_supplier",
    description: "Add a supplier. Name is required; everything else is optional.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        contact_person: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        address: { type: "string" },
        tax_id: { type: "string" },
        notes: { type: "string" },
      },
      required: ["name"],
    },
    run: async (a) => {
      const name = str(a.name).trim();
      if (!name) return { error: "A supplier needs a name." };
      const { suppliers } = await import("./api");
      const id = await suppliers.create({
        name,
        contact_person: str(a.contact_person) || undefined,
        email: str(a.email) || undefined,
        phone: str(a.phone) || undefined,
        address: str(a.address) || undefined,
        tax_id: str(a.tax_id) || undefined,
        notes: str(a.notes) || undefined,
      } as never);
      return { ok: true, id, name, message: `Added ${name} to Suppliers.` };
    },
  },
  {
    name: "list_purchase_invoices",
    description:
      "Supplier bills (purchase invoices), newest first — optionally filtered by supplier name or status. Separate from sales invoices; use list_invoices for what you billed OUT.",
    parameters: {
      type: "object",
      properties: {
        supplier: { type: "string" },
        status: { type: "string" },
        limit: { type: "number" },
      },
    },
    run: async (a) => {
      const docs = (await billing.listDocs("purchase")) as unknown as Record<
        string,
        unknown
      >[];
      const sup = lc(a.supplier);
      const st = lc(a.status);
      const hits = docs.filter(
        (d) =>
          (!sup || lc(d.customer_name).includes(sup)) && (!st || lc(d.status) === st)
      );
      return {
        count: hits.length,
        bills: hits.slice(0, Math.min(numOf(a.limit) || 25, 100)).map((d) => ({
          number: d.number,
          supplier: d.customer_name,
          status: d.status,
          total: d.total,
          outstanding: numOf(d.balance) || numOf(d.total) - numOf(d.paid),
          issue_date: d.issue_date ?? null,
          due_date: d.due_date ?? null,
        })),
      };
    },
  },
  {
    name: "create_purchase_invoice_draft",
    description:
      "Record a supplier bill as a DRAFT the user reviews. Use after reading an attached supplier invoice, or when the user dictates one. Finalising it (which receives stock and posts to Payables) stays a human decision.",
    parameters: {
      type: "object",
      properties: {
        supplier_name: { type: "string" },
        currency: { type: "string" },
        issue_date: { type: "string" },
        due_date: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              qty: { type: "number" },
              unit_price: { type: "number" },
            },
            required: ["description", "qty", "unit_price"],
          },
        },
      },
      required: ["supplier_name", "items"],
    },
    run: async (a) => {
      const co = await billing.getCompany();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
      const items = Array.isArray(a.items) ? (a.items as Record<string, unknown>[]) : [];
      if (!items.length) return { error: "A bill needs at least one line." };
      const input = {
        number: `BILL-${stamp}`,
        status: "draft",
        // doc_type is what separates a supplier bill from a sales invoice —
        // without it the bill lands in Invoicing as money owed TO the company.
        doc_type: "purchase",
        template: co?.default_template || "minimal",
        accent: co?.default_accent || "#FFD600",
        currency: str(a.currency) || getDisplayCurrency(),
        seller_name: co?.name || "",
        seller_trn: co?.trn,
        customer_name: str(a.supplier_name),
        issue_date: str(a.issue_date) || today(),
        due_date: str(a.due_date) || undefined,
        tax_rate: co?.default_tax_rate ?? 0,
        discount: 0,
        items: items.map((it) => ({
          description: str(it.description),
          qty: numOf(it.qty) || 1,
          unit_price: numOf(it.unit_price),
        })),
      } as unknown as InvoiceDocInput;
      await billing.saveDoc(input);
      return {
        ok: true,
        number: input.number,
        message: "Draft bill recorded — open Purchase Invoices to review it.",
      };
    },
  },
  {
    name: "payables_aging",
    description:
      "What the business owes and for how long — unpaid supplier bills bucketed by how overdue they are, with a per-supplier total. The mirror of receivables_aging.",
    parameters: { type: "object", properties: { supplier: { type: "string" } } },
    run: async (a) => {
      const [docs, rates] = (await Promise.all([
        billing.listDocs("purchase"),
        getExchangeRates().catch(() => ({})),
      ])) as unknown as [Record<string, unknown>[], Record<string, number>];
      const t = today();
      const bucketOf = (d: number) =>
        d <= 0 ? "current" : d <= 30 ? "1-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : "90+";
      const q = lc(a.supplier);
      const buckets: Record<string, number> = {
        current: 0,
        "1-30": 0,
        "31-60": 0,
        "61-90": 0,
        "90+": 0,
      };
      const bySupplier: Record<string, number> = {};
      const items: Record<string, unknown>[] = [];
      for (const d of docs) {
        const status = lc(d.status);
        if (status === "draft" || status === "paid" || status === "cancelled") continue;
        const owed = numOf(d.balance) || numOf(d.total) - numOf(d.paid);
        if (owed <= 0.005) continue;
        const name = str(d.customer_name);
        if (q && !lc(name).includes(q)) continue;
        const late = d.due_date
          ? Math.floor((Date.parse(t) - Date.parse(str(d.due_date))) / 86_400_000)
          : 0;
        const bucket = bucketOf(late);
        const owedAed = docAmountInAed(owed, str(d.currency), numOf(d.fx_rate), rates);
        buckets[bucket] += owedAed;
        bySupplier[name] = (bySupplier[name] ?? 0) + owedAed;
        items.push({
          number: d.number,
          supplier: name,
          due_date: d.due_date ?? null,
          days_overdue: Math.max(0, late),
          outstanding: owed,
          currency: d.currency ?? "AED",
          outstanding_aed: owedAed,
          bucket,
        });
      }
      items.sort((x, y) => numOf(y.days_overdue) - numOf(x.days_overdue));
      return {
        currency: "AED",
        total_owed: Object.values(buckets).reduce((s, v) => s + v, 0),
        buckets,
        by_supplier: bySupplier,
        bills: items.slice(0, 40),
        counted: items.length,
      };
    },
  },
  {
    name: "list_payment_receipts",
    description:
      "Payment receipts issued to customers, newest first — optionally filtered by customer name.",
    parameters: {
      type: "object",
      properties: { customer: { type: "string" }, limit: { type: "number" } },
    },
    run: async (a) => {
      const rows = (await (await import("./api")).receipts.list()) as unknown as Record<
        string,
        unknown
      >[];
      const q = lc(a.customer);
      const hits = rows.filter((r) => !q || lc(r.customer_name).includes(q));
      return {
        count: hits.length,
        total: hits.reduce((s, r) => s + numOf(r.amount), 0),
        receipts: hits.slice(0, Math.min(numOf(a.limit) || 25, 100)).map((r) => ({
          number: r.number,
          customer: r.customer_name,
          amount: r.amount,
          method: r.payment_method ?? null,
          date: r.payment_date ?? null,
          status: r.status,
        })),
      };
    },
  },
  {
    name: "create_payment_receipt",
    description:
      "Issue a payment receipt to a customer for money received. Amount and customer are required; method is e.g. cash, bank transfer, cheque, card.",
    parameters: {
      type: "object",
      properties: {
        customer_name: { type: "string" },
        amount: { type: "number" },
        payment_method: { type: "string" },
        payment_date: { type: "string" },
        for_description: { type: "string" },
        ref_number: { type: "string" },
      },
      required: ["customer_name", "amount"],
    },
    run: async (a) => {
      const amount = numOf(a.amount);
      if (amount <= 0) return { error: "A receipt needs an amount greater than zero." };
      const [co, { receipts }] = await Promise.all([billing.getCompany(), import("./api")]);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
      const number = `RCPT-${stamp}`;
      await receipts.save({
        number,
        status: "issued",
        template: co?.default_template || "minimal",
        accent: co?.default_accent || "#FFD600",
        currency: getDisplayCurrency(),
        seller_name: co?.name || "",
        seller_trn: co?.trn,
        customer_name: str(a.customer_name),
        issue_date: str(a.payment_date) || today(),
        amount,
        payment_method: str(a.payment_method) || undefined,
        ref_number: str(a.ref_number) || undefined,
        for_description: str(a.for_description) || undefined,
      } as never);
      return {
        ok: true,
        number,
        amount,
        message: `Receipt ${number} issued — open Payment Receipts to print or send it.`,
      };
    },
  },
  {
    name: "list_payroll",
    description:
      "Payroll runs, newest first — who was paid, for which period, and whether it has been marked paid. Filter by period (e.g. 2026-07) or employee name.",
    parameters: {
      type: "object",
      properties: {
        period: { type: "string" },
        employee: { type: "string" },
        limit: { type: "number" },
      },
    },
    run: async (a) => {
      const rows = (await hr.payroll()) as unknown as Record<string, unknown>[];
      const period = lc(a.period);
      const emp = lc(a.employee);
      const hits = rows.filter(
        (r) =>
          (!period || lc(r.period).includes(period)) &&
          (!emp || lc(r.employee_name).includes(emp))
      );
      return {
        count: hits.length,
        total_net: hits.reduce((s, r) => s + numOf(r.net_pay), 0),
        runs: hits.slice(0, Math.min(numOf(a.limit) || 25, 100)).map((r) => ({
          employee: r.employee_name,
          period: r.period,
          basic: r.basic,
          allowances: r.allowances,
          deductions: r.deductions,
          net_pay: r.net_pay,
          status: r.status,
        })),
      };
    },
  },
  {
    name: "run_payroll",
    sensitive: true,
    description:
      "Create a payroll run for one employee and period (e.g. 2026-07). Net pay is basic + allowances - deductions. This posts a salary liability, so it always asks the user first.",
    parameters: {
      type: "object",
      properties: {
        employee_name: { type: "string" },
        period: { type: "string" },
        basic: { type: "number" },
        allowances: { type: "number" },
        deductions: { type: "number" },
      },
      required: ["employee_name", "period", "basic"],
    },
    run: async (a) => {
      const staff = (await hr.employees()) as unknown as Record<string, unknown>[];
      const q = lc(a.employee_name);
      const who = staff.find((e) => lc(e.name) === q) ?? staff.find((e) => lc(e.name).includes(q));
      if (!who) return { error: `No employee matching "${str(a.employee_name)}".` };
      const basic = numOf(a.basic);
      const allow = numOf(a.allowances);
      const ded = numOf(a.deductions);
      await hr.runPayroll(numOf(who.id), str(a.period), basic, allow, ded);
      return {
        ok: true,
        employee: who.name,
        period: str(a.period),
        net_pay: basic + allow - ded,
        message: "Payroll run created — mark it paid in People once the money leaves.",
      };
    },
  },
  {
    name: "generate_wps_file",
    description:
      "Build the UAE WPS salary file (SIF) for a period and save it to the user's computer, from the company's MOL establishment ID and bank code plus each active employee's labour card, IBAN and salary. Dates are YYYY-MM-DD. If anything required is missing it reports exactly what, rather than writing a file the bank will reject.",
    parameters: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    },
    run: async (a) => {
      const [{ buildSif, validateWps }, company, staff] = await Promise.all([
        import("./wps"),
        billing.getCompany(),
        hr.employees(),
      ]);
      const from = str(a.from);
      const to = str(a.to);
      const days = Math.max(
        1,
        Math.min(31, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1)
      );
      // Leavers on the file get it rejected, so only active staff are paid.
      const active = (staff as unknown as Record<string, unknown>[]).filter(
        (e) => (str(e.status) || "active") === "active"
      );
      const input = {
        employer: {
          molEstablishmentId: str(company?.mol_establishment_id),
          bankCode: str(company?.wps_bank_code),
        },
        employees: active.map((e) => ({
          name: str(e.name),
          labourCardNo: str(e.labour_card_no),
          iban: str(e.iban),
          bankCode: str(e.bank_routing_code),
          fixedAmount: numOf(e.salary),
          daysInPeriod: days,
        })),
        periodStart: from,
        periodEnd: to,
      };
      const problems = validateWps(input as never);
      if (problems.length)
        return {
          error: "The salary file isn't valid yet.",
          problems,
          hint: "Employee identifiers live on each person's record; the employer ones are in Company Details.",
        };
      const file = buildSif(input as never);
      const { deliverFile, outputDir } = await import("./agentFiles");
      const bytes = new TextEncoder().encode(file.content);
      const saved = await deliverFile({ name: file.filename, bytes });
      fileOutputs.push({ name: saved.name, path: saved.path, url: saved.url });
      const where = await outputDir();
      return {
        ok: true,
        file: file.filename,
        employees: file.employeeCount,
        total: file.totalAmount,
        saved_to: saved.path,
        folder: where?.dir,
        message: `WPS file for ${file.employeeCount} employee(s) saved.`,
      };
    },
  },
  {
    name: "list_campaigns",
    description:
      "Marketing campaigns with their status and audience. Sending is done from the Marketing page — bulk email is never fired from chat.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const rows = (await crm.campaigns()) as unknown as Record<string, unknown>[];
      return {
        count: rows.length,
        campaigns: rows.slice(0, 40).map((c) => ({
          id: c.id,
          name: c.name,
          subject: c.subject ?? null,
          status: c.status,
          sent: c.sent_count ?? 0,
          created_at: c.created_at,
        })),
      };
    },
  },
  {
    name: "create_campaign",
    description:
      "Draft a marketing campaign — name, subject and body. Merge fields like {{name}} and {{company}} are filled per recipient. It is created as a draft; the user picks the audience and sends it from the Marketing page.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["name", "subject", "body"],
    },
    run: async (a) => {
      const id = await crm.createCampaign({
        name: str(a.name),
        subject: str(a.subject),
        body: str(a.body),
        status: "draft",
      } as never);
      return {
        ok: true,
        id,
        message: `Campaign "${str(a.name)}" drafted — open Marketing to choose who gets it and send.`,
      };
    },
  },
  {
    name: "list_cheques",
    description:
      "The cheque register — issued and received cheques with their due dates and status (pending, cleared, bounced, cancelled). Use for 'which cheques clear this week', 'any bounced cheques'.",
    parameters: {
      type: "object",
      properties: { status: { type: "string" }, type: { type: "string" } },
    },
    run: async (a) => {
      const list = await readSettingList("cheque_register");
      const st = lc(a.status);
      const kind = lc(a.type);
      const hits = list.filter(
        (c) => (!st || lc(c.status) === st) && (!kind || lc(c.type) === kind)
      );
      return {
        count: hits.length,
        pending_total: hits
          .filter((c) => lc(c.status) === "pending")
          .reduce((s, c) => s + numOf(c.amount), 0),
        cheques: hits.slice(0, 50).map((c) => ({
          cheque_no: c.cheque_no,
          type: c.type,
          party: c.party,
          bank: c.bank,
          amount: c.amount,
          due_date: c.due_date,
          status: c.status,
        })),
      };
    },
  },
  {
    name: "record_cheque",
    description:
      "Add a cheque to the register. type is 'issued' (you wrote it) or 'received' (you were given it). Status starts pending.",
    parameters: {
      type: "object",
      properties: {
        cheque_no: { type: "string" },
        type: { type: "string" },
        party: { type: "string" },
        bank: { type: "string" },
        amount: { type: "number" },
        issue_date: { type: "string" },
        due_date: { type: "string" },
        notes: { type: "string" },
      },
      required: ["cheque_no", "type", "party", "amount"],
    },
    run: async (a) => {
      const kind = lc(a.type);
      if (kind !== "issued" && kind !== "received")
        return { error: "type must be 'issued' or 'received'." };
      const list = await readSettingList("cheque_register");
      const row = {
        id: Date.now(),
        cheque_no: str(a.cheque_no),
        type: kind,
        party: str(a.party),
        bank: str(a.bank),
        amount: numOf(a.amount),
        issue_date: str(a.issue_date) || today(),
        due_date: str(a.due_date) || str(a.issue_date) || today(),
        status: "pending",
        notes: str(a.notes),
        created_at: new Date().toISOString(),
      };
      await writeSettingList("cheque_register", [row, ...list]);
      return { ok: true, cheque_no: row.cheque_no, message: "Cheque recorded." };
    },
  },
  {
    name: "list_bank_accounts",
    description:
      "The company's bank accounts with their balances, so you can answer 'which account has the money' or quote an IBAN onto a document.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const list = await readSettingList("bank_accounts");
      return {
        count: list.length,
        total_balance: list.reduce((s, b) => s + numOf(b.current_balance), 0),
        accounts: list.map((b) => ({
          bank: b.bank_name,
          account_name: b.account_name,
          account_number: b.account_number,
          iban: b.iban,
          currency: b.currency,
          balance: b.current_balance,
        })),
      };
    },
  },
  {
    name: "list_email_templates",
    description:
      "Saved email templates — name, category and subject, plus the body so you can reuse the company's own wording instead of inventing it.",
    parameters: { type: "object", properties: { query: { type: "string" } } },
    run: async (a) => {
      const list = await readSettingList("email_templates");
      const q = lc(a.query);
      return {
        count: list.length,
        templates: list
          .filter((t) => !q || `${lc(t.name)} ${lc(t.category)} ${lc(t.subject)}`.includes(q))
          .slice(0, 25)
          .map((t) => ({
            name: t.name,
            category: t.category,
            subject: t.subject,
            body: str(t.body).slice(0, 1200),
          })),
      };
    },
  },
  {
    name: "email_invoice",
    sensitive: true,
    description:
      "Email an invoice to its customer (requires email configured in Settings).",
    parameters: {
      type: "object",
      properties: { invoice_number: { type: "string" } },
      required: ["invoice_number"],
    },
    run: async (a) => {
      const d = await findInvoice(a.invoice_number);
      if (!d) return { error: `No invoice matching "${str(a.invoice_number)}"` };
      // Fetch full doc to get customer_email. Keep the summary as a fallback,
      // but remember a failed lookup: reporting "no email on file" when the
      // read simply failed sends the user off to fix a record that is fine.
      let full: Record<string, unknown> | null = null;
      let lookupFailed = false;
      try {
        full = (await billing.getDoc(Number(d.id))) as unknown as Record<
          string,
          unknown
        > | null;
      } catch {
        lookupFailed = true;
      }
      const email = str(full?.customer_email) || str((d as any).customer_email);
      if (!email)
        return {
          error: lookupFailed
            ? "Could not load that invoice to find the customer's email — try again."
            : "This invoice has no customer email on file. Add an email to the customer record first.",
        };
      const body = `<p>Your invoice <strong>${esc(d.number)}</strong> for ${esc(d.currency || "AED")} ${numOf(d.total)} is ready.</p>`;
      await sendEmail({
        to: email,
        subject: `Invoice ${d.number} from Filey`,
        html: emailShell(`Invoice ${d.number}`, body),
      });
      return { ok: true, message: `Invoice ${d.number} emailed to ${email}.` };
    },
  },
  {
    name: "get_attendance_today",
    description: "Show today's attendance — who's present, absent, on leave.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const records = (await hr.attendance()) as unknown as Record<string, unknown>[];
      const t = today();
      const todayRecords = records.filter((r) => str(r.date) === t);
      return {
        date: t,
        total: todayRecords.length,
        breakdown: {
          present: todayRecords.filter((r) => r.status === "present").length,
          absent: todayRecords.filter((r) => r.status === "absent").length,
          half_day: todayRecords.filter((r) => r.status === "half_day").length,
          leave: todayRecords.filter((r) => r.status === "leave").length,
        },
        records: todayRecords.map((r) => ({
          employee: r.employee_name,
          status: r.status,
          check_in: r.check_in,
          check_out: r.check_out,
        })),
      };
    },
  },

  // ---------- memory (learn across chats) ----------
  {
    name: "remember",
    description:
      "Save a durable fact, preference, or standing instruction about this user/business to long-term memory so you recall it in future chats (e.g. 'VAT is 5%', 'always CC accounts@acme.com', 'main supplier is Acme Trading', 'prefers concise replies'). Use it whenever the user tells you how they work or shares a lasting detail. NEVER store secrets, passwords, or API keys.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The fact to remember." },
        tag: {
          type: "string",
          description: "Optional short bucket, e.g. preference, customer, tax.",
        },
      },
      required: ["text"],
    },
    run: async (a) => {
      const m = addMemory(str(a.text), str(a.tag) || undefined);
      return { ok: true, message: `Remembered: ${m.text}` };
    },
  },
  {
    name: "recall",
    description:
      "Search your long-term memory for facts/preferences you saved earlier. Omit query to list the most recent memories.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
    },
    run: async (a) => {
      const hits = searchMemories(str(a.query) || undefined, 10);
      return { memories: hits.map((m) => ({ text: m.text, tag: m.tag })) };
    },
  },

  // ---------- messaging via Composio (connect in Settings → Integrations) ----------
  {
    name: "send_gmail",
    sensitive: true,
    description:
      "Send an email from the user's connected Gmail via Composio. Requires Gmail connected in Settings → Integrations. Args: recipient_email, subject, body.",
    parameters: {
      type: "object",
      properties: {
        recipient_email: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["recipient_email", "subject", "body"],
    },
    run: async (a) =>
      composioExecute("GMAIL_SEND_EMAIL", {
        recipient_email: str(a.recipient_email),
        subject: str(a.subject),
        body: str(a.body),
      }),
  },
  {
    name: "list_connected_apps",
    description:
      "The third-party apps this user has actually connected (Gmail, Slack, HubSpot, Notion, Sheets, whatever they linked) and the actions available on each. Call this BEFORE composio_run instead of guessing a slug — the catalogue is the user's, not a fixed list, so what exists here changes per customer. Pass `app` to narrow to one toolkit.",
    parameters: {
      type: "object",
      properties: { app: { type: "string" }, limit: { type: "number" } },
    },
    run: async (a) => {
      const { composioList, composioTools } = await import("./composio");
      const conns = await composioList();
      const connected = (conns.items ?? [])
        .filter((c) => (c.status ?? "").toUpperCase() === "ACTIVE")
        .map((c) => c.toolkit?.slug)
        .filter(Boolean) as string[];
      if (!connected.length)
        return {
          connected: [],
          hint: "Nothing is connected yet — the user links apps in Settings → Integrations.",
        };
      const want = lc(a.app);
      const slugs = want ? connected.filter((s) => s.includes(want)) : connected;
      const tools = await composioTools(
        slugs.join(","),
        Math.min(numOf(a.limit) || 40, 100)
      );
      return {
        connected: [...new Set(connected)],
        actions: (tools.items ?? []).map((t) => ({
          slug: t.slug,
          app: t.toolkit?.slug,
          what: t.description,
          arguments: t.input_parameters ?? undefined,
        })),
      };
    },
  },
  {
    name: "composio_run",
    sensitive: true,
    description:
      "Run one of the user's connected app actions by its exact slug, with an arguments object. Get the slug from list_connected_apps — do not guess it. Reaches whatever they linked: send a Gmail, post to Slack, add a HubSpot contact, append a row to Sheets.",
    parameters: {
      type: "object",
      properties: {
        tool_slug: { type: "string" },
        arguments: { type: "object" },
      },
      required: ["tool_slug"],
    },
    run: async (a) =>
      composioExecute(str(a.tool_slug), (a.arguments as Record<string, unknown>) || {}),
  },

  // ---------- skills (reusable procedures, loaded on demand) ----------
  {
    name: "list_skills",
    description:
      "List the user's saved skills (reusable procedures/workflows) with their descriptions.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const on = loadSkills().filter((s) => s.enabled);
      return { skills: on.map((s) => ({ name: s.name, description: s.description })) };
    },
  },
  {
    name: "use_skill",
    description:
      "Load the full instructions for a saved skill by name, then follow them for the current task.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    run: async (a) => {
      const s = findSkill(str(a.name));
      if (!s)
        return {
          error: `No skill named "${str(a.name)}". Use list_skills to see what's available.`,
        };
      return { name: s.name, instructions: s.instructions };
    },
  },

  /* ── Web reach ──────────────────────────────────────────────────────────
   * Reading is not "sensitive" in the confirm-before-running sense — it moves
   * no money and sends nothing out — but what comes back is attacker-writable
   * text, so it is returned wrapped as untrusted quoted material. */
  {
    name: "read_web_page",
    description:
      "Read a public web page and return its text — a supplier's site, a tender notice, a customer's contact page. Use it when the answer is not in the books.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "Full http(s) URL" } },
      required: ["url"],
    },
    run: async (a) => {
      const page = await readUrl(str(a.url));
      return {
        url: page.url,
        title: page.title,
        truncated: page.truncated,
        content: asUntrustedContext(page.url, page.text),
      };
    },
  },
  {
    name: "search_web",
    description:
      "Search the public web and return the top results with titles, URLs and snippets. Follow up with read_web_page for the full text of one.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", description: "Max results, default 5" },
      },
      required: ["query"],
    },
    run: async (a) => {
      const { hits } = await searchWeb(str(a.query), {
        limit: Math.min(10, numOf(a.limit) || 5),
      });
      return { results: hits };
    },
  },
  {
    name: "enrich_company_website",
    description:
      "Read a company's own website and return the contact details, address and TRN it publishes there. Returns the source URL — always show it to the user before saving anything.",
    parameters: {
      type: "object",
      properties: {
        website: { type: "string", description: "Domain or full URL" },
      },
      required: ["website"],
    },
    run: async (a) => enrichFromWebsite(str(a.website)),
  },
  {
    name: "score_lead",
    description:
      "Rank a customer or lead 0-100 from their trading history, with the reasons. Offline and deterministic — pass what you know from the books.",
    parameters: {
      type: "object",
      properties: {
        invoices: { type: "number" },
        revenue: { type: "number" },
        overdue: { type: "number" },
        days_since_activity: { type: "number" },
        has_email: { type: "boolean" },
        has_phone: { type: "boolean" },
        has_trn: { type: "boolean" },
      },
    },
    run: async (a) =>
      scoreLead({
        invoices: numOf(a.invoices),
        revenue: numOf(a.revenue),
        overdue: numOf(a.overdue),
        daysSinceActivity:
          a.days_since_activity == null ? undefined : numOf(a.days_since_activity),
        hasEmail: !!a.has_email,
        hasPhone: !!a.has_phone,
        hasTrn: !!a.has_trn,
      }),
  },

  /* ── Social publishing (Zernio) ─────────────────────────────────────────
   * Reading which accounts exist is harmless. Posting is not: it is public,
   * outbound and effectively permanent, so schedule_social_post is marked
   * sensitive and goes through the same confirm gate as sending money. */
  {
    name: "list_social_accounts",
    description:
      "List the social accounts connected through Zernio, with their platform and handle. Call this before posting so you can name the right account IDs.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const accounts = await listSocialAccounts();
      return {
        accounts: accounts.map((a) => ({
          id: a.id,
          platform: a.platform,
          handle: a.username || a.displayName || "",
          status: a.status,
        })),
      };
    },
  },
  {
    name: "schedule_social_post",
    description:
      "Publish or schedule a post to named social accounts. Get the account IDs from list_social_accounts first — never guess them. Omit scheduled_at to post immediately.",
    sensitive: true,
    parameters: {
      type: "object",
      properties: {
        account_ids: {
          type: "array",
          items: { type: "string" },
          description: "Account IDs from list_social_accounts",
        },
        content: { type: "string" },
        media_urls: { type: "array", items: { type: "string" } },
        scheduled_at: {
          type: "string",
          description: "ISO 8601 timestamp; omit to publish now",
        },
      },
      required: ["account_ids", "content"],
    },
    run: async (a) => {
      const ids = Array.isArray(a.account_ids) ? a.account_ids.map(str) : [];
      const content = str(a.content);
      // Check the caption against each platform's limit here rather than
      // letting the platform truncate it silently.
      const accounts = await listSocialAccounts();
      const chosen = accounts.filter((x) => ids.includes(x.id));
      const unknown = ids.filter((id) => !accounts.some((x) => x.id === id));
      if (unknown.length)
        return { error: `No connected account with id ${unknown.join(", ")}.` };
      const tooLong = overSocialLimit(content, chosen);
      if (tooLong.length)
        return {
          error: tooLong
            .map((t) => `${t.platform} allows ${t.limit} characters, this is ${t.over} over`)
            .join("; "),
        };
      const post = await createSocialPost({
        accountIds: ids,
        content,
        mediaUrls: Array.isArray(a.media_urls) ? a.media_urls.map(str) : undefined,
        scheduledAt: str(a.scheduled_at) || undefined,
      });
      return { id: post.id, status: post.status, scheduled_at: post.scheduledAt };
    },
  },
  {
    name: "list_social_posts",
    description: "List recent and scheduled social posts with their status.",
    parameters: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
    run: async (a) => {
      const posts = await listSocialPosts(Math.min(50, numOf(a.limit) || 20));
      return {
        posts: posts.map((p) => ({
          id: p.id,
          status: p.status,
          scheduled_at: p.scheduledAt,
          published_at: p.publishedAt,
          content: (p.content ?? "").slice(0, 200),
          error: p.error,
        })),
      };
    },
  },
];

export async function runTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  if (!isToolAllowed(name))
    return {
      error: `The "${name}" capability is turned off (Settings → Capabilities). Ask the user to enable it.`,
    };
  if (tool.sensitive && !(await confirmTool(name, args)))
    return { error: "Cancelled — the user did not approve this action." };
  try {
    return await tool.run(args);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
