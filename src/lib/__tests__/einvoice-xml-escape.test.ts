// The e-invoice XML goes to the FTA. XML 1.0 forbids control characters
// outright, so one riding along in a customer name — pasted from a PDF, or
// imported from a CSV — makes the whole document unparseable, and the rejection
// names nothing that points back to the field.
import { describe, it, expect } from "vitest";
import { buildInvoiceXml, type EInvoiceDoc } from "../einvoiceXml";

const doc = (over: Partial<EInvoiceDoc> = {}): EInvoiceDoc => ({
  number: "INV-2026-0001",
  issue_date: "2026-09-04",
  currency: "AED",
  tax_rate: 5,
  seller_name: "Acme FZE",
  seller_trn: "100123456700003",
  seller_country_subdivision: "DU",
  customer_name: "Globex LLC",
  items: [{ description: "Consulting", qty: 1, unit_price: 100, tax_category: "S" }],
  ...over,
});

describe("buildInvoiceXml escaping", () => {
  it("strips control characters that would make the document unparseable", () => {
    const xml = buildInvoiceXml(doc({ customer_name: "Glo\u0001bex\u001f LLC" }));
    expect(xml).toContain("Globex LLC");
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml)).toBe(false);
  });

  it("keeps tab, newline and carriage return, which XML allows", () => {
    const xml = buildInvoiceXml(doc({ seller_address: "Unit 4\tTower B" }));
    expect(xml).toContain("Unit 4\tTower B");
  });

  it("escapes the markup characters rather than dropping them", () => {
    const xml = buildInvoiceXml(doc({ customer_name: 'Smith & Sons <"Trading">' }));
    expect(xml).toContain("Smith &amp; Sons &lt;&quot;Trading&quot;&gt;");
    expect(xml).not.toContain("<\"Trading\">");
  });
});
