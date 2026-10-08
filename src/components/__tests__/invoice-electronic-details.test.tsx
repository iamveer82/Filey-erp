import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoicePartyDetails, InvoicePartyLocation, InvoiceLineDetails, InvoiceAdditionalDetails, supportsInvoiceDetails } from "../InvoiceElectronicDetails";
import InvoiceExportSheet from "../InvoiceExportSheet";
import { EMPTY_BANK } from "../BankDetails";
import { templatesForDocType } from "../DocTemplates";
import type { DocViewForm } from "../DocView";
import { PINT_AE_PROCESS_ID, PINT_AE_SPEC_IDENTIFIER } from "../../lib/einvoice";

vi.mock("../../lib/customTemplates", () => ({ useCustomTemplates: () => ({ loading: false, templates: [
  { id: "custom-electronic-file", name: "Custom letterhead", type: "file", layout: "minimal", accent: "#222", font: "Arial", paperSize: "A4", fileData: "data:image/png;base64,AA==", fileType: "image", positions: { seller: { x: 6, y: 6 }, header: { x: 60, y: 6 }, customer: { x: 6, y: 28 }, items: { x: 6, y: 45 }, totals: { x: 60, y: 70 }, footer: { x: 6, y: 80 } } },
  { id: "custom-electronic-builder", name: "Custom layout", type: "builder", layout: "corporate", accent: "#222", font: "Arial", paperSize: "A4" },
] }) }));
const fixture: DocViewForm = {
  doc_type: "invoice", template: "minimal", currency: "AED", tax_country_code: "AE", number: "INV-EXAMPLE-19",
  invoice_type_code: "381", issue_date: "2026-10-08", due_date: "2026-11-08", date_of_supply: "2026-10-07",
  original_invoice_number: "INV-EXAMPLE-18", original_invoice_date: "2026-10-06", po_number: "PO-9", po_date: "2026-09-30",
  transaction_type: "10000001", payment_means_code: "30", seller_name: "Example Seller", seller_address: "1 Example Road", seller_city: "Dubai",
  seller_phone: "+971 50 111 2233", seller_email: "accounts@example-seller.test", customer_email: "billing@example-buyer.test",
  seller_country_subdivision: "DXB", seller_trn: "100000000000003", customer_name: "Example Buyer", customer_address: "2 Example Street", buyer_city: "Muscat", buyer_country_subdivision: "Muscat", buyer_country_code: "OM",
  customer_trn: "200000000000003", tax_rate: 5, advance_applied: 100,
  unit_price_formula: { a: "litres", b: "unit_price" },
  einvoice: {
    uuid: "c20c7de3-f574-4bfb-b03d-ff1e2a9a0e81", credit_reason: "DL8.61.1.C", beneficiary_id: "1009999999",
    payment_account_id: "AE070331234567890123456", payment_account_name: "Snapshot payee", buyer_delivery_mode: "export-unregistered",
    delivery: { address: "3 Delivery Road", city: "Muscat", region: "Muscat Governorate", country_code: "OM" },
    seller: { corporate_trn: "100123456700003", tin: "1001234567", endpoint_id: "1001234567", endpoint_scheme: "0235", legal_id: "SELLER-TL", legal_id_type: "TL", legal_authority: "Example Authority" },
    buyer: { corporate_trn: "200123456700003", tin: "2001234567", identifier: "BUYER-REF", legal_id: "BUYER-TL", legal_id_type: "TL", legal_authority: "Buyer Authority", phone: "+968 9123 4567" },
  },
  items: [
    { description: "Hydraulic oil", qty: 50, unit: "L", unit_price: 0.2, custom: { litres: "1000", einvoice_item_type: "G", einvoice_hs_code: "271019" }, tax_category: "S" },
    { description: "Engine oil 15W40", qty: 15, unit: "L", unit_price: 4.1, custom: { litres: "300", einvoice_item_type: "B", einvoice_hs_code: "271019", einvoice_service_code: "9987" }, tax_category: "S" },
    { description: "Engine oil 20W50", qty: 15, unit: "L", unit_price: 4.1, custom: { litres: "300", einvoice_item_type: "S", einvoice_service_code: "9988", einvoice_exemption_code: "DL8.46.1", einvoice_nature: "DL8.48.3.1", einvoice_gtin: "6291041500213" }, tax_category: "S" },
  ],
};
const renderDetails = (form = fixture) => renderToStaticMarkup(<>
  <InvoicePartyLocation form={form} party="seller" /><InvoicePartyLocation form={form} party="buyer" />
  <InvoicePartyDetails form={form} party="seller" /><InvoicePartyDetails form={form} party="buyer" />
  {form.items.map((item, index) => <InvoiceLineDetails key={index} form={form} item={item} />)}
  <InvoiceAdditionalDetails form={form} />
</>);
const content = (html: string) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.textContent || "";
};

describe("inline e-invoice details", () => {
  it("keeps all entered identities, references and line classifications inside the current invoice sheet on every layout", () => {
    const layouts = [...templatesForDocType("invoice").map(template => template.id), "custom-electronic-file", "custom-electronic-builder"];
    for (const template of layouts) {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(<InvoiceExportSheet form={{ ...fixture, template }} bank={EMPTY_BANK} />);
      const actual = host.textContent || "";
      for (const expected of ["INV-EXAMPLE-18", "DL8.61.1.C", "AE070331234567890123456", "Snapshot payee", "1009999999", "3 Delivery Road", "Muscat Governorate", "100123456700003", "1001234567", "SELLER-TL", "Example Authority", "BUYER-TL", "Buyer Authority", "BUYER-REF", "0235", "271019", "9987", "9988", "DL8.46.1", "DL8.48.3.1", "6291041500213", fixture.einvoice!.uuid!]) {
        expect(actual, `${template}: ${expected}`).toContain(expected);
      }
      expect(host.querySelectorAll("[data-einvoice-details-sheet]"), template).toHaveLength(0);
      expect(host.querySelectorAll(".invoice-print"), template).toHaveLength(1);
      expect(actual, template).toMatch(/2026-10-06|06 Oct 2026/);
      expect(actual, template).not.toContain("Electronic invoice details");
      expect(actual, template).not.toContain(PINT_AE_PROCESS_ID);
      expect(actual, template).not.toContain(PINT_AE_SPEC_IDENTIFIER);
      expect(actual, template).not.toContain("FTA approved");
      expect(actual, template).toContain(`Preparation UUID: ${fixture.einvoice!.uuid}`);
      for (const contact of [fixture.seller_phone!, fixture.seller_email!, fixture.customer_email!, fixture.einvoice!.buyer!.phone!]) {
        expect(actual.split(contact).length - 1, `${template}: ${contact} printed once`).toBe(1);
      }
      for (const fields of [
        [fixture.seller_address!, fixture.seller_trn!, fixture.seller_phone!, fixture.seller_email!, "SELLER-TL"],
        [fixture.customer_address!, fixture.customer_trn!, fixture.einvoice!.buyer!.phone!, fixture.customer_email!, "BUYER-TL"],
      ]) {
        const positions = fields.map(field => actual.indexOf(field));
        expect(positions, `${template}: address, TRN, phone, email, ID`).toEqual([...positions].sort((a, b) => a - b));
      }
    }
  });

  it("prints only explicitly entered party fields without deriving placeholder endpoints or TINs", () => {
    const form = { ...fixture, seller_city: "", seller_country_subdivision: "", buyer_country_code: "",
      einvoice: { seller: { corporate_trn: "100123456700003" }, buyer_delivery_mode: "export-unregistered" as const },
    };
    const html = content(renderDetails(form));
    expect(html).toContain("Own FTA TRN: 100123456700003");
    expect(html).not.toMatch(/\bTIN:/);
    expect(html).not.toContain("9900000099");
    expect(html).not.toContain("0235");
    expect(html).not.toContain("Electronic address:");
    expect(content(renderToStaticMarkup(<InvoicePartyDetails form={form} party="seller" />))).not.toContain("AE");
    const simple: DocViewForm = { doc_type: "invoice", currency: "AED", items: [] };
    expect(renderDetails(simple)).toBe("");
  });

  it("keeps a saved legal identity and scheme without replacing them with inferred values", () => {
    const form = { ...fixture, seller_legal_id: "SAVED-LEGAL-ID", seller_legal_id_type: "EID" };
    const actual = content(renderToStaticMarkup(<InvoicePartyDetails form={form} party="seller" />));
    expect(actual).toContain("Legal registration: SAVED-LEGAL-ID · EID");
    expect(actual).not.toContain("SELLER-TL");
    expect(actual).toContain("Electronic address: 1001234567 · Scheme 0235");
  });

  it("keeps saved location in the address block and hides blank or invalid locations", () => {
    expect(content(renderToStaticMarkup(<InvoicePartyLocation form={fixture} party="seller" />))).toBe("Dubai");
    expect(content(renderToStaticMarkup(<InvoicePartyLocation form={fixture} party="buyer" />))).toBe("Muscat · OM");
    expect(content(renderToStaticMarkup(<InvoicePartyDetails form={fixture} party="buyer" />))).not.toContain("Muscat");
    const malformed = { ...fixture, seller_city: {}, seller_country_subdivision: 123, buyer_city: " ", buyer_country_subdivision: [], buyer_country_code: null } as unknown as DocViewForm;
    expect(renderToStaticMarkup(<InvoicePartyLocation form={malformed} party="seller" />)).toBe("");
    expect(renderToStaticMarkup(<InvoicePartyLocation form={malformed} party="buyer" />)).toBe("");
  });

  it("uses canonical formula calculations without duplicating quantities or XML unit-price tables", () => {
    const actual = content(renderDetails(fixture));
    expect(actual).toContain("VAT 5%: 10.00 AED");
    expect(actual).toContain("Incl. VAT: 210.00 AED");
    expect(actual).toContain("VAT 5%: 61.50 AED");
    expect(actual).toContain("Incl. VAT: 1291.50 AED");
    expect(actual).not.toContain("XML unit price");
    expect(actual).not.toContain("Quantity / unit / price");
    const foreign = { ...fixture, currency: "USD", aed_exchange_rate: 3.67, fx_rate: 1 };
    const foreignHtml = content(renderDetails(foreign));
    expect(foreignHtml).toContain("VAT total in AED: 488.11 AED");
    expect(foreignHtml).toContain("VAT in AED: 36.70 AED");
    expect(foreignHtml).toContain("VAT in AED: 225.71 AED");
    expect(foreignHtml).toContain("1 USD = 3.67 AED");
    expect(foreignHtml).not.toContain("Total including VAT in AED");
  });

  it("does not duplicate line VAT columns already shown by the selected template", () => {
    const html = content(renderToStaticMarkup(<InvoiceLineDetails form={fixture} item={fixture.items[0]} omitTaxAmounts />));
    expect(html).toContain("HS: 271019");
    expect(html).not.toContain("VAT 5%");
    expect(html).not.toContain("Incl. VAT");
    const exempt = { ...fixture.items[0], tax_category: "E" };
    expect(content(renderToStaticMarkup(<InvoiceLineDetails form={fixture} item={exempt} omitTaxAmounts />))).toContain("VAT: E · Exempt · 0%");
  });

  it("allows templates to omit references, rate and payment account already printed elsewhere", () => {
    const foreign = { ...fixture, currency: "USD", aed_exchange_rate: 3.67 };
    const actual = content(renderToStaticMarkup(<InvoiceAdditionalDetails form={foreign} omit={["purchaseOrder", "supplyDate", "originalInvoice", "paymentAccount", "exchangeRate"]} />));
    for (const omitted of ["PO-9", "2026-10-07", "INV-EXAMPLE-18", "Snapshot payee", "AE070331234567890123456", "1 USD ="]) expect(actual).not.toContain(omitted);
    expect(actual).toContain("VAT total in AED: 488.11 AED");
    expect(actual).toContain("DL8.61.1.C");
    expect(actual).toContain(fixture.einvoice!.uuid!);
  });

  it("respects a custom layout's hidden-tax setting while retaining entered classifications", () => {
    const foreign = { ...fixture, currency: "USD", aed_exchange_rate: 3.67 };
    const line = content(renderToStaticMarkup(<InvoiceLineDetails form={foreign} item={fixture.items[2]} hideTax />));
    expect(line).toContain("Service code: 9988");
    expect(line).toContain("GTIN: 6291041500213");
    expect(line).not.toContain("VAT");
    expect(line).not.toContain("Reverse charge");
    const additional = content(renderToStaticMarkup(<InvoiceAdditionalDetails form={foreign} hideTax />));
    expect(additional).not.toContain("VAT total");
    expect(additional).toContain("1 USD = 3.67 AED");
    expect(additional).toContain(fixture.einvoice!.uuid!);
  });

  it("preserves long and non-Latin values with wrapping rather than clipping or adding an appendix", () => {
    const address = "界".repeat(1000) + "\n" + "W".repeat(1000);
    const form = { ...fixture, einvoice: { ...fixture.einvoice, delivery: { address } } };
    const html = renderToStaticMarkup(<InvoiceAdditionalDetails form={form} />);
    expect(content(html)).toContain(address);
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).not.toContain("overflow:hidden");
    expect(html).not.toMatch(/[;" ]height:/);
  });

  it("leaves other document types and tax regimes on their existing rendering path", () => {
    for (const doc_type of ["quotation", "quote", "receipt", "payment_receipt", "purchase_order"]) {
      expect(supportsInvoiceDetails({ ...fixture, doc_type })).toBe(false);
      expect(renderDetails({ ...fixture, doc_type })).toBe("");
    }
    expect(renderDetails({ ...fixture, tax_country_code: "IN" })).toBe("");
    expect(supportsInvoiceDetails({ ...fixture, currency: "AED", tax_country_code: "IN" })).toBe(false);
    expect(supportsInvoiceDetails({ ...fixture, currency: "USD", tax_country_code: "AE" })).toBe(true);
    for (const doc_type of ["Tax Invoice", "sales", "Credit Note", "invoice"]) expect(supportsInvoiceDetails({ ...fixture, doc_type })).toBe(true);
  });

  it("ignores malformed legacy metadata without crashing or printing object identifiers", () => {
    const malformed = { seller: { tin: 123, corporate_trn: {}, endpoint_id: 456 }, buyer: { tin: [], endpoint_id: 789 }, payment_account_id: { value: "not an account" }, delivery: { address: {} } };
    const form = { ...fixture, einvoice: malformed as unknown as DocViewForm["einvoice"], items: [{ ...fixture.items[0], custom: { einvoice_hs_code: {}, einvoice_item_type: [] } as unknown as Record<string, string> }] };
    expect(() => renderDetails(form)).not.toThrow();
    const actual = content(renderDetails(form));
    for (const absent of ["[object Object]", "TIN:", "Electronic address:", "Payment account:", "HS:"]) expect(actual).not.toContain(absent);
    const unknownType = content(renderToStaticMarkup(<InvoiceLineDetails form={fixture} item={{ ...fixture.items[0], custom: { einvoice_item_type: "constructor" } }} />));
    expect(unknownType).toContain("Type: constructor");
    expect(unknownType).not.toContain("function Object");
  });

  it("prints the saved payment snapshot rather than a different current company account", () => {
    const html = renderToStaticMarkup(<InvoiceExportSheet form={{ ...fixture, show_bank: true }} bank={{ ...EMPTY_BANK, iban: "CURRENT-DIFFERENT-IBAN", account_number: "OTHER-ACCOUNT", bank_name: "Other Bank", account_name: "Other Payee" }} />);
    expect(html).toContain(fixture.einvoice!.payment_account_id!);
    expect(html).toContain("Snapshot payee");
    expect(html).not.toContain("CURRENT-DIFFERENT-IBAN");
    expect(html).not.toContain("OTHER-ACCOUNT");
    expect(html).not.toContain("Other Bank");
  });

  it("escapes entered identifiers and inherits dark-template colors", () => {
    const html = renderToStaticMarkup(<InvoicePartyDetails form={{ ...fixture, einvoice: { buyer: { legal_id: '<img src=x onerror="alert(1)">' } } }} party="buyer" />);
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).toContain("color:inherit");
    expect(html).not.toContain("#171717");
  });
});
