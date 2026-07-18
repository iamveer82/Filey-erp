import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DocView, { type DocViewForm } from "../DocView";
import { DOC_TEMPLATES, resolveTemplateId } from "../DocTemplates";

const base: DocViewForm = {
  template: "uae-full",
  currency: "AED",
  number: "INV-2026-0001",
  seller_name: "Filey Trading LLC",
  seller_address: "Business Bay\nDubai, UAE",
  seller_trn: "100234567890003",
  seller_email: "billing@filey.ae",
  seller_phone: "+971 4 000 0000",
  customer_name: "Acme LLC",
  customer_address: "JLT\nDubai",
  customer_trn: "100999888777003",
  issue_date: "2026-07-17",
  due_date: "2026-08-16",
  tax_rate: 5,
  notes: "Thank you for your business.",
  items: [
    { description: "Consulting services — July 2026", qty: 10, unit_price: 500, unit: "hr" },
    { description: "Software licence — annual", qty: 1, unit_price: 1000, unit: "" },
  ],
};

// E-invoice extras the Invoicing form carries at runtime (not on DocViewForm).
const creditExtras = {
  original_invoice_number: "INV-2026-0001",
  original_invoice_date: "2026-07-01",
};
const fxExtras = { aed_exchange_rate: 3.6725 };

const ids = [
  "uae-full",
  "uae-simplified",
  "uae-reverse",
  "uae-foreign",
  "uae-export",
  "uae-mixed",
  "uae-recurring",
  "uae-freelancer",
  "uae-credit-note",
  "uae-debit-note",
  "uae-quotation",
  "uae-proforma",
  "uae-estimate",
  "uae-purchase-order",
  "uae-order-confirmation",
  "uae-receipt-voucher",
  "uae-payment-voucher",
];

describe("UAE reference-pack templates", () => {
  it.each(ids)("%s is registered and resolves", (id) => {
    expect(DOC_TEMPLATES.some((t) => t.id === id)).toBe(true);
    expect(resolveTemplateId(id)).toBe(id);
  });

  it("existing uae/em-uae ids are not swallowed by the pack prefix", () => {
    expect("uae".startsWith("uae-")).toBe(false);
    expect("em-uae".startsWith("uae-")).toBe(false);
    expect(resolveTemplateId("uae")).toBe("uae");
    expect(resolveTemplateId("em-uae")).toBe("em-uae");
  });

  it("uae-full renders a full tax invoice with TRN/TIN and VAT totals", () => {
    const html = renderToStaticMarkup(<DocView form={{ ...base, template: "uae-full" }} />);
    expect(html).toContain("TAX INVOICE");
    expect(html).toContain("فاتورة ضريبية");
    expect(html).toContain("Filey Trading LLC");
    expect(html).toContain("TRN: 100234567890003");
    expect(html).toContain("TIN: 1002345678");
    expect(html).toContain("Acme LLC");
    expect(html).toContain("INV-2026-0001");
    expect(html).toContain("VAT @ 5%");
    expect(html).toContain("Total Payable (AED)");
    expect(html).toContain("6,300.00");
    expect(html).toContain("Amount in words:");
    expect(html).toContain("Art. 59");
  });

  it("uae-credit-note renders reduction rows and the original-invoice box", () => {
    const html = renderToStaticMarkup(
      <DocView form={{ ...base, ...creditExtras, template: "uae-credit-note" }} />
    );
    expect(html).toContain("TAX CREDIT NOTE");
    expect(html).toContain("إشعار دائن ضريبي");
    expect(html).toContain("Credit Note No.");
    expect(html).toContain("Original Invoice");
    expect(html).toContain("INV-2026-0001");
    expect(html).toContain("Reduction in Taxable Amount");
    expect(html).toContain("Reduction in VAT @ 5%");
    expect(html).toContain("Total Credit (AED)");
    expect(html).toContain("Credit (AED)");
  });

  it("uae-debit-note keeps normal totals with a Total Debit grand row", () => {
    const html = renderToStaticMarkup(
      <DocView form={{ ...base, ...creditExtras, template: "uae-debit-note" }} />
    );
    expect(html).toContain("TAX DEBIT NOTE");
    expect(html).toContain("إشعار مدين ضريبي");
    expect(html).toContain("Subtotal (excl. VAT)");
    expect(html).toContain("Total Debit (AED)");
    expect(html).toContain("Debit (AED)");
  });

  it("uae-foreign renders the AED conversion box for non-AED currency", () => {
    const html = renderToStaticMarkup(
      <DocView
        form={{ ...base, ...fxExtras, template: "uae-foreign", currency: "USD" }}
      />
    );
    expect(html).toContain("عملة أجنبية");
    expect(html).toContain("VAT stated in AED at the frozen rate 1 USD = 3.6725 AED");
    expect(html).toContain("Total Payable (USD)");
  });

  it("uae-receipt-voucher renders the definition table, no items grid", () => {
    const html = renderToStaticMarkup(
      <DocView
        form={{
          ...base,
          template: "uae-receipt-voucher",
          number: "RV-2026-0201",
          payment_method: "Bank Transfer",
          ref_number: "UTR-12345",
          notes: "Settlement of Tax Invoice INV-2026-0001",
          items: [{ description: "Payment received", qty: 1, unit_price: 1500, unit: "" }],
        }}
      />
    );
    expect(html).toContain("RECEIPT VOUCHER");
    expect(html).toContain("سند قبض");
    expect(html).toContain("Received with thanks from");
    expect(html).toContain("Acme LLC");
    expect(html).toContain("The sum of (in words)");
    expect(html).toContain("One Thousand Five Hundred");
    expect(html).toContain("Bank Transfer");
    expect(html).toContain("UTR-12345");
    expect(html).toContain("Being payment of");
    expect(html).toContain("Settlement of Tax Invoice INV-2026-0001");
    expect(html).toContain("Amount (AED)");
  });

  it("uae-payment-voucher renders Paid to and its signature labels", () => {
    const html = renderToStaticMarkup(
      <DocView
        form={{
          ...base,
          template: "uae-payment-voucher",
          items: [{ description: "Supplier payment", qty: 1, unit_price: 1500, unit: "" }],
        }}
      />
    );
    expect(html).toContain("PAYMENT VOUCHER");
    expect(html).toContain("سند صرف");
    expect(html).toContain("Paid to");
    expect(html).toContain("Prepared By");
    expect(html).toContain("Received By (Payee Signature)");
  });
});
