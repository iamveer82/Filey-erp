// The two mappings the quotation bug lived in.
//
// Rendering the page cannot catch this class of defect: the editor never
// displays the figures these feed (the totals go to the PDF, the email and the
// invoice conversion), so a mapping that quietly drops a field renders exactly
// the same. I wrote a render test first, proved it passed with the bug
// reintroduced, and deleted it. These assert the mappings directly, and they do
// fail when a field is dropped.
import { describe, it, expect } from "vitest";
import { asDocItem, asDocViewItem } from "../Quoting";
import { docLineAmount } from "../../lib/docItems";

const manualLine = {
  product: "Site survey",
  sku: "",
  qty: 3,
  rate: 100,
  discount: 0,
  tax: 0,
  unit: "job",
  custom: { area: "12" },
  calcMode: "manual" as const,
  amount: 250,
  itemFormula: null,
};

describe("asDocItem (feeds the totals, the PDF and the email)", () => {
  it("carries the fields docLineAmount needs to not multiply", () => {
    const d = asDocItem(manualLine);
    expect(d.calcMode).toBe("manual");
    expect(d.amount).toBe(250);
    // The behaviour that matters: 3 × 100 must not win.
    expect(docLineAmount(d)).toBe(250);
  });

  it("carries a per-line formula", () => {
    const d = asDocItem({
      ...manualLine,
      calcMode: "formula",
      amount: undefined,
      itemFormula: { a: "area", b: "unit_price" },
    });
    // area (12) × unit_price (100) — the line is priced by area, not by qty.
    expect(docLineAmount(d)).toBe(1200);
  });

  it("keeps identity and per-line percentages", () => {
    const d = asDocItem({ ...manualLine, product_id: 7, discount: 10, tax: 5 });
    expect(d.product_id).toBe(7);
    expect(d.discount).toBe(10);
    expect(d.tax).toBe(5);
    expect(d.unit).toBe("job");
  });
});

describe("asDocViewItem (feeds the preview, the PDF pages and print)", () => {
  it("carries the calc fields through to the renderer", () => {
    const v = asDocViewItem(manualLine);
    expect(v.calcMode).toBe("manual");
    expect(v.amount).toBe(250);
    expect(v.description).toBe("Site survey");
    expect(v.unit_price).toBe(100);
  });

  it("accepts an already-normalised item too (the paginated pages)", () => {
    const v = asDocViewItem({
      description: "Printing",
      qty: 2,
      unit_price: 10,
      calcMode: "formula",
      itemFormula: { a: "area", b: "unit_price" },
      custom: { area: "12" },
    });
    expect(v.description).toBe("Printing");
    expect(v.unit_price).toBe(10);
    expect(v.itemFormula).toEqual({ a: "area", b: "unit_price" });
  });
});
