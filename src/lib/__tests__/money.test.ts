import { describe, it, expect } from "vitest";
import { invoiceTotals, invoiceLineAmount, quotationTotals } from "../money";

describe("invoiceTotals — category-aware VAT", () => {
  it("taxes only standard-rated lines (mixed invoice)", () => {
    const t = invoiceTotals(
      [
        { qty: 2, unit_price: 100, tax_category: "S" }, // 200 → taxed
        { qty: 1, unit_price: 50, tax_category: "Z" }, // 50 → 0
      ],
      0,
      5
    );
    expect(t.subtotal).toBe(250);
    expect(t.tax).toBe(10); // 5% of 200 only
    expect(t.total).toBe(260);
  });

  it("no category set = all standard = flat net × rate (back-compat)", () => {
    const t = invoiceTotals([{ qty: 1, unit_price: 1000 }], 0, 5);
    expect(t.tax).toBe(50);
    expect(t.total).toBe(1050);
  });

  it("zero-rated whole invoice charges no VAT", () => {
    const t = invoiceTotals([{ qty: 4, unit_price: 25, tax_category: "Z" }], 0, 5);
    expect(t.tax).toBe(0);
    expect(t.total).toBe(100);
  });
});

describe("invoiceLineAmount", () => {
  it("uses qty × unit_price by default", () => {
    expect(invoiceLineAmount({ qty: 3, unit_price: 10 })).toBe(30);
  });

  it("uses manual amount when calcMode is manual", () => {
    expect(
      invoiceLineAmount({ qty: 5, unit_price: 100, calcMode: "manual", amount: 175 })
    ).toBe(175);
  });

  it("uses per-line formula over doc-level formula", () => {
    const item = {
      qty: 2,
      unit_price: 50,
      calcMode: "formula" as const,
      itemFormula: { a: "qty" },
      custom: { width: "10" },
    };
    // per-line formula uses qty → 2 × 50 = 100
    expect(invoiceLineAmount(item, { a: "width" })).toBe(100);
  });

  it("falls back to doc-level formula when per-line formula has no field", () => {
    const item = {
      qty: 2,
      unit_price: 50,
      calcMode: "formula" as const,
      itemFormula: { a: "" },
      custom: { width: "10" },
    };
    expect(invoiceLineAmount(item, { a: "width" })).toBe(500);
  });
});

describe("invoiceTotals", () => {
  it("computes subtotal, 5% VAT and total", () => {
    const t = invoiceTotals(
      [
        { qty: 2, unit_price: 100 },
        { qty: 1, unit_price: 50 },
      ],
      0,
      5
    );
    expect(t.subtotal).toBe(250);
    expect(t.tax).toBe(12.5);
    expect(t.total).toBe(262.5);
  });

  it("applies a flat discount before tax and clamps it", () => {
    const t = invoiceTotals([{ qty: 1, unit_price: 100 }], 30, 5);
    expect(t.discount).toBe(30);
    expect(t.tax).toBe(3.5); // 70 * 5%
    expect(t.total).toBe(73.5);
  });

  it("never lets discount exceed subtotal", () => {
    const t = invoiceTotals([{ qty: 1, unit_price: 100 }], 999, 5);
    expect(t.discount).toBe(100);
    expect(t.total).toBe(0);
  });

  it("handles empty items", () => {
    expect(invoiceTotals([], 0, 5)).toEqual({
      subtotal: 0,
      discount: 0,
      tax: 0,
      total: 0,
    });
  });

  it("mixes manual and formula lines", () => {
    const t = invoiceTotals(
      [
        { qty: 1, unit_price: 100, calcMode: "manual", amount: 50 },
        { qty: 2, unit_price: 10, custom: { length: "3" }, calcMode: "formula", itemFormula: { a: "length" } },
      ],
      0,
      5
    );
    expect(t.subtotal).toBe(80); // 50 + 2*10*3
    expect(t.tax).toBe(4);
    expect(t.total).toBe(84);
  });
});

describe("quotationTotals", () => {
  it("applies per-line discount then per-line tax", () => {
    const t = quotationTotals([{ qty: 2, rate: 100, discount: 10, tax: 12 }]);
    // gross 200, disc 20, net 180, tax 21.6
    expect(t.subtotal).toBe(200);
    expect(t.discount).toBe(20);
    expect(t.tax).toBe(21.6);
    expect(t.total).toBe(201.6);
  });

  it("sums multiple lines with mixed rates", () => {
    const t = quotationTotals([
      { qty: 1, rate: 375, discount: 5, tax: 12 },
      { qty: 3, rate: 399, discount: 0, tax: 12 },
    ]);
    expect(t.subtotal).toBe(1572);
    expect(t.total).toBeGreaterThan(t.subtotal - t.discount);
  });
});
