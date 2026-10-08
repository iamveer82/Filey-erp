import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DocView, { type DocViewForm } from "../DocView";
import { templatesForDocType } from "../DocTemplates";
import { EMPTY_BANK } from "../BankDetails";
import type { CustomTemplate } from "../TemplateDesigner";

const form: DocViewForm = {
  doc_type: "Tax Invoice", currency: "AED", tax_country_code: "AE", number: "INV-INLINE-01",
  seller_name: "Seller Ltd", seller_address: "Seller Street", seller_trn: "100234567890003",
  customer_name: "Buyer Ltd", customer_address: "Buyer Street", customer_trn: "100999888777003",
  seller_phone: "+971 50 123 4567", seller_email: "seller@example.com",
  customer_phone: "+971 50 765 4321", customer_email: "buyer@example.com",
  seller_city: "Dubai", buyer_city: "Abu Dhabi", buyer_country_code: "AE",
  issue_date: "2026-10-08", due_date: "2026-11-08", tax_rate: 5,
  po_number: "PO-INLINE-27", po_date: "2026-10-01",
  einvoice: {
    seller: { identifier: "SELLER-INLINE-ID", tin: "1001234567" },
    buyer: { identifier: "BUYER-INLINE-ID", tin: "1007654321" },
    beneficiary_id: "BENEFICIARY-INLINE-ID",
    payment_account_id: "AE070331234567890123456", payment_account_name: "Saved Payee Ltd",
  },
  items: [
    { description: "Service one", qty: 2, unit_price: 100, unit: "hr", custom: { einvoice_gtin: "GTIN-INLINE-01" } },
    { description: "Service two", qty: 1, unit_price: 200, unit: "hr" },
    { description: "Service three", qty: 1, unit_price: 100, unit: "hr" },
  ],
};

function page(template: string, props: Partial<React.ComponentProps<typeof DocView>> = {}) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<DocView form={{ ...form, template }} {...props} />);
  return root;
}

describe("invoice details within the chosen layout", () => {
  it.each(templatesForDocType("invoice"))("$name keeps filled fields in the original document", ({ id }) => {
    const root = page(id);
    for (const value of ["SELLER-INLINE-ID", "BUYER-INLINE-ID", "BENEFICIARY-INLINE-ID", "GTIN-INLINE-01"]) {
      expect(root.textContent?.split(value)).toHaveLength(2);
    }
    expect(root.textContent).toContain("525.00");
    expect(root.querySelector("[data-einvoice-details]")).toBeNull();
    const line = [...root.querySelectorAll("tbody td")].find(cell => cell.textContent?.includes("Service one"));
    expect(line?.textContent).toContain("GTIN-INLINE-01");
    expect(root.textContent?.split("PO-INLINE-27")).toHaveLength(2);
    for (const [party, values] of [
      ["seller", ["Seller Street", "Dubai", "100234567890003", "+971 50 123 4567", "seller@example.com", "SELLER-INLINE-ID"]],
      ["buyer", ["Buyer Street", "Abu Dhabi", "AE", "100999888777003", "+971 50 765 4321", "buyer@example.com", "BUYER-INLINE-ID"]],
    ] as const) {
      const text = root.querySelector(`[data-invoice-party="${party}"]`)?.textContent || "";
      const offsets = values.map(value => text.indexOf(value));
      expect(offsets.every(offset => offset >= 0), `${id}: ${party} contact fields`).toBe(true);
      expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    }
  });

  it.each(["minimal", "fta", "uae-full"])("%s does not repeat saved payment details in the bank block", template => {
    const root = page(template, { bank: { ...EMPTY_BANK, account_number: "New company account" } });
    expect(root.textContent?.split("AE070331234567890123456")).toHaveLength(2);
    expect(root.textContent?.split("Saved Payee Ltd")).toHaveLength(2);
    expect(root.textContent).not.toContain("New company account");
  });

  it.each(templatesForDocType("invoice"))("$name shows the custom multiplier that produces the billed amount", ({ id }) => {
    const root = page(id, { form: { ...form, template: id,
      customColumns: [{ key: "litres", label: "T.Liters" }], unit_price_formula: { a: "litres", b: "unit_price" },
      items: [{ description: "Hydraulic oil", qty: 50, unit: "L", unit_price: 0.2, custom: { litres: "1000" } }],
    } });
    expect([...root.querySelectorAll("th")].some(cell => cell.textContent === "T.Liters"), id).toBe(true);
    const line = [...root.querySelectorAll("tbody tr")].find(row => row.textContent?.includes("Hydraulic oil"));
    expect(line?.textContent, id).toContain("1000");
    if (id === "fta") expect(line?.textContent).toContain("200.00");
    expect(root.textContent, id).toContain("210.00");
  });

  it("renders only current page line details and final-page document fields", () => {
    const root = page("minimal", { pageItems: [form.items[1]], showTotals: false, showFooter: false });
    expect(root.textContent).toContain("Service two");
    expect(root.textContent).not.toContain("GTIN-INLINE-01");
    expect(root.textContent).not.toContain("BENEFICIARY-INLINE-ID");
    expect(root.textContent).not.toContain("525.00");
  });

  it.each(["industrial", "executive"])("%s prints saved terms once without inventing a payment deadline", template => {
    const entered = page(template, { form: { ...form, template, terms: "Payment due within 12 days." } });
    expect(entered.textContent?.split("Payment due within 12 days.")).toHaveLength(2);
    expect(page(template, { form: { ...form, template, terms: "" } }).textContent).not.toContain("Net 30");
  });

  it("prints the saved transaction code once, including an ordinary all-zero code", () => {
    for (const transaction_type of ["10000001", "00000000"]) {
      const root = page("minimal", { form: { ...form, template: "minimal", transaction_type } });
      expect(root.textContent?.split(`Transaction type: ${transaction_type}`)).toHaveLength(2);
    }
  });

  it("ignores malformed imported transaction metadata instead of failing invoice rendering", () => {
    const root = page("minimal", { form: { ...form, template: "minimal", transaction_type: 42, invoice_type_code: { bad: true }, payment_means_code: [] } as unknown as DocViewForm });
    expect(root.textContent).toContain("525.00");
    expect(root.textContent).not.toContain("Transaction type:");
    expect(root.textContent).not.toContain("[object Object]");
  });

  it.each(["minimal", "uae-full"])("%s uses the frozen buyer phone, respecting an explicitly cleared phone", template => {
    const saved = page(template, { form: { ...form, template, einvoice: { ...form.einvoice, buyer: { ...form.einvoice?.buyer, phone: "+971 50 111 2222" } } } });
    expect(saved.textContent).toContain("+971 50 111 2222");
    expect(saved.textContent).not.toContain(form.customer_phone);
    const cleared = page(template, { form: { ...form, template, einvoice: { ...form.einvoice, buyer: { phone: "" } } } });
    expect(cleared.textContent).not.toContain(form.customer_phone);
  });

  it.each(["minimal", "classic", "modern"] as const)("respects hidden party sections in custom %s", layout => {
    const customTemplate: CustomTemplate = {
      id: "custom-inline", name: "Inline", type: "builder", layout, accent: "#222222", font: "Arial",
      showLogo: false, showSeller: false, showCustomer: false, showNotes: true, showTerms: true, showTax: true, paperSize: "A4",
    };
    const root = page(layout, { form: { ...form, template: customTemplate.id }, customTemplate });
    expect(root.textContent).not.toMatch(/SELLER-INLINE-ID|BUYER-INLINE-ID|Seller Street|Buyer Street/);
    expect(root.textContent).toContain("GTIN-INLINE-01");
    expect(root.textContent).toContain("BENEFICIARY-INLINE-ID");
  });

  it("respects placed sections in uploaded templates", () => {
    const customTemplate: CustomTemplate = {
      id: "custom-inline-file", name: "Inline letterhead", type: "file", layout: "minimal", accent: "#222222", font: "Arial",
      fileData: "data:image/png;base64,AA==", fileType: "image",
      showLogo: false, showSeller: true, showCustomer: true, showNotes: true, showTerms: true, showTax: true, paperSize: "A4",
      positions: { seller: { x: 6, y: 5 }, customer: { x: 6, y: 25 }, items: { x: 6, y: 45 }, totals: { x: 70, y: 70 }, footer: { x: 6, y: 85 } },
    };
    const root = page("minimal", { form: { ...form, template: customTemplate.id }, customTemplate });
    for (const value of ["SELLER-INLINE-ID", "BUYER-INLINE-ID", "GTIN-INLINE-01", "BENEFICIARY-INLINE-ID"]) {
      expect(root.textContent?.split(value)).toHaveLength(2);
    }
  });

  it.each(["quotation", "purchase_order", "receipt"])("does not add electronic invoice fields to %s", doc_type => {
    const root = page("minimal", { form: { ...form, template: "minimal", doc_type, transaction_type: "10000001", invoice_type_code: "380", payment_means_code: "30" } });
    expect(root.textContent).not.toMatch(/SELLER-INLINE-ID|BUYER-INLINE-ID|GTIN-INLINE-01|BENEFICIARY-INLINE-ID/);
    expect(root.querySelector("[data-invoice-transactions]")).toBeNull();
    expect(root.querySelector("[data-invoice-payment]")).toBeNull();
  });

  it("preserves existing non-invoice UAE pack location and tax identity", () => {
    const root = page("uae-quotation", { form: { ...form, template: "uae-quotation", doc_type: "quotation" } });
    expect(root.textContent).toContain("Dubai");
    expect(root.textContent).toContain("TIN: 1001234567");
    expect(root.textContent).not.toContain("SELLER-INLINE-ID");
  });

  it("does not add UAE identity or classification to another tax jurisdiction", () => {
    const root = page("minimal", { form: { ...form, template: "minimal", currency: "INR", tax_country_code: "IN" } });
    expect(root.textContent).not.toMatch(/SELLER-INLINE-ID|BUYER-INLINE-ID|GTIN-INLINE-01|BENEFICIARY-INLINE-ID/);
  });
});
