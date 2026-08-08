import { beforeEach, describe, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { billing, erp, fin, pos } from "../api";
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

  it("posts a dollar invoice to the ledger at its dirham value", async () => {
    // The ledger is single-currency. Posting face value would report dollars as
    // dirhams in the P&L and under-report VAT by the exchange rate.
    await billing.saveDoc({
      number: "INV-LEDGER-USD",
      status: "sent",
      currency: "USD",
      fx_rate: 3.6725,
      tax_rate: 0,
      discount: 0,
      customer_name: "Export Co",
      items: [{ description: "consulting", qty: 1, unit_price: 1000 }],
    } as never);

    const accounts = await fin.accounts();
    const bal = (re: RegExp) =>
      accounts.find((a) => re.test(a.name))?.balance ?? 0;
    expect(bal(/receivable/i)).toBeCloseTo(3672.5, 2); // not 1000
    expect(bal(/sales|revenue/i)).toBeCloseTo(3672.5, 2);
  });

  it("clears the receivable when a dollar invoice is paid", async () => {
    const id = (await billing.saveDoc({
      number: "INV-PAY-USD",
      status: "sent",
      currency: "USD",
      fx_rate: 3.6725,
      tax_rate: 0,
      discount: 0,
      customer_name: "Export Co",
      items: [{ description: "consulting", qty: 1, unit_price: 1000 }],
    } as never)) as number;

    // Paid in full, in the invoice's own currency.
    await billing.addPayment(id, 1000, "bank transfer", "2026-08-08");

    const accounts = await fin.accounts();
    const bal = (re: RegExp) =>
      accounts.find((a) => re.test(a.name))?.balance ?? 0;
    // AR debited 3672.50 by the invoice, credited 3672.50 by the payment.
    // Posting the payment at face value left 2672.50 sitting there forever.
    expect(bal(/receivable/i)).toBeCloseTo(0, 2);
    expect(bal(/cash|bank/i)).toBeCloseTo(3672.5, 2);
  });

  it("books the difference when a euro invoice settles at another rate", async () => {
    // Raised at 4.00, and the live fallback rate for EUR in this environment is
    // also 4.00 — so to exercise the gain path the invoice is frozen LOW, as it
    // would be if the euro had strengthened since the invoice date.
    const id = (await billing.saveDoc({
      number: "INV-EUR",
      status: "sent",
      currency: "EUR",
      fx_rate: 3.9,
      tax_rate: 0,
      discount: 0,
      customer_name: "Berlin GmbH",
      items: [{ description: "consulting", qty: 1, unit_price: 1000 }],
    } as never)) as number;

    await billing.addPayment(id, 1000, "bank transfer", "2026-08-08");

    const accounts = await fin.accounts();
    const bal = (re: RegExp) =>
      accounts.find((a) => re.test(a.name))?.balance ?? 0;
    // AR is relieved at the rate it was raised at, so it still reaches zero.
    expect(bal(/receivable/i)).toBeCloseTo(0, 2);
    // Cash is worth what arrived on the day, and the gap is a recorded gain
    // rather than a hole in the trial balance.
    const cash = bal(/cash|bank/i);
    const fx = bal(/foreign exchange/i);
    expect(cash - 3900).toBeCloseTo(-fx, 2);
    // And it really happened — the euro's spot rate is above the frozen 3.90,
    // so this must be a non-zero gain, not two zeros agreeing with each other.
    expect(cash).toBeGreaterThan(3900);
    expect(fx).toBeLessThan(0);
  });

  it("posts no exchange difference for a currency it has no rate for", async () => {
    const id = (await billing.saveDoc({
      number: "INV-XYZ",
      status: "sent",
      currency: "XYZ",
      fx_rate: 2,
      tax_rate: 0,
      discount: 0,
      customer_name: "Nowhere Ltd",
      items: [{ description: "work", qty: 1, unit_price: 100 }],
    } as never)) as number;
    await billing.addPayment(id, 100, "cash", "2026-08-08");

    const accounts = await fin.accounts();
    const bal = (re: RegExp) =>
      accounts.find((a) => re.test(a.name))?.balance ?? 0;
    // Without a rate, "spot" would pass the raw 100 through and invent a 100
    // loss against a 200 receivable. Nothing should be posted at all.
    expect(bal(/foreign exchange/i)).toBe(0);
    expect(bal(/receivable/i)).toBeCloseTo(0, 2);
    expect(bal(/cash|bank/i)).toBeCloseTo(200, 2);
  });

  it("values stock bought in dollars at what it actually cost in dirhams", async () => {
    // The nastiest version of this bug: buy a part at $10 and the books record
    // it as costing 10 dirhams, so every margin and COGS figure downstream is
    // wrong by the exchange rate and nothing on screen looks broken.
    const productId = (await erp.createProduct({
      sku: "IMP-1",
      name: "Imported part",
      quantity: 0,
      cost_price: 0,
      price: 50,
      reorder_level: 1,
    } as never)) as number;

    await billing.saveDoc({
      number: "BILL-USD",
      status: "sent",
      doc_type: "purchase",
      currency: "USD",
      fx_rate: 3.6725,
      tax_rate: 0,
      discount: 0,
      customer_name: "Overseas Supplier",
      items: [
        { description: "Imported part", qty: 10, unit_price: 10, product_id: productId },
      ],
    } as never);

    const product = (await erp.products()).find((p) => p.id === productId);
    expect(product?.quantity).toBe(10);
    expect(product?.cost_price).toBeCloseTo(36.725, 2); // not 10
  });

  it("does the same when a purchase order is received", async () => {
    const productId = (await erp.createProduct({
      sku: "IMP-2",
      name: "Another part",
      quantity: 0,
      cost_price: 0,
      price: 50,
      reorder_level: 1,
    } as never)) as number;

    const poId = (await pos.save({
      po_number: "PO-USD",
      status: "draft",
      currency: "USD",
      fx_rate: 3.6725,
      supplier_name: "Overseas Supplier",
      items: [
        { description: "Another part", quantity: 5, unit_cost: 20, product_id: productId },
      ],
    } as never)) as number;
    await pos.receive(poId);

    const product = (await erp.products()).find((p) => p.id === productId);
    expect(product?.quantity).toBe(5);
    expect(product?.cost_price).toBeCloseTo(73.45, 2); // 20 USD, not 20 AED
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
