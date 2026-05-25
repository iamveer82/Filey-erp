import { crm, erp, fin, billing, recurrences, followups, type InvoiceDocInput } from "./api";
import { getDisplayCurrency } from "./format";

/* Tools the BYOK copilot can call (function-calling) — Filey as a personal
 * finance agent. Reads everything; writes are creates/updates only (no deletes,
 * no settings/password — see AI_GUARDRAILS). Each write is additive and
 * reversible by the user in the UI. */

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const lc = (v: unknown) => str(v).toLowerCase();
const numOf = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const today = () => new Date().toISOString().slice(0, 10);

// The file the user attached to the current chat turn (for run_file_tool).
let attachment: File | null = null;
export function setAttachment(f: File | null) {
  attachment = f;
}
export function getAttachment(): File | null {
  return attachment;
}

async function findInvoice(numberOrId: unknown) {
  const docs = (await billing.listDocs().catch(() => [])) as Record<string, unknown>[];
  const q = lc(numberOrId);
  return (
    docs.find((d) => lc(d.number) === q || String(d.id) === str(numberOrId)) ||
    docs.find((d) => lc(d.number).includes(q))
  );
}
async function findProduct(name: unknown) {
  const all = (await erp.products().catch(() => [])) as Record<string, unknown>[];
  const q = lc(name);
  return all.find((p) => lc(p.name) === q) || all.find((p) => lc(p.name).includes(q));
}

const NAV_PAGES = [
  "overview", "inventory", "orders", "invoicing", "quoting", "crm",
  "customers", "suppliers", "purchase", "purchase-orders", "reports",
  "people", "accounting", "tools",
];

export const TOOLS: ToolDef[] = [
  // ---------- read ----------
  {
    name: "get_stats",
    description: "High-level counts: customers, products, orders, invoices, quotes, overdue invoices.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const [c, p, o, inv, q] = await Promise.all([
        crm.customers().catch(() => []),
        erp.products().catch(() => []),
        erp.orders().catch(() => []),
        billing.listDocs().catch(() => []),
        (await import("./api")).quotes.listDocs().catch(() => []),
      ]);
      const t = today();
      const overdue = (inv as Record<string, unknown>[]).filter(
        (d) => numOf(d.balance) > 0 && d.due_date && str(d.due_date) < t && d.status !== "paid"
      ).length;
      return { customers: c.length, products: p.length, orders: o.length, invoices: inv.length, quotes: q.length, overdue_invoices: overdue };
    },
  },
  {
    name: "find_customers",
    description: "Search customers by name (omit query to list recent).",
    parameters: { type: "object", properties: { query: { type: "string" } } },
    run: async ({ query }) => {
      const all = (await crm.customers().catch(() => [])) as Record<string, unknown>[];
      const q = lc(query);
      return all.filter((c) => !q || lc(c.name).includes(q)).slice(0, 20)
        .map((c) => ({ id: c.id, name: c.name, trn: c.trn, email: c.email, phone: c.phone }));
    },
  },
  {
    name: "find_products",
    description: "Search products by name. Returns name, price and stock quantity.",
    parameters: { type: "object", properties: { query: { type: "string" } } },
    run: async ({ query }) => {
      const all = (await erp.products().catch(() => [])) as Record<string, unknown>[];
      const q = lc(query);
      return all.filter((p) => !q || lc(p.name).includes(q)).slice(0, 30)
        .map((p) => ({ id: p.id, name: p.name, price: p.unit_price, stock: p.quantity, sku: p.sku }));
    },
  },
  {
    name: "list_invoices",
    description: "List invoices. Optional status: draft | sent | paid | overdue.",
    parameters: { type: "object", properties: { status: { type: "string", enum: ["draft", "sent", "paid", "overdue"] } } },
    run: async ({ status }) => {
      const docs = (await billing.listDocs().catch(() => [])) as Record<string, unknown>[];
      const t = today();
      let rows = docs;
      if (status === "overdue") rows = docs.filter((d) => numOf(d.balance) > 0 && d.due_date && str(d.due_date) < t && d.status !== "paid");
      else if (status) rows = docs.filter((d) => d.status === status);
      return rows.slice(0, 30).map((d) => ({ number: d.number, customer: d.customer_name, total: d.total, balance: d.balance, currency: d.currency, status: d.status, due: d.due_date }));
    },
  },

  // ---------- create / modify ----------
  {
    name: "create_customer",
    description: "Add a new customer.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" }, company: { type: "string" }, email: { type: "string" },
        phone: { type: "string" }, trn: { type: "string" }, address: { type: "string" },
      },
      required: ["name"],
    },
    run: async (a) => {
      await crm.createCustomer({
        name: str(a.name), company: str(a.company) || undefined, email: str(a.email) || undefined,
        phone: str(a.phone) || undefined, trn: str(a.trn) || undefined, address: str(a.address) || undefined,
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
        name: { type: "string" }, sku: { type: "string" }, unit_price: { type: "number" },
        cost_price: { type: "number" }, quantity: { type: "number" },
        reorder_level: { type: "number" }, category: { type: "string" },
      },
      required: ["name"],
    },
    run: async (a) => {
      const name = str(a.name);
      await erp.createProduct({
        sku: str(a.sku) || name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 16),
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
    description: "Change a product's stock. Provide either delta (e.g. -3) or set (absolute quantity).",
    parameters: {
      type: "object",
      properties: { product: { type: "string" }, delta: { type: "number" }, set: { type: "number" } },
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
        category: { type: "string" }, description: { type: "string" },
        amount: { type: "number" }, date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["amount"],
    },
    run: async (a) => {
      await fin.createExpense(str(a.category) || "Other", str(a.description) || null, numOf(a.amount), str(a.date) || today(), null);
      return { ok: true, message: `Logged ${numOf(a.amount)} expense.` };
    },
  },
  {
    name: "create_invoice_draft",
    description: "Create a DRAFT invoice for a customer with line items (always a draft the user reviews).",
    parameters: {
      type: "object",
      properties: {
        customer_name: { type: "string" },
        currency: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { description: { type: "string" }, qty: { type: "number" }, unit_price: { type: "number" } },
            required: ["description", "qty", "unit_price"],
          },
        },
      },
      required: ["customer_name", "items"],
    },
    run: async (args) => {
      const co = await billing.getCompany().catch(() => null);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
      const items = Array.isArray(args.items) ? (args.items as Record<string, unknown>[]) : [];
      const input: InvoiceDocInput = {
        number: `DRAFT-${stamp}`, status: "draft",
        template: co?.default_template || "minimal", accent: co?.default_accent || "#FFD600",
        currency: str(args.currency) || getDisplayCurrency(),
        seller_name: co?.name || "", seller_address: co?.address, seller_trn: co?.trn,
        seller_email: co?.email, seller_phone: co?.phone, logo: co?.logo,
        customer_name: str(args.customer_name), issue_date: today(),
        tax_rate: co?.default_tax_rate ?? 0, discount: 0,
        items: items.map((it) => ({ description: str(it.description), qty: numOf(it.qty) || 1, unit_price: numOf(it.unit_price) })),
      };
      await billing.saveDoc(input);
      return { ok: true, number: input.number, message: "Draft invoice created — open Invoicing to review/send." };
    },
  },
  {
    name: "send_invoice",
    description: "Mark an invoice as sent (by its number).",
    parameters: { type: "object", properties: { invoice_number: { type: "string" } }, required: ["invoice_number"] },
    run: async (a) => {
      const d = await findInvoice(a.invoice_number);
      if (!d) return { error: `No invoice matching "${str(a.invoice_number)}"` };
      await billing.setStatus(Number(d.id), "sent");
      return { ok: true, message: `${d.number} marked sent.` };
    },
  },
  {
    name: "mark_invoice_paid",
    description: "Mark an invoice as paid (by its number).",
    parameters: { type: "object", properties: { invoice_number: { type: "string" } }, required: ["invoice_number"] },
    run: async (a) => {
      const d = await findInvoice(a.invoice_number);
      if (!d) return { error: `No invoice matching "${str(a.invoice_number)}"` };
      await billing.setStatus(Number(d.id), "paid");
      return { ok: true, message: `${d.number} marked paid.` };
    },
  },
  {
    name: "set_recurring",
    description: "Make an invoice recur (by number). interval: weekly | monthly | yearly.",
    parameters: {
      type: "object",
      properties: { invoice_number: { type: "string" }, interval: { type: "string", enum: ["weekly", "monthly", "yearly"] } },
      required: ["invoice_number"],
    },
    run: async (a) => {
      const d = await findInvoice(a.invoice_number);
      if (!d) return { error: `No invoice matching "${str(a.invoice_number)}"` };
      const interval = ["weekly", "monthly", "yearly"].includes(str(a.interval)) ? (str(a.interval) as "weekly" | "monthly" | "yearly") : "monthly";
      await recurrences.create(Number(d.id), interval);
      return { ok: true, message: `${d.number} now repeats ${interval}.` };
    },
  },
  {
    name: "create_order",
    description: "Create a sales order for a customer.",
    parameters: {
      type: "object",
      properties: { customer_name: { type: "string" }, total: { type: "number" }, order_number: { type: "string" } },
      required: ["customer_name"],
    },
    run: async (a) => {
      const number =
        str(a.order_number) ||
        `ORD-${today().replace(/-/g, "")}-${Math.floor(Math.random() * 900 + 100)}`;
      await erp.createOrder(number, str(a.customer_name), numOf(a.total));
      return { ok: true, message: `Order ${number} created for ${str(a.customer_name)}.` };
    },
  },
  {
    name: "add_reminder",
    description: "Add a follow-up reminder (shows in Follow-ups and notifies on the due date).",
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
    name: "run_file_tool",
    description:
      "Run a PDF/image operation on the file the user attached to this chat; the result downloads to their device. operation ∈ compress_pdf | pdf_to_text | pdf_to_images | image_to_pdf | compress_image | convert_image_png | convert_image_jpeg | convert_image_webp | rotate_pdf | add_page_numbers | remove_metadata | reverse_pdf | pdf_info.",
    parameters: {
      type: "object",
      properties: { operation: { type: "string" }, degrees: { type: "number" } },
      required: ["operation"],
    },
    run: async (a) => {
      const f = getAttachment();
      if (!f) return { error: "No file attached — ask the user to attach a PDF or image first." };
      const op = lc(a.operation);
      const pt = await import("./pdfTools");
      type Out = { name: string; bytes: Uint8Array };
      let out: Out | Out[];
      switch (op) {
        case "compress_pdf": out = await pt.compressPdf(f); break;
        case "pdf_to_text": out = await pt.pdfToText(f); break;
        case "pdf_to_images": out = await pt.pdfToImages(f); break;
        case "image_to_pdf": out = await pt.imagesToPdf([f]); break;
        case "compress_image": out = await pt.compressImage(f); break;
        case "convert_image_png": out = await pt.compressImage(f, "png"); break;
        case "convert_image_jpeg": out = await pt.compressImage(f, "jpeg"); break;
        case "convert_image_webp": out = await pt.compressImage(f, "webp"); break;
        case "rotate_pdf": out = await pt.rotatePdf(f, numOf(a.degrees) || 90); break;
        case "add_page_numbers": out = await pt.addPageNumbers(f); break;
        case "remove_metadata": out = await pt.removeMetadata(f); break;
        case "reverse_pdf": out = await pt.reversePdf(f); break;
        case "pdf_info": out = await pt.pdfInfo(f); break;
        default: return { error: `Unknown operation: ${op}` };
      }
      const list = Array.isArray(out) ? out : [out];
      for (const o of list) pt.downloadFile(o);
      return { ok: true, downloaded: list.map((o) => o.name), message: `Done — ${list.length} file(s) downloaded.` };
    },
  },
  {
    name: "open_page",
    description: `Navigate the app to a page so the user can act there. Pages: ${NAV_PAGES.join(", ")}. Use 'tools' for PDF/image tools.`,
    parameters: { type: "object", properties: { page: { type: "string" } }, required: ["page"] },
    run: async (a) => {
      const page = lc(a.page).replace(/^\/+/, "");
      if (!NAV_PAGES.includes(page)) return { error: `Unknown page. Choose: ${NAV_PAGES.join(", ")}` };
      if (typeof window !== "undefined") window.location.hash = `#/${page}`;
      return { ok: true, message: `Opened ${page}.` };
    },
  },
];

export async function runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    return await tool.run(args);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
