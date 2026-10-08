import { expect, it } from "vitest";
import { companyInvoiceSeller, fillMissingInvoiceSeller, syncInvoiceSellerPreset } from "../invoiceSeller";
import { buildInvoiceXml, eInvoiceIssues, type EInvoiceDoc } from "../einvoiceXml";
import type { CompanyProfile } from "../api";

const company: CompanyProfile = {
  name: "Fixture seller", address: "Office 1", city: "Dubai", country_subdivision: "DXB", country_code: "AE",
  trn: "100123456700003", email: "seller@example.test", phone: "+971 50 111 2222", currency: "AED",
  legal_id: "LICENCE-1", legal_id_type: "TL", default_template: "minimal", default_accent: "#111111",
  einvoice: { tin: "1001234567", legal_authority: "Dubai Economy" },
};
const draft = () => ({
  status: "draft", seller_name: company.name, seller_trn: company.trn,
  seller_address: "Manual address", seller_city: "", seller_legal_id: "MANUAL-LICENCE",
  einvoice: { uuid: "043f57ea-7f50-4c75-94c6-694fd2f67bad", buyer: { tin: "1007774567" },
    seller: { endpoint_id: "1008888888", legal_authority: "Manual authority" }, payment_account_id: "SAVED-ACCOUNT" },
});

it("fills missing seller fields without changing invoice overrides, buyer routing, UUID or payment snapshot", () => {
  const original = draft();
  const filled = fillMissingInvoiceSeller(original, company);
  expect(filled).toMatchObject({ seller_address: "Manual address", seller_city: "Dubai", seller_country_subdivision: "DXB",
    seller_legal_id: "MANUAL-LICENCE", seller_legal_id_type: "TL", seller_email: company.email,
    einvoice: { uuid: original.einvoice.uuid, buyer: original.einvoice.buyer, payment_account_id: "SAVED-ACCOUNT",
      seller: { tin: "1001234567", endpoint_id: "1008888888", legal_id: "MANUAL-LICENCE", legal_authority: "Manual authority" } } });
  expect(original).toEqual(draft());
});

it("preserves a manual registration saved only in the nested identity", () => {
  const filled = fillMissingInvoiceSeller({ ...draft(), seller_legal_id: "", einvoice: { seller: { legal_id: "NESTED-MANUAL", legal_id_type: "CD" } } }, company);
  expect(filled).toMatchObject({ seller_legal_id: "NESTED-MANUAL", seller_legal_id_type: "CD",
    einvoice: { seller: { legal_id: "NESTED-MANUAL", legal_id_type: "CD" } } });
});

it("retains legacy company registration presets when the newer fields are blank", () => {
  expect(companyInvoiceSeller({ ...company, trn: "", vat_number: company.trn, legal_id: " ", legal_id_type: "",
    einvoice: { legal_id: "LEGACY-ID", legal_id_type: "CD" } })).toMatchObject({
    seller_trn: company.trn, seller_legal_id: "LEGACY-ID", seller_legal_id_type: "CD",
    einvoice: { seller: { legal_id: "LEGACY-ID", legal_id_type: "CD" } },
  });
});

it("refuses to enrich an issued invoice or mix another seller's profile", () => {
  expect(() => fillMissingInvoiceSeller({ ...draft(), status: "sent" }, company)).toThrow("draft");
  expect(() => fillMissingInvoiceSeller({ ...draft(), seller_trn: "100999456700003" }, company)).toThrow("different seller");
  expect(() => fillMissingInvoiceSeller({ ...draft(), seller_trn: "", seller_name: "Other company" }, company)).toThrow("different seller");
  expect(() => fillMissingInvoiceSeller({ ...draft(), seller_name: "Other VAT group member" }, company)).toThrow("different seller");
  expect(() => fillMissingInvoiceSeller({ ...draft(), einvoice: { seller: { tin: "1009999999" } } }, company)).toThrow("different seller");
});

it("syncs only unchanged draft defaults when company settings are saved and leaves issued snapshots intact", () => {
  const original = { ...companyInvoiceSeller(company), status: "draft", seller_address: "Manual address", seller_email: "",
    einvoice: { ...companyInvoiceSeller(company).einvoice, uuid: "saved-uuid", seller: { ...company.einvoice, endpoint_id: "MANUAL-ENDPOINT" } } };
  const changed = { ...company, address: "New office", city: "Abu Dhabi", email: "new@example.test", einvoice: { ...company.einvoice, tin: "1000000000" } };
  expect(syncInvoiceSellerPreset(original, company, changed)).toMatchObject({ seller_address: "Manual address", seller_email: "", seller_city: "Abu Dhabi",
    einvoice: { uuid: "saved-uuid", seller: { endpoint_id: "MANUAL-ENDPOINT", tin: "1000000000" } } });
  const issued = { ...original, status: "sent" };
  expect(syncInvoiceSellerPreset(issued, company, changed)).toBe(issued);
  expect(syncInvoiceSellerPreset({ ...original, seller_legal_id: "MANUAL-LICENCE" }, company, { ...changed, legal_id: "NEW-PRESET" }))
    .toMatchObject({ seller_legal_id: "MANUAL-LICENCE", einvoice: { seller: { legal_id: "MANUAL-LICENCE" } } });
});

it("uses saved company identity in the exact snapshot checked and exported as XML", () => {
  const doc: EInvoiceDoc = { ...companyInvoiceSeller(company), number: "INV-PRESET", issue_date: "2026-10-08", due_date: "2026-10-08",
    currency: "AED", invoice_type_code: "380", transaction_type: "00000000", payment_means_code: "10", discount: 0, tax_rate: 5,
    customer_name: "Fixture buyer", customer_address: "Office 2", buyer_city: "Dubai", buyer_country_subdivision: "DXB", buyer_country_code: "AE",
    customer_trn: "100777456700003", einvoice: { ...companyInvoiceSeller(company).einvoice, uuid: draft().einvoice.uuid, buyer: { tin: "1007774567" } },
    items: [{ description: "Work", qty: 1, unit_price: 100, unit: "HUR", tax_category: "S", custom: { einvoice_item_type: "S", einvoice_service_code: "9983" } }] };
  expect(eInvoiceIssues(doc).filter(issue => /^(seller_|einvoice\.seller)/.test(issue.field))).toEqual([]);
  const xml = buildInvoiceXml(doc);
  expect(xml).toContain("Fixture seller");
  expect(xml).toContain("LICENCE-1");
  expect(xml).toContain("Dubai Economy");
  expect(xml).toContain("1001234567");
  expect(xml).toContain("Office 1");
});
