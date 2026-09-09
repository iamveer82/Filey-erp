import { beforeEach, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  billing,
  quotes,
  pos,
  receipts,
  type CompanyProfile,
  type InvoiceDocInput,
} from "../api";
import {
  COUNTRY_OPTIONS,
  EU_COUNTRIES,
  taxRegimeFor,
  defaultTaxRate,
  taxIdError,
} from "../taxRegimes";
import { setDataMode } from "../dataMode";
import DocView from "../../components/DocView";
import { buildInvoiceXml, validateEInvoice } from "../einvoiceXml";

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});
const company = (country_code: string, rate: number): CompanyProfile => ({
  name: "International Co",
  country_code,
  currency: "AED",
  default_tax_rate: rate,
  default_template: "minimal",
  default_accent: "#222222",
});
const invoice = (): InvoiceDocInput => ({
  number: "GLOBAL-001",
  status: "draft",
  currency: "AED",
  tax_rate: 19,
  discount: 0,
  template: "minimal",
  accent: "#222222",
  seller_name: "International Co",
  customer_name: "Buyer",
  items: [{ description: "Service", qty: 1, unit_price: 100 }],
});

it("separates country from currency, preserves a configured zero and offers every EU member", () => {
  expect(taxRegimeFor("USD", "AE").taxLabel).toBe("VAT");
  expect(taxRegimeFor("EUR", "IN").trnLabel).toBe("GSTIN");
  expect(taxRegimeFor("INR", "DE").defaultRate).toBe(19);
  expect(taxRegimeFor("AED", "US").taxLabel).toBe("Tax");
  expect(taxRegimeFor("INR").taxLabel).toBe("GST"); // legacy history
  expect(taxRegimeFor("EUR").id).toBe("generic"); // cannot infer an EU country
  expect(defaultTaxRate("AED", 0, "DE")).toBe(0);
  expect(defaultTaxRate("USD", undefined, "FI")).toBe(25.5);
  expect(EU_COUNTRIES).toHaveLength(27);
  expect(new Set(COUNTRY_OPTIONS.map((c) => c.value)).size).toBe(COUNTRY_OPTIONS.length);
});

it("accepts Indian and EU tax identifiers, while retaining UAE format checks", async () => {
  expect(taxIdError("27ABCDE1234F1Z5", "IN")).toBe("");
  expect(taxIdError("DE123456789", "DE")).toBe("");
  expect(taxIdError("123", "AE")).toContain("15 digits");
  expect(taxIdError("invalid", "IN")).toContain("GSTIN");
  await billing.saveCompany({ ...company("IN", 18), trn: "27ABCDE1234F1Z5" });
  expect((await billing.getCompany()).country_code).toBe("IN");
  await expect(billing.saveCompany({ ...company("AE", 5), trn: "bad" })).rejects.toThrow(
    "15 digits"
  );
  await expect(billing.saveCompany(company("EU", 20))).rejects.toThrow("supported");
  await expect(billing.saveCompany(company("DE", Infinity))).rejects.toThrow("between");
});

it("keeps saved jurisdiction and PDF labels after a company or currency change", async () => {
  await billing.saveCompany(company("DE", 19));
  const id = await billing.saveDoc(invoice());
  let doc = await billing.getDoc(id);
  expect(doc.tax_country_code).toBe("DE");
  await billing.saveCompany(company("IN", 18));
  await billing.saveDoc({ ...doc, currency: "INR", fx_rate: 0.04 });
  doc = await billing.getDoc(id);
  expect(doc.tax_country_code).toBe("DE");
  expect(doc.tax_rate).toBe(19);
  await expect(billing.saveDoc({ ...doc, template:"uae-standard" })).rejects.toThrow("general document template");
  const html = renderToStaticMarkup(
    <DocView form={{ ...doc, seller_trn: "DE123456789" }} />
  );
  expect(html).toContain("VAT");
  expect(html).not.toContain("GSTIN");
  const xml = { ...doc, tax_country_code: "IN" };
  expect(validateEInvoice(xml).errors.join(" ")).toContain("UAE tax document");
  expect(() => buildInvoiceXml(xml)).toThrow("UAE tax document");
});

it("preserves accepted quote jurisdiction, mixed line rates, discounts and rounding on conversion", async () => {
  await billing.saveCompany(company("DE", 19));
  const quoteId = await quotes.saveDoc({
    number: "Q-GLOBAL",
    status: "draft",
    template: "minimal",
    accent: "#222222",
    currency: "AED",
    customer_name: "Buyer",
    tax_rate: 19,
    discount: 10,
    round_off: true,
    items: [
      { product: "Service", qty: 1, rate: 100, discount: 10, tax: 7 },
      { product: "Goods", qty: 2, rate: 50, discount: 0, tax: 19 },
    ],
  });
  expect((await quotes.getDoc(quoteId)).tax_country_code).toBe("DE");
  const expected = (await quotes.listDocs()).find((q) => q.id === quoteId)!.total;
  expect(expected).toBe(204); // 180 net + 25.3 tax scaled by 180/190, rounded
  await billing.saveCompany(company("AE", 5));
  await quotes.convertToInvoice(quoteId);
  const converted = (await billing.listDocs()).find((i) => i.customer_name === "Buyer")!;
  const doc = await billing.getDoc(converted.id);
  expect(doc.tax_country_code).toBe("DE");
  expect(doc.tax_rate).toBe(19);
  expect(converted.total).toBe(expected);
});

it("snapshots the country for purchase orders and receipts through the shared APIs", async () => {
  await billing.saveCompany(company("IN", 0));
  const po = await pos.save({
    po_number: "PO-IN",
    tax_rate:18, discount:10, total:999,
    status: "draft",
    order_date: "2026-09-06",
    currency: "AED",
    items: [{ description: "Part", quantity: 1, unit_cost: 100 }],
  } as Parameters<typeof pos.save>[0]);
  expect((await pos.get(po)).tax_country_code).toBe("IN");
  expect((await pos.get(po)).total).toBe(106.2); // 90 net + 18% tax, ignoring stale total
  const receipt = await receipts.save({
    number: "R-IN",
    status: "issued",
    template: "receipt",
    accent: "#222222",
    currency: "AED",
    customer_name: "Buyer",
    amount: 100,
  });
  expect((await receipts.get(receipt)).tax_country_code).toBe("IN");
});
