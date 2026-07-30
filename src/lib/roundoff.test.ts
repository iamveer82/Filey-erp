// Round-off + per-line discount meta: the money paths every doc total flows
// through must agree between editor, printed doc and ledger.
import { describe, it, expect } from "vitest";
import { applyRoundOff, invoiceTotals } from "./money";
import {
  splitItemMeta,
  mergeItemMeta,
  docTotals,
  docLineAmount,
  DISC_KEY,
} from "./docItems";

describe("applyRoundOff", () => {
  it("rounds to the nearest whole unit and reports the adjustment", () => {
    const t = { subtotal: 100, discount: 0, tax: 5.3, total: 105.3 };
    const r = applyRoundOff(t, true);
    expect(r.total).toBe(105);
    expect(r.round_off).toBe(-0.3);
    const up = applyRoundOff({ ...t, total: 105.5 }, true);
    expect(up.total).toBe(106);
    expect(up.round_off).toBe(0.5);
  });
  it("is a no-op when disabled", () => {
    const t = { subtotal: 100, discount: 0, tax: 5.3, total: 105.3 };
    expect(applyRoundOff(t, false)).toEqual({ ...t, round_off: 0 });
  });
});

describe("per-line discount via item meta", () => {
  it("round-trips through mergeItemMeta/splitItemMeta", () => {
    const c = mergeItemMeta({ custom: {}, discount: 12.5 });
    expect(c?.[DISC_KEY]).toBe("12.5");
    const back = splitItemMeta(c);
    expect(back.discount).toBe(12.5);
    // clearing the discount removes the key
    expect(mergeItemMeta({ custom: c, discount: 0 })).toBeUndefined();
  });

  it("docTotals applies line discounts that invoiceTotals ignores", () => {
    const items = [
      { description: "a", qty: 10, unit_price: 100, discount: 10 }, // 1000 → 900
      { description: "b", qty: 1, unit_price: 500 },
    ];
    const t = docTotals(items as any, 0, 5);
    expect(t.subtotal).toBe(1500);
    expect(t.discount).toBe(100);
    expect(t.total).toBe(1470); // 1400 net + 5% VAT
    // sanity: flat path unchanged without line-level values
    expect(invoiceTotals(items.map(({ discount: _d, ...i }) => i) as any, 0, 5).total).toBe(
      1575
    );
  });

  it("does not tax zero-rated lines once a line discount is present", () => {
    // A per-line discount routes docTotals down its line-aware branch. That
    // branch used to tax every line flat, so the "Z" line below was charged 5%
    // VAT it must never carry — and the total disagreed with the category
    // breakdown printed next to it on the same document.
    const items = [
      { description: "std", qty: 1, unit_price: 1000, tax_category: "S", discount: 10 },
      { description: "export", qty: 1, unit_price: 500, tax_category: "Z" },
    ];
    const t = docTotals(items as any, 0, 5);
    expect(t.subtotal).toBe(1500);
    expect(t.discount).toBe(100);
    expect(t.tax).toBe(45); // 5% of the 900 standard-rated net only, not of 1400
    expect(t.total).toBe(1445);
  });

  it("allocates a document discount pro-rata before applying VAT by category", () => {
    const items = [
      { description: "std", qty: 1, unit_price: 600, tax_category: "S", discount: 0 },
      { description: "exempt", qty: 1, unit_price: 400, tax_category: "E", discount: 25 },
    ];
    // Line discount 100 (25% of 400) + document discount 100 → net 800.
    // Standard share of the 900 post-line-discount net is 600/900 = ⅔ → 533.33.
    const t = docTotals(items as any, 100, 5);
    expect(t.subtotal).toBe(1000);
    expect(t.discount).toBe(200);
    expect(t.tax).toBe(26.67); // 5% × 533.33
  });

  it("does not add the document rate on top of a line's own tax rate", () => {
    // The line is explicitly rated at 10%; the document rate must not also
    // apply to it, or that line is taxed twice.
    const items = [
      { description: "own rate", qty: 1, unit_price: 1000, tax: 10 },
      { description: "doc rate", qty: 1, unit_price: 1000 },
    ];
    const t = docTotals(items as any, 0, 5);
    expect(t.tax).toBe(150); // 100 from the line's 10%, 50 from the doc's 5%
    expect(t.total).toBe(2150);
  });
});

describe("docLineAmount", () => {
  it("is net of the line discount and exclusive of tax", () => {
    // Tax-inclusive line amounts double-reported VAT (already in the Tax row)
    // and inflated every taxable base computed from this figure.
    const it = { description: "a", qty: 2, unit_price: 500, discount: 10, tax: 5 };
    expect(docLineAmount(it as any)).toBe(900);
  });

  it("honours a manual amount and leaves plain lines to invoiceLineAmount", () => {
    expect(docLineAmount({ description: "m", qty: 1, unit_price: 0, calcMode: "manual", amount: 250, discount: 20 } as any)).toBe(200);
    expect(docLineAmount({ description: "p", qty: 3, unit_price: 33.33 } as any)).toBe(99.99);
  });
});
