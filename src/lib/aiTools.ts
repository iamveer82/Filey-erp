import { crm, erp, billing, type InvoiceDocInput } from "./api";
import { getDisplayCurrency } from "./format";

/* Tools the BYOK copilot can call (function-calling). Read tools are safe;
 * the one write tool only creates a DRAFT invoice the user reviews. Nothing
 * here touches settings, passwords or deletes anything (see AI_GUARDRAILS). */

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const lc = (v: unknown) => str(v).toLowerCase();
const numOf = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

export const TOOLS: ToolDef[] = [
  {
    name: "get_stats",
    description: "High-level counts: customers, products, orders, invoices, quotes, and how many invoices are overdue.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const [c, p, o, inv, q] = await Promise.all([
        crm.customers().catch(() => []),
        erp.products().catch(() => []),
        erp.orders().catch(() => []),
        billing.listDocs().catch(() => []),
        (await import("./api")).quotes.listDocs().catch(() => []),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      const overdue = (inv as Record<string, unknown>[]).filter(
        (d) => numOf(d.balance) > 0 && d.due_date && str(d.due_date) < today && d.status !== "paid"
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
    name: "find_customers",
    description: "Search the user's customers by name. Omit query to list recent customers.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "name fragment" } },
    },
    run: async ({ query }) => {
      const all = (await crm.customers().catch(() => [])) as Record<string, unknown>[];
      const q = lc(query);
      return all
        .filter((c) => !q || lc(c.name).includes(q))
        .slice(0, 20)
        .map((c) => ({ name: c.name, trn: c.trn, email: c.email, phone: c.phone, address: c.address }));
    },
  },
  {
    name: "find_products",
    description: "Search products by name. Returns name, price and stock.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "name fragment" } },
    },
    run: async ({ query }) => {
      const all = (await erp.products().catch(() => [])) as Record<string, unknown>[];
      const q = lc(query);
      return all
        .filter((p) => !q || lc(p.name).includes(q))
        .slice(0, 30)
        .map((p) => ({ name: p.name, price: p.price ?? p.unit_price, stock: p.stock }));
    },
  },
  {
    name: "list_invoices",
    description: "List invoices. Optional status filter: draft | sent | paid | overdue.",
    parameters: {
      type: "object",
      properties: { status: { type: "string", enum: ["draft", "sent", "paid", "overdue"] } },
    },
    run: async ({ status }) => {
      const docs = (await billing.listDocs().catch(() => [])) as Record<string, unknown>[];
      const today = new Date().toISOString().slice(0, 10);
      let rows = docs;
      if (status === "overdue")
        rows = docs.filter(
          (d) => numOf(d.balance) > 0 && d.due_date && str(d.due_date) < today && d.status !== "paid"
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
  {
    name: "create_invoice_draft",
    description:
      "Create a DRAFT invoice for a customer with line items. It is always a draft the user reviews before sending. Returns the new invoice number.",
    parameters: {
      type: "object",
      properties: {
        customer_name: { type: "string" },
        currency: { type: "string", description: "ISO code, optional" },
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
      const co = await billing.getCompany().catch(() => null);
      const today = new Date().toISOString().slice(0, 10);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
      const items = Array.isArray(args.items) ? (args.items as Record<string, unknown>[]) : [];
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
        issue_date: today,
        tax_rate: co?.default_tax_rate ?? 0,
        discount: 0,
        items: items.map((it) => ({
          description: str(it.description),
          qty: numOf(it.qty) || 1,
          unit_price: numOf(it.unit_price),
        })),
      };
      await billing.saveDoc(input);
      return { ok: true, number: input.number, message: "Draft invoice created — open Invoicing to review." };
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
