// Round-off + per-line discount meta: the money paths every doc total flows
// through must agree between editor, printed doc and ledger.
import { describe, it, expect } from "vitest";
import { applyRoundOff, invoiceTotals } from "./money";
import { splitItemMeta, mergeItemMeta, docTotals, DISC_KEY } from "./docItems";

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
});
