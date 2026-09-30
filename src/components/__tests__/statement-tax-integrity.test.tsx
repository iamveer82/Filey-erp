import { beforeEach, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { billing, pos, type InvoiceDocInput, type PoInput } from "../../lib/api";
import { setDataMode } from "../../lib/dataMode";
import { buildStatement, type StatementDocEntry, type StatementPaymentEntry } from "../statements/buildStatement";
import { statementTemplates } from "../statements/StatementTemplates";

beforeEach(() => { localStorage.clear(); setDataMode("local"); });
const build = (docs: StatementDocEntry[], payments: StatementPaymentEntry[] = []) => buildStatement({
  kind: "customer", company: { name: "Test company", country_code: "AE" }, party: { name: "Test customer" },
  currency: "AED", period: { from: null, to: "2026-10-01" }, docs, payments,
}).data;
const invoice = (extra: Partial<InvoiceDocInput> = {}): InvoiceDocInput => ({
  number: "INV-TAX", customer_name: "Test customer", seller_name: "Test company", status: "draft",
  template: "corporate", accent: "#000", currency: "AED", issue_date: "2026-09-30", tax_rate: 5, discount: 10, round_off: true,
  items: [
    { description: "Manual taxed", qty: 9, unit_price: 500, custom: { __calc_mode: "manual", __manual_amount: "123.45", __disc_pct: "10", __tax_pct: "7" } },
    { description: "Exempt", qty: 2, unit_price: 20, tax_category: "E" },
  ], ...extra,
});

it("exposes the already-computed exact invoice net and tax instead of inferring a flat tax from gross", async () => {
  const id = await billing.saveDoc(invoice());
  const summary = (await billing.listDocs()).find(doc => doc.id === id)!;
  expect(summary).toMatchObject({ total: 148, net_total: 140.74, tax_total: 7.26 });
  const data = build([{ number: summary.number, date: summary.issue_date, total: summary.total, net: 140.74, tax: 7.26, taxRate: 5 }]);
  expect(data.totalVat).toBe(7.26);
  expect(data.totalNet).toBe(140.74);
  expect(data.lines[0]).toMatchObject({ debit: 148, net: 140.74, vat: 7.26 });
});

it("keeps credit-note net and tax signed and reconciled in statement totals", async () => {
  const id = await billing.saveDoc(invoice({ number: "CN-TAX", invoice_type_code: "381" }));
  const summary = (await billing.listDocs()).find(doc => doc.id === id)!;
  expect(summary).toMatchObject({ total: -148, net_total: -140.74, tax_total: -7.26 });
  const data = build([
    { number: "INV", date: "2026-09-29", total: 205, net: 200, tax: 5, taxRate: 5 },
    { number: "CN", date: "2026-09-30", total: -148, net: -140.74, tax: -7.26, taxRate: 5 },
  ]);
  expect(data.totalNet).toBe(59.26);
  expect(data.totalVat).toBe(-2.26);
  expect(data.totalNet! + data.totalVat!).toBeCloseTo(data.totalDebit - data.totalCredit, 2);
  expect(data.lines[1]).toMatchObject({ debit: 0, credit: 148, net: -140.74, vat: -7.26 });
  for (const { Component } of Object.values(statementTemplates)) {
    const html = renderToStaticMarkup(<Component data={data} />);
    expect(html).toContain("VAT");
    if (html.includes("Net</th>")) { expect(html).toContain("-140.74"); expect(html).toContain("-7.26"); }
  }
});

it("exposes exact purchase-order tax from existing fetched item metadata without additional reads", async () => {
  const id = await pos.save({
    po_number: "PO-TAX", supplier_name: "Test supplier", status: "draft", template: "corporate", accent: "#000", currency: "AED",
    total: 0, order_date: "2026-09-30", tax_rate: 5, discount: 20,
    items: [{ description: "Manual", quantity: 9, unit_cost: 500, custom: { __calc_mode: "manual", __manual_amount: "200", __disc_pct: "10", __tax_pct: "7" } }],
  } as PoInput);
  expect((await pos.list()).find(doc => doc.id === id)).toMatchObject({ total: 171.2, net_total: 160, tax_total: 11.2 });
});

it("shows signed credit notes once and keeps the tax table's payments column reconciled", () => {
  const data = build([
    { number: "INV", date: "2026-09-29", total: 205, net: 200, tax: 5 },
    { number: "CN", date: "2026-09-30", total: -148, net: -140.74, tax: -7.26 },
  ], [{ date: "2026-10-01", amount: 10, docNumber: "INV" }]);
  expect(data.totalDebit).toBe(205);
  expect(data.totalCredit).toBe(158);
  expect(data.closingBalance).toBe(47);
  for (const key of ["compact", "ledger"] as const) {
    const { Component } = statementTemplates[key];
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<Component data={data} />);
    const headers = Array.from(container.querySelectorAll("thead th"), cell => cell.textContent?.trim());
    const rows = Array.from(container.querySelectorAll("tbody tr"), row => Array.from(row.querySelectorAll("td"), cell => cell.textContent?.trim()));
    const note = rows.find(row => row.includes("CN"))!;
    expect(note[headers.indexOf("Total")]).toBe("-148.00");
    expect(note[headers.indexOf("Payments")]).toBe("—");
    expect(rows[rows.length - 1].slice(-5)).toEqual(["59.26", "-2.26", "57.00", "10.00", "47.00"]);
  }
});

it("does not assert zero or partial tax when any legacy document lacks exact breakdown data", () => {
  const data = build([
    { number: "Exact", date: "2026-09-29", total: 105, net: 100, tax: 5 },
    { number: "Legacy", date: "2026-09-30", total: 205, taxRate: 5 },
  ]);
  expect(data.totalVat).toBeNull();
  expect(data.totalNet).toBeNull();
  expect(data.lines[1].vat).toBeUndefined();
  expect(data.totalDebit).toBe(310);
  for (const { Component } of Object.values(statementTemplates)) {
    const html = renderToStaticMarkup(<Component data={data} />);
    expect(html).not.toContain("Total VAT");
    expect(html).not.toContain("VAT</th>");
  }
});
