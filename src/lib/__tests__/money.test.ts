import { describe, it, expect } from "vitest";
import { invoiceTotals, quotationTotals } from "../money";

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
});

describe("quotationTotals", () => {
  it("applies per-line discount then per-line tax", () => {
    const t = quotationTotals([
      { qty: 2, rate: 100, discount: 10, tax: 12 },
    ]);
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
