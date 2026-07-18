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

describe("UAE reference-pack templates — wave 2", () => {
  const ids2 = [
    "uae-construction",
    "uae-rental",
    "uae-restaurant",
    "uae-medical",
    "uae-education",
    "uae-logistics",
    "uae-ecommerce",
    "uae-hotel",
    "uae-salon",
    "uae-garage",
    "uae-realestate",
    "uae-amc",
    "uae-event",
    "uae-timesheet",
    "uae-margin",
    "uae-summary",
    "uae-agent",
    "uae-designated",
    "uae-deemed",
    "uae-commercial",
    "uae-petty-cash",
    "uae-advance-receipt",
  ];

  it.each(ids2)("%s is registered and resolves", (id) => {
    expect(DOC_TEMPLATES.some((t) => t.id === id)).toBe(true);
    expect(resolveTemplateId(id)).toBe(id);
  });

  it.each(ids2)("%s renders real document data", (id) => {
    const html = renderToStaticMarkup(<DocView form={{ ...base, template: id }} />);
    expect(html).toContain("Filey Trading LLC");
    expect(html).toContain("TRN: 100234567890003");
    expect(html).toContain("INV-2026-0001");
  });

  it("uae-construction uses the works columns and Arabic subtitle", () => {
    const html = renderToStaticMarkup(
      <DocView form={{ ...base, template: "uae-construction" }} />
    );
    expect(html).toContain("TAX INVOICE");
    expect(html).toContain("مستخلص أعمال");
    expect(html).toContain("Work Section");
    expect(html).toContain("Taxable Amt");
    expect(html).toContain("VAT @ 5%");
  });

  it("uae-hotel uses the folio columns (no qty/price)", () => {
    const html = renderToStaticMarkup(<DocView form={{ ...base, template: "uae-hotel" }} />);
    expect(html).toContain("فاتورة ضريبية — فندق");
    expect(html).toContain("Folio No.");
    expect(html).toContain("Taxable Amt");
    expect(html).not.toContain("Unit Price");
  });

  it("uae-salon shows VAT-inclusive prices", () => {
    const html = renderToStaticMarkup(<DocView form={{ ...base, template: "uae-salon" }} />);
    expect(html).toContain("Price incl. VAT (AED)");
    expect(html).toContain("525.00"); // 500 × 1.05
    expect(html).toContain("Total Payable (AED)");
    expect(html).toContain("6,300.00"); // standard totals block still applies
  });

  it("uae-timesheet maps qty to Hours and unit_price to Rate/hr", () => {
    const html = renderToStaticMarkup(
      <DocView form={{ ...base, template: "uae-timesheet" }} />
    );
    expect(html).toContain("Resource / Description");
    expect(html).toContain("Hours");
    expect(html).toContain("Rate/hr");
    expect(html).toContain("VAT @ 5%");
  });

  it("uae-margin has no VAT columns and a net-only grand total", () => {
    const html = renderToStaticMarkup(<DocView form={{ ...base, template: "uae-margin" }} />);
    expect(html).toContain("نظام هامش الربح");
    expect(html).not.toContain("VAT %");
    expect(html).not.toContain("VAT Breakdown");
    expect(html).not.toContain("VAT @");
    expect(html).toContain("Total (AED)");
    expect(html).toContain("6,000.00"); // VAT not added on a margin-scheme doc
    expect(html).not.toContain("6,300.00");
    expect(html).toContain("Art. 43");
  });

  it("uae-commercial has no VAT anywhere in items or totals", () => {
    const html = renderToStaticMarkup(
      <DocView form={{ ...base, template: "uae-commercial" }} />
    );
    expect(html).toContain("INVOICE");
    expect(html).toContain("Amount (AED)");
    expect(html).toContain("Subtotal");
    expect(html).toContain("Total Payable (AED)");
    expect(html).toContain("6,000.00");
    expect(html).not.toContain("6,300.00");
    expect(html).not.toContain("VAT @");
    expect(html).not.toContain("VAT %");
    expect(html).not.toContain("VAT Breakdown");
    expect(html).not.toContain("Taxable");
  });

  it("uae-summary uses its own title", () => {
    const html = renderToStaticMarkup(<DocView form={{ ...base, template: "uae-summary" }} />);
    expect(html).toContain("SUMMARY TAX INVOICE");
    expect(html).toContain("فاتورة ضريبية مجمعة");
  });

  it("uae-petty-cash renders the petty voucher rows", () => {
    const html = renderToStaticMarkup(
      <DocView
        form={{
          ...base,
          template: "uae-petty-cash",
          number: "PC-2026-0312",
          notes: "Taxi — client site visit",
          items: [{ description: "Taxi — client site visit", qty: 1, unit_price: 45, unit: "" }],
        }}
      />
    );
    expect(html).toContain("PETTY CASH VOUCHER");
    expect(html).toContain("سند مصروفات نثرية");
    expect(html).toContain("Paid to");
    expect(html).toContain("For (particulars)");
    expect(html).toContain("Taxi — client site visit");
    expect(html).toContain("Amount (in words)");
    expect(html).toContain("Claimed By");
    expect(html).toContain("Approved By");
  });

  it("uae-advance-receipt renders like a receipt voucher", () => {
    const html = renderToStaticMarkup(
      <DocView
        form={{
          ...base,
          template: "uae-advance-receipt",
          number: "ADV-2026-0018",
          items: [{ description: "Advance received", qty: 1, unit_price: 5250, unit: "" }],
        }}
      />
    );
    expect(html).toContain("ADVANCE PAYMENT RECEIPT");
    expect(html).toContain("إيصال دفعة مقدمة");
    expect(html).toContain("Receipt No.");
    expect(html).toContain("Received with thanks from");
    expect(html).toContain("The sum of (in words)");
    expect(html).toContain("Amount (AED)");
  });
});
