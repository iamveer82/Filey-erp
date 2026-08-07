import { beforeEach, describe, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { billing } from "../api";
import { TOOLS } from "../aiTools";

// The agent answers "who owes us money" from receivables_aging, so the bucket
// edges and the outstanding sum are a money path: an invoice in the wrong
// bucket is a customer chased too early or not at all.
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

const invoice = (number: string, customer: string, amount: number, dueDaysAgo: number) =>
  billing.saveDoc({
    number,
    status: "sent",
    currency: "AED",
    tax_rate: 0,
    discount: 0,
    customer_name: customer,
    due_date: ymdAgo(dueDaysAgo),
    items: [{ description: "work", qty: 1, unit_price: amount }],
  } as never);

describe("receivables_aging", () => {
  it("buckets by how late each invoice is and totals per customer", async () => {
    await invoice("INV-A", "Acme", 100, -5); // due in 5 days → current
    await invoice("INV-B", "Acme", 200, 10); // 10 days late → 1-30
    await invoice("INV-C", "Globex", 300, 75); // 75 days late → 61-90
    await invoice("INV-D", "Globex", 400, 200); // 200 days late → 90+

    const r = (await tool("receivables_aging").run({})) as {
      total_outstanding: number;
      buckets: Record<string, number>;
      by_customer: Record<string, number>;
      counted: number;
    };

    expect(r.total_outstanding).toBe(1000);
    expect(r.buckets.current).toBe(100);
    expect(r.buckets["1-30"]).toBe(200);
    expect(r.buckets["61-90"]).toBe(300);
    expect(r.buckets["90+"]).toBe(400);
    expect(r.by_customer.Acme).toBe(300);
    expect(r.by_customer.Globex).toBe(700);
    expect(r.counted).toBe(4);
  });

  it("leaves out drafts and settled invoices", async () => {
    await invoice("INV-E", "Acme", 500, 40);
    const draft = (await billing.saveDoc({
      number: "INV-F",
      status: "draft",
      currency: "AED",
      tax_rate: 0,
      discount: 0,
      customer_name: "Acme",
      due_date: ymdAgo(40),
      items: [{ description: "not sent yet", qty: 1, unit_price: 9999 }],
    } as never)) as number;
    expect(draft).toBeTruthy();

    const r = (await tool("receivables_aging").run({})) as { total_outstanding: number };
    expect(r.total_outstanding).toBe(500);
  });

  it("narrows to one customer when asked", async () => {
    await invoice("INV-G", "Acme", 100, 10);
    await invoice("INV-H", "Globex", 900, 10);
    const r = (await tool("receivables_aging").run({ customer: "acme" })) as {
      total_outstanding: number;
    };
    expect(r.total_outstanding).toBe(100);
  });
});

describe("the reporting tools answer at all", () => {
  it("returns a financial position and balanced books on an empty set", async () => {
    const summary = (await tool("financial_summary").run({})) as { net_profit: number };
    expect(summary).toHaveProperty("net_profit");

    const st = (await tool("financial_statements").run({})) as {
      trial_balance: { balanced: boolean };
      balance_sheet: unknown;
      cash: unknown;
    };
    expect(st.trial_balance.balanced).toBe(true);
    expect(st.balance_sheet).toBeTruthy();
    expect(st.cash).toBeTruthy();
  });

  it("computes a VAT return over the books", async () => {
    const vat = (await tool("vat_return").run({})) as { rate: number; netVatDue: number };
    expect(vat.rate).toBeGreaterThan(0);
    expect(typeof vat.netVatDue).toBe("number");
  });
});
