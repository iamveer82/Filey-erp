import { expect, it } from "vitest";
import { profitByDay, profitByItem, profitLines, profitTotals } from "../profit";
import type { InvoiceDoc } from "../api";

const doc = (id: number, date: string, items: { product_id?: number; description: string; qty: number; unit_price: number }[], extra: Partial<InvoiceDoc> = {}) =>
  ({ id, number: `INV-${id}`, issue_date: date, discount: 0, tax_rate: 5, items, ...extra }) as unknown as InvoiceDoc;
const costs = new Map([[1, 6], [2, 12]]);

it("counts sales before tax, after a share of the discount, against current cost", () => {
  const lines = profitLines(doc(1, "2026-11-01", [{ product_id: 1, description: "Paracetamol", qty: 10, unit_price: 10 }, { product_id: 2, description: "T-shirt", qty: 2, unit_price: 25 }], { discount: 15 } as Partial<InvoiceDoc>), costs);
  // 150 before discount; 15 off is 10%.
  expect(lines.map((l) => [l.item, l.sales, l.cost])).toEqual([["Paracetamol", 90, 60], ["T-shirt", 45, 24]]);
});

it("adds up per day and per item, with credit notes against them and unknown costs flagged", () => {
  const lines = [
    ...profitLines(doc(1, "2026-11-01", [{ product_id: 1, description: "Paracetamol", qty: 10, unit_price: 10 }]), costs),
    ...profitLines(doc(2, "2026-11-02", [{ product_id: 1, description: "Paracetamol", qty: 5, unit_price: 10 }, { description: "Delivery", qty: 1, unit_price: 20 }]), costs),
    ...profitLines(doc(3, "2026-11-02", [{ product_id: 1, description: "Paracetamol", qty: 2, unit_price: 10 }], { invoice_type_code: "381" } as Partial<InvoiceDoc>), costs),
  ];
  const days = profitByDay(lines);
  expect(days.map((d) => [d.label, d.bills, d.sales, d.cost, d.profit])).toEqual([["2026-11-02", 2, 50, 18, 32], ["2026-11-01", 1, 100, 60, 40]]);
  const items = profitByItem(lines);
  expect(items.find((r) => r.label === "Paracetamol")).toMatchObject({ qty: 13, sales: 130, cost: 78, profit: 52, margin: 40 });
  expect(items.find((r) => r.label === "Delivery")).toMatchObject({ profit: 20, costMissing: true });
  expect(profitTotals(lines)).toMatchObject({ sales: 150, cost: 78, profit: 72, margin: 48, bills: 3 });
});
