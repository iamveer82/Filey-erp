import { describe, it, expect } from "vitest";
import { docLineAmount, docTotals, splitItemMeta, mergeItemMeta } from "../docItems";
import { applyRoundOff } from "../money";

/* The quotation editor used to map its items into DocItem while dropping
 * calcMode / amount / itemFormula, so every line fell through to qty × rate:
 * a line the user set to a manual amount silently changed value, and the quote
 * totalled to a number that matched neither the editor nor the PDF. These pin
 * the contract that mapping has to keep. */

describe("quotation line amounts", () => {
  it("honours a manual amount instead of multiplying qty × rate", () => {
    const manual = {
      description: "Site survey",
      qty: 3,
      unit_price: 100,
      calcMode: "manual" as const,
      amount: 250,
    };
    expect(docLineAmount(manual)).toBe(250);
    // The bug: same line with the meta dropped.
    expect(docLineAmount({ description: "Site survey", qty: 3, unit_price: 100 })).toBe(300);
  });

  it("honours a per-line formula over the document formula", () => {
    const line = {
      description: "Printing",
      qty: 2,
      unit_price: 10,
      custom: { area: "12" },
      calcMode: "formula" as const,
      itemFormula: { a: "area", b: "unit_price" },
    };
    // 12 (area) × 10, not 2 × 10.
    expect(docLineAmount(line)).toBe(120);
  });

  it("still applies a per-line discount on top of a manual amount", () => {
    const line = {
      description: "Consulting",
      qty: 1,
      unit_price: 0,
      calcMode: "manual" as const,
      amount: 1000,
      discount: 10,
    };
    expect(docLineAmount(line)).toBe(900);
  });
});

describe("quotation meta survives a save/load round trip", () => {
  it("packs into custom and unpacks back to the same values", () => {
    const packed = mergeItemMeta({
      custom: { area: "12" },
      calcMode: "manual",
      amount: 250,
      itemFormula: null,
      pageBreakBefore: true,
    });
    const out = splitItemMeta(packed);
    expect(out.calcMode).toBe("manual");
    expect(out.amount).toBe(250);
    expect(out.pageBreakBefore).toBe(true);
    // Real custom columns must survive untouched, with no meta keys leaking
    // into them (they would otherwise render as a column on the document).
    expect(out.custom).toEqual({ area: "12" });
  });
});

describe("quotation totals", () => {
  it("rounds the grand total only when round-off is on", () => {
    const items = [
      { description: "A", qty: 1, unit_price: 100.4 },
      { description: "B", qty: 1, unit_price: 50.2 },
    ];
    const raw = docTotals(items, 0, 0);
    expect(applyRoundOff(raw, false).total).toBeCloseTo(150.6, 2);

    const rounded = applyRoundOff(raw, true);
    expect(rounded.total).toBe(151);
    expect(rounded.round_off).toBeCloseTo(0.4, 2);
  });
});

/* Converting an accepted quote into an invoice used to recompute
 * qty × rate × (1 - discount), so a quote line the customer accepted at a
 * manual 250 was invoiced at 300. The conversion now pins the accepted figure.
 * This reproduces that arithmetic against the shared helpers. */
describe("quote → invoice conversion", () => {
  const quoteLine = {
    qty: 3,
    rate: 100,
    discount: 0,
    tax: 0,
    custom: mergeItemMeta({ calcMode: "manual", amount: 250 }),
  };

  it("bills the accepted amount, not qty × rate", () => {
    const { calcMode, amount, itemFormula, custom } = splitItemMeta(quoteLine.custom);
    const accepted = docLineAmount({
      description: "",
      qty: quoteLine.qty,
      unit_price: quoteLine.rate,
      custom,
      calcMode,
      amount,
      itemFormula,
      discount: quoteLine.discount,
    });
    expect(accepted).toBe(250);

    // What the old conversion produced, kept as the contrast that must not return.
    const legacy = quoteLine.rate * (1 - quoteLine.discount / 100) * quoteLine.qty;
    expect(legacy).toBe(300);
  });

  it("back-derives a unit price that still multiplies out to the total", () => {
    const accepted = 250;
    const unitPrice = Math.round((accepted / quoteLine.qty) * 100) / 100;
    expect(unitPrice * quoteLine.qty).toBeCloseTo(accepted, 1);
  });
});
