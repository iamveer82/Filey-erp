import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runTool } from "./tools.ts";
import { applyRoundOff } from "../_shared/money.ts";
import { storedDocTotals, docTotals as sharedDocTotals, type DocItem } from "../_shared/docItems.ts";
import { docTotals as desktopDocTotals } from "../../../src/lib/docItems.ts";

type Row = Record<string, unknown>;
function invoicesClient(docs: Row[], items: Row[]) {
  const selections: [string, string][] = [];
  const filters: [string, string, unknown][] = [];
  const client = { from(table: string) {
    let rows = table === "invoice_docs" ? [...docs] : [...items];
    const builder = {
      select: (columns: string) => { selections.push([table, columns]); return builder; },
      eq: (column: string, value: unknown) => { filters.push([table, column, value]); rows = rows.filter(row => row[column] === value); return builder; },
      in: (column: string, values: unknown[]) => { rows = rows.filter(row => values.includes(row[column])); return builder; },
      gte: (column: string, value: string) => { rows = rows.filter(row => String(row[column]) >= value); return builder; },
      lte: (column: string, value: string) => { rows = rows.filter(row => String(row[column]) <= value); return builder; },
      neq: (column: string, value: unknown) => { rows = rows.filter(row => row[column] !== value); return builder; },
      order: () => builder,
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return builder;
  } };
  return { client, selections, filters };
}

const date = new Date().toISOString().slice(0, 10);
const complexDoc = {
  id: 1, org_id: "ORG", number: "FIXTURE-1", customer_name: "Fixture customer", status: "sent",
  issue_date: date, doc_type: "Tax Invoice", currency: "AED", tax_rate: 5, discount: 20,
  unit_price_formula: { a: "volume" }, round_off: true,
};
const complexItems: (DocItem & Row)[] = [
  { invoice_id: 1, org_id: "ORG", description: "Manual with line discount", qty: 8, unit_price: 999,
    custom: { __calc_mode: "manual", __manual_amount: "100", __disc_pct: "10", __tax_pct: "10" } },
  { invoice_id: 1, org_id: "ORG", description: "Line formula", qty: 1, unit_price: 5,
    custom: { area: "4", volume: "999", __calc_mode: "formula", __formula_a: "area", __tax_pct: "20" } },
  { invoice_id: 1, org_id: "ORG", description: "Document formula", qty: 30, unit_price: 1, custom: { volume: "10" } },
  { invoice_id: 1, org_id: "ORG", description: "Zero-rated manual", qty: 1, unit_price: 2,
    custom: { __calc_mode: "manual", __manual_amount: "80" }, tax_category: "Z" },
];

Deno.test("hosted invoice detail uses the exact desktop source for packed pricing, VAT and final roundoff", async () => {
  assertEquals(desktopDocTotals, sharedDocTotals, "frontend imports must remain re-exports of the hosted calculation source");
  const { client, selections } = invoicesClient([complexDoc], complexItems);
  const result = await runTool(client, "ORG", "get_invoice_detail", { invoice_number: complexDoc.number }) as Row;
  assertEquals(result.subtotal, 210);
  assertEquals(result.applied_discount, 30);
  assertEquals(result.tax, 12.15);
  assertEquals(result.total, 192);
  assertEquals(result.net, 179.85);
  assertEquals(result.round_off_adjustment, -0.15);
  const desktop = applyRoundOff(storedDocTotals(complexItems, 20, 5, { a: "volume" }), true);
  assertEquals(result.total, desktop.total);
  assertEquals(result.tax, desktop.tax);
  assertEquals(selections.find(([table]) => table === "invoice_docs")?.[1].includes("unit_price_formula,round_off"), true);
  assertEquals(selections.find(([table]) => table === "invoice_doc_items")?.[1].includes("custom,tax_category"), true);
});

Deno.test("historical simple invoice arithmetic remains unchanged", async () => {
  const doc = { ...complexDoc, number: "LEGACY-1", discount: 100, round_off: false, unit_price_formula: null };
  const items = [
    { org_id: "ORG", invoice_id: 1, qty: 2, unit_price: 500 },
    { org_id: "ORG", invoice_id: 1, qty: 1, unit_price: 200 },
  ];
  const { client } = invoicesClient([doc], items);
  const result = await runTool(client, "ORG", "get_invoice_detail", { invoice_number: doc.number }) as Row;
  assertEquals(result.subtotal, 1200);
  assertEquals(result.tax, 55);
  assertEquals(result.total, 1155);
  assertEquals(result.currency, "AED");
});

Deno.test("sales reports use issued totals, subtract credit notes, exclude cancelled rows and never mix currencies", async () => {
  const docs = [complexDoc,
    { ...complexDoc, id: 2, number: "CREDIT-1", invoice_type_code: "381", discount: 0, unit_price_formula: null, round_off: false },
    { ...complexDoc, id: 3, number: "USD-1", currency: "USD", customer_name: "USD fixture", discount: 0, unit_price_formula: null, round_off: false },
    { ...complexDoc, id: 4, number: "CANCELLED", status: "cancelled" },
    { ...complexDoc, id: 5, number: "OTHER-ORG", org_id: "OTHER" },
  ];
  const items = [...complexItems,
    { invoice_id: 2, org_id: "ORG", qty: 1, unit_price: 100 },
    { invoice_id: 3, org_id: "ORG", qty: 2, unit_price: 10 },
    { invoice_id: 4, org_id: "ORG", qty: 1, unit_price: 99999 },
    { invoice_id: 5, org_id: "OTHER", qty: 1, unit_price: 99999 },
  ];
  const { client } = invoicesClient(docs, items);
  const month = date.slice(0, 7);
  const monthly = await runTool(client, "ORG", "run_report", { report: "sales_by_month" });
  assertEquals(monthly, { by_currency: [
    { currency: "AED", months: { [month]: { invoices: 2, total: 87 } } },
    { currency: "USD", months: { [month]: { invoices: 1, total: 21 } } },
  ] });
  assertEquals(await runTool(client, "ORG", "run_report", { report: "top_customers" }), { by_currency: [
    { currency: "AED", customers: [{ customer: "Fixture customer", total: 87 }] },
    { currency: "USD", customers: [{ customer: "USD fixture", total: 21 }] },
  ] });
});

Deno.test("VAT lookup shares category/discount math and final rounding, subtracts credits and separates document currencies", async () => {
  const purchase = { ...complexDoc, id: 2, number: "PURCHASE-1", doc_type: "purchase", discount: 0, unit_price_formula: null, round_off: false };
  const credit = { ...purchase, id: 3, doc_type: "Tax Invoice", invoice_type_code: "381" };
  const usd = { ...purchase, id: 4, currency: "USD", doc_type: "Tax Invoice" };
  const { client, filters } = invoicesClient([complexDoc, purchase, credit, usd], [...complexItems,
    { org_id: "ORG", invoice_id: 2, qty: 1, unit_price: 40 },
    { org_id: "ORG", invoice_id: 3, qty: 1, unit_price: 20 },
    { org_id: "ORG", invoice_id: 4, qty: 1, unit_price: 20 },
  ]);
  const result = await runTool(client, "ORG", "get_vat_summary", { from: date, to: date });
  assertEquals(result, { from: date, to: date, by_currency: [
    { currency: "AED", output_net: 159.85, output_tax: 11.15, input_net: 40, input_tax: 2, net_vat: 9.15 },
    { currency: "USD", output_net: 20, output_tax: 1, input_net: 0, input_tax: 0, net_vat: 1 },
  ] });
  assertEquals(filters.filter(([, column]) => column === "org_id").map(([, , value]) => value), ["ORG", "ORG"]);
});
