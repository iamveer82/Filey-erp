import { beforeEach, describe, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { billing, erp } from "../api";
import { docAmountInAed, unratedCurrency } from "../exchange-rates";
import { TOOLS } from "../aiTools";

// A total that ignores currency is worse than no total: AED 1,000 plus
// USD 1,000 reading as 2,000 is a number someone will act on.
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

describe("docAmountInAed", () => {
  const rates = { USD: 3.6725, EUR: 4.0 };

  it("passes AED straight through", () => {
    expect(docAmountInAed(1000, "AED", null, rates)).toBe(1000);
    expect(docAmountInAed(1000, undefined, undefined, rates)).toBe(1000);
  });

  it("prefers the document's own frozen rate over today's", () => {
    // Frozen at 3.60 on the day of issue; the market has since moved to 3.6725.
    expect(docAmountInAed(1000, "USD", 3.6, rates)).toBe(3600);
  });

  it("falls back to live rates for documents saved before the freeze", () => {
    expect(docAmountInAed(1000, "USD", null, rates)).toBeCloseTo(3672.5, 2);
  });

  it("passes an unknown currency through rather than inventing a rate", () => {
    expect(docAmountInAed(1000, "XYZ", null, rates)).toBe(1000);
    expect(unratedCurrency("XYZ", null, rates)).toBe(true);
    expect(unratedCurrency("USD", null, rates)).toBe(false);
    expect(unratedCurrency("XYZ", 3.6, rates)).toBe(false);
  });
});

describe("totals across currencies", () => {
  it("converts each invoice before adding it to the aging buckets", async () => {
    await billing.saveDoc({
      number: "INV-AED",
      status: "sent",
      currency: "AED",
      tax_rate: 0,
      discount: 0,
      customer_name: "Local Co",
      due_date: ymdAgo(10),
      items: [{ description: "work", qty: 1, unit_price: 1000 }],
    } as never);
    await billing.saveDoc({
      number: "INV-USD",
      status: "sent",
      currency: "USD",
      fx_rate: 3.6725,
      tax_rate: 0,
      discount: 0,
      customer_name: "Export Co",
      due_date: ymdAgo(10),
      items: [{ description: "work", qty: 1, unit_price: 1000 }],
    } as never);

    const r = (await tool("receivables_aging").run({})) as {
      currency: string;
      total_outstanding: number;
      by_customer: Record<string, number>;
      invoices: { currency: string; outstanding: number; outstanding_aed: number }[];
    };

    expect(r.currency).toBe("AED");
    // 1000 AED + 1000 USD at 3.6725 — NOT 2000.
    expect(r.total_outstanding).toBeCloseTo(4672.5, 2);
    expect(r.by_customer["Export Co"]).toBeCloseTo(3672.5, 2);

    // The invoice keeps its own face value and currency for display.
    const usd = r.invoices.find((i) => i.currency === "USD");
    expect(usd?.outstanding).toBe(1000);
    expect(usd?.outstanding_aed).toBeCloseTo(3672.5, 2);
  });

  it("counts unpaid invoices in one currency on the dashboard", async () => {
    await billing.saveDoc({
      number: "INV-1",
      status: "sent",
      currency: "USD",
      fx_rate: 3.6725,
      tax_rate: 0,
      discount: 0,
      customer_name: "Export Co",
      items: [{ description: "work", qty: 1, unit_price: 100 }],
    } as never);

    const summary = await erp.summary();
    expect(summary.unpaid_invoices).toBeCloseTo(367.25, 2);
  });
});
