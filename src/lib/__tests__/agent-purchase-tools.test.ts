import { beforeEach, describe, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { billing } from "../api";
import { TOOLS } from "../aiTools";

// A supplier bill and a sales invoice live in the same table, told apart only
// by doc_type. Get that wrong and money the company OWES shows up in Invoicing
// as money it is OWED — so the split is worth pinning down.
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});

const tool = (name: string) => {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`${name} is not registered`);
  return t;
};

const ymdAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

describe("supplier bills", () => {
  it("records a draft bill that stays out of the sales ledger", async () => {
    const res = (await tool("create_purchase_invoice_draft").run({
      supplier_name: "Gulf Paper Co",
      items: [{ description: "A4 boxes", qty: 10, unit_price: 25 }],
    })) as { ok: boolean; number: string };
    expect(res.ok).toBe(true);

    const purchases = await billing.listDocs("purchase");
    const sales = await billing.listDocs("sales");
    expect(purchases.map((d) => d.number)).toContain(res.number);
    expect(sales.map((d) => d.number)).not.toContain(res.number);
  });

  it("lists bills separately from invoices", async () => {
    await tool("create_purchase_invoice_draft").run({
      supplier_name: "Gulf Paper Co",
      items: [{ description: "ink", qty: 1, unit_price: 40 }],
    });
    const listed = (await tool("list_purchase_invoices").run({})) as { count: number };
    expect(listed.count).toBe(1);
  });

  it("ages what is owed by how late it is, per supplier", async () => {
    await billing.saveDoc({
      number: "BILL-LATE",
      status: "sent",
      doc_type: "purchase",
      currency: "AED",
      tax_rate: 0,
      discount: 0,
      customer_name: "Gulf Paper Co",
      due_date: ymdAgo(45),
      items: [{ description: "paper", qty: 1, unit_price: 300 }],
    } as never);
    await billing.saveDoc({
      number: "BILL-FRESH",
      status: "sent",
      doc_type: "purchase",
      currency: "AED",
      tax_rate: 0,
      discount: 0,
      customer_name: "Inkwell FZE",
      due_date: ymdAgo(-10),
      items: [{ description: "toner", qty: 1, unit_price: 100 }],
    } as never);

    const r = (await tool("payables_aging").run({})) as {
      total_owed: number;
      buckets: Record<string, number>;
      by_supplier: Record<string, number>;
    };
    expect(r.total_owed).toBe(400);
    expect(r.buckets["31-60"]).toBe(300);
    expect(r.buckets.current).toBe(100);
    expect(r.by_supplier["Gulf Paper Co"]).toBe(300);
  });
});

describe("suppliers and receipts", () => {
  it("adds a supplier and finds it again", async () => {
    await tool("create_supplier").run({ name: "Inkwell FZE", email: "hi@inkwell.ae" });
    const found = (await tool("find_suppliers").run({ query: "inkwell" })) as {
      name: string;
    }[];
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("Inkwell FZE");
  });

  it("issues a receipt and lists it back with its total", async () => {
    const made = (await tool("create_payment_receipt").run({
      customer_name: "Acme",
      amount: 250,
      payment_method: "bank transfer",
    })) as { ok: boolean; number: string };
    expect(made.ok).toBe(true);

    const listed = (await tool("list_payment_receipts").run({})) as {
      count: number;
      total: number;
      receipts: { number: string }[];
    };
    expect(listed.count).toBe(1);
    expect(listed.total).toBe(250);
    expect(listed.receipts[0].number).toBe(made.number);
  });

  it("refuses a receipt for nothing", async () => {
    const r = (await tool("create_payment_receipt").run({
      customer_name: "Acme",
      amount: 0,
    })) as { error?: string };
    expect(r.error).toBeTruthy();
  });
});
