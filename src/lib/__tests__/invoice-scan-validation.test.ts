import { expect, it } from "vitest";
import { parseInvoiceExtraction } from "../ai";

const sample = () => ({ customer_name: "Buyer", tax_rate: 0, items: [{ description: "Free sample", qty: 0, unit_price: 0, unit: "L", tax_category: "Z" }] });

it("preserves zero quantities, free prices, units and multi-page lines", () => {
  const doc = sample();
  doc.items.push({ description: "Oil", qty: 2.5, unit_price: 4.1, unit: "L", tax_category: "S" });
  expect(parseInvoiceExtraction(JSON.stringify(doc))).toEqual(doc);
});

it.each([
  null, [], { items: {} }, { items: [null] }, { items: [] , customer_name: {} },
  { ...sample(), tax_rate: "5" }, { ...sample(), tax_rate: 101 },
  { items: [{ ...sample().items[0], qty: "2" }] },
  { items: [{ ...sample().items[0], qty: -1 }] },
  { items: [{ ...sample().items[0], unit_price: null }] },
  { items: [{ ...sample().items[0], description: {} }] },
  { items: [{ ...sample().items[0], unit: {} }] },
  { items: [{ ...sample().items[0], tax_category: {} }] },
  { items: [{ ...sample().items[0], qty: 1e200, unit_price: 1e200 }] },
  { items: [{ ...sample().items[0], qty: 1, unit_price: Number.MAX_SAFE_INTEGER / 100 }], tax_rate: 100 },
  { items: Array.from({ length: 501 }, () => sample().items[0]) },
])("rejects unsafe extracted fields before they reach the editor: %#", value => {
  expect(() => parseInvoiceExtraction(JSON.stringify(value))).toThrow("invalid invoice details");
});
