import { describe, it, expect } from "vitest";
import { netByTaxCategory, docTotals, type DocItem } from "../docItems";

const line = (
  description: string,
  qty: number,
  unit_price: number,
  tax_category?: string,
  discount?: number
): DocItem => ({ description, qty, unit_price, tax_category, discount });

describe("netByTaxCategory", () => {
  it("splits net turnover by category", () => {
    const r = netByTaxCategory(
      [line("consulting", 1, 1000), line("export", 1, 400, "Z"), line("rent", 1, 250, "E")],
      0
    );
    expect(r).toEqual({ S: 1000, Z: 400, E: 250 });
  });

  it("treats a missing category as standard-rated", () => {
    expect(netByTaxCategory([line("thing", 2, 50)], 0)).toEqual({ S: 100 });
  });

  it("spreads a document discount pro-rata across categories", () => {
    // 1000 standard + 1000 zero-rated, 200 off the document = 10% off each.
    const r = netByTaxCategory([line("a", 1, 1000), line("b", 1, 1000, "Z")], 200);
    expect(r.S).toBe(900);
    expect(r.Z).toBe(900);
  });

  it("applies per-line discounts before the document discount", () => {
    const r = netByTaxCategory([line("a", 1, 1000, "S", 50), line("b", 1, 500, "Z")], 0);
    expect(r.S).toBe(500);
    expect(r.Z).toBe(500);
  });

  it("sums to the same net that docTotals bills", () => {
    const items = [line("a", 3, 200), line("b", 1, 400, "Z"), line("c", 2, 75, "E")];
    const t = docTotals(items, 150, 5);
    const sum = Object.values(netByTaxCategory(items, 150)).reduce((s, n) => s + n, 0);
    expect(sum).toBeCloseTo(t.total - t.tax, 2);
  });

  it("survives an empty or free document without dividing by zero", () => {
    expect(netByTaxCategory([], 0)).toEqual({});
    expect(netByTaxCategory([line("freebie", 1, 0)], 0)).toEqual({ S: 0 });
  });
});
