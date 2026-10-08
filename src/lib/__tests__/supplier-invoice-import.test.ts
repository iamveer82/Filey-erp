import { beforeEach, expect, test, vi } from "vitest";
import { billing, type InvoiceDocInput } from "../api";
import { setDataMode } from "../dataMode";
import { buildInvoiceXml } from "../einvoiceXml";
import { invoiceImportIssues, readSupplierInvoice } from "../invoiceImport";
import { getExchangeRates } from "../exchange-rates";

vi.mock("../exchange-rates", async (original) => ({
  ...await original<typeof import("../exchange-rates")>(),
  getExchangeRates: vi.fn(async () => ({ AED: 1, EUR: 4.5 })),
}));

const base = (): InvoiceDocInput => ({
  number: "", customer_name: "", seller_name: "Our company", status: "draft",
  template: "corporate", accent: "#222222", currency: "AED", issue_date: "2026-09-29",
  tax_country_code: "AE", tax_rate: 5, discount: 0, buyer_country_code: "AE",
  einvoice: { seller: { tin: "1007774567", legal_id: "OUR-LICENCE", legal_authority: "Dubai Economy" } }, items: [],
});
const source = (): InvoiceDocInput => ({
  ...base(), number: "SUPPLIER-EUR-1", seller_name: "Demo supplier", customer_name: "Our company",
  currency: "EUR", fx_rate: 4, aed_exchange_rate: 4, due_date: "2026-10-29", payment_means_code: "10",
  seller_address: "Office 1", seller_city: "Dubai", seller_country_subdivision: "DXB",
  seller_legal_id: "SUPPLIER-LICENCE", seller_legal_id_type: "TL", seller_trn: "100000000000003",
  seller_email: "supplier@example.test", seller_phone: "+971501234567",
  customer_address: "Office 2", buyer_city: "Dubai", buyer_country_subdivision: "DXB",
  einvoice: { uuid: "3b3f28b1-0fc5-47b8-aa51-bfe9d57ab64c",
    seller: { tin: "1000000000", legal_authority: "Dubai Economy", identifier: "SUPPLIER-ID" },
    buyer: { tin: "1007774567" } },
  items: [{ description: "Service", qty: 1, unit_price: 100 }],
});

beforeEach(() => { localStorage.clear(); setDataMode("local"); vi.clearAllMocks(); });

test("supplier XML retains its original AED conversion through a local save", async () => {
  const imported = readSupplierInvoice(buildInvoiceXml(source()), { ...base(), fx_rate: 9, aed_exchange_rate: 9 });
  expect(invoiceImportIssues(imported, new Set())).toEqual([]);
  expect(imported).toMatchObject({ currency: "EUR", fx_rate: 4, aed_exchange_rate: 4 });
  const id = await billing.saveDoc(imported);
  expect(await billing.getDoc(id)).toMatchObject({ currency: "EUR", fx_rate: 4, aed_exchange_rate: 4 });
  expect(getExchangeRates).not.toHaveBeenCalled();
});

test("supplier XML preserves foreign locations and routing without inventing a UAE TIN", () => {
  const xml = buildInvoiceXml(source())
    .replace('<cbc:EndpointID schemeID="0235">1000000000', '<cbc:EndpointID schemeID="0088">1234567890123')
    .replace("<cbc:CityName>Dubai", "<cbc:CityName>Berlin")
    .replace("<cbc:CountrySubentity>DXB", "<cbc:CountrySubentity>BE")
    .replace("<cbc:IdentificationCode>AE", "<cbc:IdentificationCode>DE")
    .replace("<cbc:StreetName>Office 1</cbc:StreetName>", "<cbc:StreetName>Office 1</cbc:StreetName><cbc:AdditionalStreetName>Building 2</cbc:AdditionalStreetName><cac:AddressLine><cbc:Line>Floor 3</cbc:Line></cac:AddressLine>");
  expect(readSupplierInvoice(xml, base())).toMatchObject({
    customer_address: "Office 1, Building 2, Floor 3", buyer_city: "Berlin", buyer_country_subdivision: "BE", buyer_country_code: "DE",
    einvoice: { buyer: { tin: "", endpoint_scheme: "0088", endpoint_id: "1234567890123" } },
  });
});

test("commercial supplier TIN and legacy emirate are retained without a VAT registration", () => {
  const document = source();
  const xml = buildInvoiceXml({ ...document, invoice_type_code: "480", seller_trn: "",
    einvoice: { ...document.einvoice, buyer: { ...document.einvoice?.buyer, legal_id: "OUR-LICENCE", legal_id_type: "TL", legal_authority: "Dubai Economy" } },
    items: [{ description: "Service", qty: 1, unit_price: 100, tax_category: "O" }] })
    .replace("<cbc:CountrySubentity>DXB", "<cbc:CountrySubentity>AE-DU");
  expect(readSupplierInvoice(xml, base())).toMatchObject({
    customer_trn: "", buyer_country_subdivision: "DXB", einvoice: { buyer: { tin: "1000000000" } },
  });
});

test("supplier identity is imported into the purchase counterparty, preserving our company snapshot", () => {
  const originalBase = base();
  const imported = readSupplierInvoice(buildInvoiceXml(source()), originalBase);
  expect(imported).toMatchObject({
    doc_type: "purchase", seller_name: "Our company", customer_name: "Demo supplier",
    customer_address: "Office 1", customer_email: "supplier@example.test", customer_trn: "100000000000003",
    buyer_city: "Dubai", buyer_country_subdivision: "DXB", buyer_country_code: "AE",
    einvoice: { seller: originalBase.einvoice!.seller, buyer: {
      tin: "1000000000", endpoint_id: "1000000000", endpoint_scheme: "0235", identifier: "SUPPLIER-ID",
      legal_id: "SUPPLIER-LICENCE", legal_id_type: "TL", legal_authority: "Dubai Economy", phone: "+971501234567",
    } },
  });
  expect(imported.einvoice?.uuid).toBeUndefined();
  expect(originalBase.einvoice).toEqual({ seller: { tin: "1007774567", legal_id: "OUR-LICENCE", legal_authority: "Dubai Economy" } });
});

test("AED imports clear unrelated conversion rates and do not inherit an old recipient", () => {
  const xml = buildInvoiceXml({ ...source(), currency: "AED", fx_rate: undefined, aed_exchange_rate: undefined });
  const imported = readSupplierInvoice(xml, { ...base(), fx_rate: 9, aed_exchange_rate: 9, customer_id: 123,
    einvoice: { ...base().einvoice, uuid: crypto.randomUUID(), buyer: { tin: "STALE" }, buyer_delivery_mode: "outside-uae-scope" } });
  expect(imported.fx_rate).toBeNull();
  expect(imported.aed_exchange_rate).toBeNull();
  expect(imported.customer_id).toBeUndefined();
  expect(imported.einvoice?.uuid).toBeUndefined();
  expect(imported.einvoice?.buyer_delivery_mode).toBeUndefined();
});

test.each([
  ["missing exchange rate", (xml: string) => xml.replace(/\s*<cac:TaxExchangeRate>[\s\S]*?<\/cac:TaxExchangeRate>/, "")],
  ["wrong currency pair", (xml: string) => xml.replace("<cbc:TargetCurrencyCode>AED", "<cbc:TargetCurrencyCode>USD")],
  ["non-positive rate", (xml: string) => xml.replace("<cbc:CalculationRate>4", "<cbc:CalculationRate>0")],
  ["non-numeric rate", (xml: string) => xml.replace("<cbc:CalculationRate>4", "<cbc:CalculationRate>NaN")],
  ["excessive decimal precision", (xml: string) => xml.replace("<cbc:CalculationRate>4", "<cbc:CalculationRate>4.1234567")],
  ["unsafe AED amounts", (xml: string) => xml.replace("<cbc:CalculationRate>4", "<cbc:CalculationRate>1000000000000000")],
  ["duplicate exchange rates", (xml: string) => xml.replace(/(<cac:TaxExchangeRate>[\s\S]*?<\/cac:TaxExchangeRate>)/, "$1$1")],
  ["inconsistent AED VAT", (xml: string) => xml.replace('<cbc:TaxAmount currencyID="AED">20.00', '<cbc:TaxAmount currencyID="AED">99.00')],
] as const)("rejects %s instead of silently changing the supplier's AED amounts", (_label, alter) => {
  expect(() => readSupplierInvoice(alter(buildInvoiceXml(source())), base())).toThrow(/AED|exchange rate/);
});
