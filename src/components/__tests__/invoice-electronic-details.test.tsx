import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { invoiceElectronicDetailPages, InvoiceElectronicDetailsPage, ELECTRONIC_DETAIL_ROWS_PER_PAGE, ELECTRONIC_DETAIL_ROW_HEIGHT } from "../InvoiceElectronicDetails";
import InvoiceExportSheet from "../InvoiceExportSheet";
import { EMPTY_BANK } from "../BankDetails";
import { templatesForDocType } from "../DocTemplates";
import type { DocViewForm } from "../DocView";
import { PINT_AE_PROCESS_ID, PINT_AE_SPEC_IDENTIFIER } from "../../lib/einvoice";

vi.mock("../../lib/customTemplates", () => ({ useCustomTemplates: () => ({ loading: false, templates: [
  { id: "custom-electronic-file", name: "Custom letterhead", type: "file", layout: "minimal", accent: "#222", font: "Arial", paperSize: "A4", fileData: "data:image/png;base64,AA==", fileType: "image", positions: { footer: { x: 6, y: 88 } } },
  { id: "custom-electronic-builder", name: "Custom layout", type: "builder", layout: "corporate", accent: "#222", font: "Arial", paperSize: "A4" },
] }) }));

const fixture: DocViewForm = {
  doc_type: "invoice", template: "minimal", currency: "AED", tax_country_code: "AE", number: "INV-EXAMPLE-19",
  invoice_type_code: "381", issue_date: "2026-10-08", due_date: "2026-11-08", date_of_supply: "2026-10-07",
  original_invoice_number: "INV-EXAMPLE-18", original_invoice_date: "2026-10-06", po_number: "PO-9", po_date: "2026-09-30",
  transaction_type: "10000001", payment_means_code: "30", seller_name: "Example Seller", seller_address: "1 Example Road", seller_city: "Dubai",
  seller_country_subdivision: "DXB", seller_trn: "100000000000003", customer_name: "Example Buyer", customer_address: "2 Example Street", buyer_city: "Muscat", buyer_country_subdivision: "Muscat", buyer_country_code: "OM",
  customer_trn: "200000000000003", tax_rate: 5, advance_applied: 100,
  unit_price_formula: { a: "litres", b: "unit_price" },
  einvoice: {
    uuid: "c20c7de3-f574-4bfb-b03d-ff1e2a9a0e81", credit_reason: "DL8.61.1.C", beneficiary_id: "1009999999",
    payment_account_id: "AE070331234567890123456", payment_account_name: "Snapshot payee", buyer_delivery_mode: "export-unregistered",
    delivery: { address: "3 Delivery Road", city: "Muscat", region: "Muscat Governorate", country_code: "OM" },
    seller: { corporate_trn: "100123456700003", tin: "1001234567", endpoint_id: "1001234567", endpoint_scheme: "0235", legal_id: "SELLER-TL", legal_id_type: "TL", legal_authority: "Example Authority" },
    buyer: { corporate_trn: "200123456700003", tin: "2001234567", identifier: "BUYER-REF", legal_id: "BUYER-TL", legal_id_type: "TL", legal_authority: "Buyer Authority" },
  },
  items: [
    { description: "Hydraulic oil", qty: 50, unit: "L", unit_price: 0.2, custom: { litres: "1000", einvoice_item_type: "G", einvoice_hs_code: "271019" }, tax_category: "S" },
    { description: "Engine oil 15W40", qty: 15, unit: "L", unit_price: 4.1, custom: { litres: "300", einvoice_item_type: "B", einvoice_hs_code: "271019", einvoice_service_code: "9987" }, tax_category: "S" },
    { description: "Engine oil 20W50", qty: 15, unit: "L", unit_price: 4.1, custom: { litres: "300", einvoice_item_type: "S", einvoice_service_code: "9988", einvoice_exemption_code: "DL8.46.1", einvoice_nature: "DL8.48.3.1", einvoice_gtin: "6291041500213" }, tax_category: "S" },
  ],
};
const rows = (form = fixture) => invoiceElectronicDetailPages(form).flat();
const value = (name: string, form = fixture) => rows(form).filter(row => row.label === name).map(row => row.value);

describe("readable e-invoice details", () => {
  it("prints saved identities, scenario/payment references and complete line classifications on every layout", () => {
    const layouts = [...templatesForDocType("invoice").map(template => template.id), "custom-electronic-file", "custom-electronic-builder"];
    for (const template of layouts) {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(<InvoiceExportSheet form={{ ...fixture, template }} bank={EMPTY_BANK} />);
      const details = Array.from(host.querySelectorAll("[data-einvoice-details]")).map(node => node.textContent).join("");
      for (const expected of ["INV-EXAMPLE-18", "2026-10-06", "DL8.61.1.C", "AE070331234567890123456", "Snapshot payee", "1009999999", "3 Delivery Road", "Muscat Governorate", "100123456700003", "1001234567", "SELLER-TL", "Example Authority", "BUYER-TL", "Buyer Authority", "BUYER-REF", "9900000099", "0235", "271019", "9987", "9988", "DL8.46.1", "DL8.48.3.1", "6291041500213", fixture.einvoice!.uuid!, PINT_AE_PROCESS_ID, PINT_AE_SPEC_IDENTIFIER]) {
        expect(details, `${template}: ${expected}`).toContain(expected);
      }
      expect(host.querySelectorAll("[data-einvoice-details-sheet]").length, template).toBeGreaterThan(0);
      expect(host.querySelectorAll(".invoice-print:not([data-einvoice-details-sheet])"), template).toHaveLength(1);
      expect(details, template).not.toContain("FTA approved");
    }
  });

  it("keeps entered quantities/prices distinct from XML net unit prices and uses canonical formula totals", () => {
    expect(value("Quantity / unit / price")).toEqual(["50 · L · LTR · Entered price: 0.2 AED", "15 · L · LTR · Entered price: 4.1 AED", "15 · L · LTR · Entered price: 4.1 AED"]);
    expect(value("XML unit price").map(row => row.split(" · ")[0])).toEqual(["Gross / net: 4.000000 AED", "Gross / net: 82.000000 AED", "Gross / net: 82.000000 AED"]);
    expect(value("Calculation basis")).toEqual(["litres · 1000 · × 0.2 AED", "litres · 300 · × 4.1 AED", "litres · 300 · × 4.1 AED"]);
    expect(value("Total excluding VAT")).toEqual(["2660.00 AED"]);
    expect(value("VAT total")).toEqual(["133.00 AED"]);
    expect(value("Total including VAT")).toEqual(["2793.00 AED"]);
    expect(value("Amount due")).toEqual(["2693.00 AED"]);
    const foreign = { ...fixture, currency: "USD", aed_exchange_rate: 3.67, fx_rate: 1 };
    expect(value("VAT total in AED", foreign)).toEqual(["488.11 AED"]);
    expect(value("Line VAT in AED", foreign)).toEqual(["36.70 AED", "225.71 AED", "225.71 AED"]);
    expect(value("Total including VAT in AED", foreign)).toEqual(["10250.31 AED"]);
  });

  it("preserves long values and every one of 500 lines across bounded continuation pages", () => {
    const longAddress = "界".repeat(1000) + "\n" + "W".repeat(1000);
    const form = { ...fixture, seller_address: longAddress, items: Array.from({ length: 500 }, (_, i) => ({ ...fixture.items[0], description: `Item ${i + 1} end`, custom: { litres: "1", einvoice_hs_code: `HS-${i + 1}` } })) };
    const pages = invoiceElectronicDetailPages(form);
    expect(pages.length).toBeGreaterThan(10);
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(ELECTRONIC_DETAIL_ROWS_PER_PAGE);
      expect(48 * 2 + 86 + 24 + page.length * ELECTRONIC_DETAIL_ROW_HEIGHT + 22).toBeLessThan(1123);
    }
    const all = pages.flat();
    const start = all.findIndex(row => row.label === "Street address");
    let end = start + 1;
    while (all[end]?.label === "") end++;
    expect(all.slice(start, end).map(row => row.value).join("")).toBe(longAddress);
    expect(all.filter(row => row.label === "Item name / description").map(row => row.value)).toEqual(form.items.map(item => item.description));
    expect(all.filter(row => row.label === "HS classification").map(row => row.value)).toEqual(form.items.map(item => item.custom.einvoice_hs_code));
    expect(all.filter(row => row.section && /^Line \d+$/.test(row.label))).toHaveLength(500);
  });

  it("keeps a fully identified ordinary three-line invoice within two supporting pages", () => {
    const form = { ...fixture, invoice_type_code: "380", original_invoice_number: null, original_invoice_date: null,
      einvoice: { ...fixture.einvoice, credit_reason: undefined },
      items: fixture.items.map(item => ({ ...item, custom: { litres: item.custom!.litres, einvoice_item_type: "G", einvoice_hs_code: "271019" } })),
    };
    expect(invoiceElectronicDetailPages(form).length).toBeLessThanOrEqual(2);
  });

  it("does not invent missing identities or append to non-UAE invoices and other document types", () => {
    const minimal = { currency: "AED", tax_country_code: "AE", items: [] };
    expect(value("UUID", minimal)).toEqual([]);
    expect(value("Entity tax identity", minimal)).toEqual([]);
    expect(value("Electronic address", minimal)).toEqual([]);
    expect(value("Bank account / IBAN", minimal)).toEqual([]);
    expect(invoiceElectronicDetailPages({ ...minimal, einvoice: { uuid: fixture.einvoice!.uuid } })).toEqual([]);
    const lineOnly = { ...minimal, tax_rate: 5, items: [{ description: "Exempt", qty: 1, unit_price: 10, unit: "HUR", tax_category: "E" }] };
    expect(value("Tax category / rate", lineOnly)).toEqual(["E · Exempt · 0% · VAT"]);
    expect(value("Specification identifier", lineOnly)).toEqual([]);
    for (const doc_type of ["quotation", "receipt", "purchase_order"]) expect(invoiceElectronicDetailPages({ ...fixture, doc_type })).toEqual([]);
    expect(invoiceElectronicDetailPages({ ...fixture, tax_country_code: "IN" })).toEqual([]);
    for (const doc_type of ["Tax Invoice", "sales", "Credit Note", "invoice"]) expect(invoiceElectronicDetailPages({ ...fixture, doc_type }).length).toBeGreaterThan(0);
    expect(value("Legal registration", { ...fixture, seller_legal_id: "SAVED-LEGAL-ID", seller_legal_id_type: "EID" })[0]).toContain("SAVED-LEGAL-ID · EID");
  });

  it("ignores malformed legacy identity values rather than crashing or printing object identifiers", () => {
    const malformed = { seller: { tin: 123, corporate_trn: {}, endpoint_id: 456 }, buyer: { tin: [], endpoint_id: 789 }, payment_account_id: { value: "not an account" } };
    const form = { ...fixture, einvoice: malformed as unknown as DocViewForm["einvoice"] };
    expect(() => invoiceElectronicDetailPages(form)).not.toThrow();
    expect(value("Entity tax identity", form)).toEqual([]);
    expect(value("Electronic address", form)).toEqual([]);
    expect(value("Bank account / IBAN", form)).toEqual([]);
    expect(rows(form).map(row => row.value).join("")).not.toContain("[object Object]");
  });

  it("prints the document payment snapshot instead of a different current company account", () => {
    const html = renderToStaticMarkup(<InvoiceExportSheet form={{ ...fixture, show_bank: true }} bank={{ ...EMPTY_BANK, iban: "CURRENT-DIFFERENT-IBAN", account_number: "OTHER-ACCOUNT", bank_name: "Other Bank", account_name: "Other Payee" }} />);
    expect(html).toContain(fixture.einvoice!.payment_account_id!);
    expect(html).toContain("Snapshot payee");
    expect(html).not.toContain("CURRENT-DIFFERENT-IBAN");
    expect(html).not.toContain("OTHER-ACCOUNT");
    expect(html).not.toContain("Other Bank");
  });

  it("escapes entered text and makes page boundaries available to the normal PDF capture", () => {
    const form = { ...fixture, customer_name: '<img src=x onerror="alert(1)">' };
    const pages = invoiceElectronicDetailPages(form);
    const html = renderToStaticMarkup(<InvoiceElectronicDetailsPage rows={pages.flat().filter(row => row.label === "Legal name")} pageNumber={1} pageCount={1} />);
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });
});
