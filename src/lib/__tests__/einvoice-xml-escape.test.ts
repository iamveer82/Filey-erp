// @vitest-environment jsdom
// The e-invoice XML is prepared for provider validation. XML 1.0 forbids control characters
// outright, so one riding along in a customer name — pasted from a PDF, or
// imported from a CSV — makes the whole document unparseable, and the rejection
// names nothing that points back to the field.
import { describe, it, expect } from "vitest";
import { buildInvoiceXml, eInvoiceIssues, type EInvoiceDoc } from "../einvoiceXml";

const doc = (over: Partial<EInvoiceDoc> = {}): EInvoiceDoc => ({
  number: "INV-2026-0001",
  einvoice: { uuid: "e054df09-2f88-41ee-a45e-559f1d5f5408",
    seller: { tin: "1001234567", legal_authority: "Dubai Economy" }, buyer: { tin: "1007774567" } },
  issue_date: "2026-09-04",
  due_date: "2026-10-04",
  payment_means_code: "10",
  currency: "AED",
  tax_rate: 5,
  seller_name: "Acme FZE",
  seller_trn: "100123456700003",
  seller_address: "Office 1",
  seller_city: "Dubai",
  seller_country_subdivision: "DXB",
  seller_legal_id: "LICENCE-1",
  seller_legal_id_type: "TL",
  customer_name: "Globex LLC",
  customer_address: "Office 2",
  buyer_city: "Dubai",
  buyer_country_subdivision: "DXB",
  items: [{ description: "Consulting", qty: 1, unit_price: 100, tax_category: "S" }],
  ...over,
});

describe("buildInvoiceXml escaping", () => {
  it("flags forbidden control characters without silently changing the legal name", () => {
    const source = doc({ customer_name: "Glo\u0001bex\u001f LLC" });
    expect(eInvoiceIssues(source)).toContainEqual(expect.objectContaining({ field: "customer_name" }));
    expect(() => buildInvoiceXml(source)).toThrow("not supported by XML");
    expect(source.customer_name).toBe("Glo\u0001bex\u001f LLC");
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

  it.each(["\u0000", "\u0001", "\u000B", "\u001F", "\uFFFE", "\uFFFF", "\uD800", "\uDC00"])("rejects prohibited XML Unicode instead of changing an identifier (%j)", invalid => {
    const source = doc({ seller_legal_id: `LICENCE-${invalid}-1` });
    expect(eInvoiceIssues(source)).toContainEqual(expect.objectContaining({ field: "seller_legal_id" }));
    expect(() => buildInvoiceXml(source)).toThrow("not supported by XML");
    expect(source.seller_legal_id).toBe(`LICENCE-${invalid}-1`);
  });

  it("preserves Arabic, CJK and supplementary Unicode in parseable XML", () => {
    const source = doc({ customer_name: "شركة دبي · 客户 · 🛢️" });
    const xml = buildInvoiceXml(source);
    const parsed = new DOMParser().parseFromString(xml, "application/xml");
    expect(parsed.querySelector("parsererror")).toBeNull();
    const buyer = parsed.getElementsByTagNameNS("*", "AccountingCustomerParty")[0];
    expect(buyer?.getElementsByTagNameNS("*", "RegistrationName")[0]?.textContent).toBe(source.customer_name);
  });
});
