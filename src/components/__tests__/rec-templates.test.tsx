import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DocView, { type DocViewForm } from "../DocView";
import { DOC_TEMPLATES, resolveTemplateId } from "../DocTemplates";

const base: DocViewForm = {
  template: "receipt",
  currency: "AED",
  doc_title: "RECEIPT",
  number: "REC-0007",
  seller_name: "Filey Trading LLC",
  seller_address: "Business Bay\nDubai, UAE",
  seller_trn: "100234567890003",
  seller_phone: "+971 4 000 0000",
  customer_name: "Acme LLC",
  customer_address: "JLT\nDubai",
  customer_trn: "100999888777003",
  issue_date: "2026-07-17",
  payment_method: "Bank Transfer",
  ref_number: "UTR-12345",
  amount_words: "One thousand five hundred dirhams only",
  notes_raw: "Thank you for your business.",
  notes: "Thank you for your business.",
  terms: "This receipt acknowledges the payment stated above.",
  items: [{ description: "Payment received", qty: 1, unit_price: 1500, unit: "" }],
};

const ids = ["rec-modern", "rec-minimal", "rec-classic", "rec-corporate", "rec-thermal", "rec-elegant"];

describe("DEMO receipt template ports", () => {
  it.each(ids)("%s is registered and resolves", (id) => {
    expect(DOC_TEMPLATES.some((t) => t.id === id)).toBe(true);
    expect(resolveTemplateId(id)).toBe(id);
  });

  it.each(ids)("%s renders real receipt data", (id) => {
    const html = renderToStaticMarkup(
      <DocView
        form={{ ...base, template: id }}
        labels={{ docTitle: "RECEIPT", partyLabel: "Received From", totalLabel: "Amount Received" }}
      />
    );
    expect(html).toContain("Filey Trading LLC");
    expect(html).toContain("Acme LLC");
    expect(html).toContain("REC-0007");
    expect(html).toContain("Bank Transfer");
    expect(html).toContain("UTR-12345");
    expect(html).toContain("1,500");
    expect(html).toContain("One thousand five hundred");
    expect(html).toContain("Thank you for your business.");
    expect(html).toContain("acknowledges the payment");
  });
});
