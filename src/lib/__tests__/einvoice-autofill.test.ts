import { expect, it } from "vitest";
import { autofillEInvoice } from "../invoiceSeller";
import { eInvoiceIssues, unitCode, type EInvoiceDoc } from "../einvoiceXml";
import type { CompanyProfile } from "../api";

// Customer report: the e-invoice check flagged the TRN, bank and seller details already saved in Filey.
const company: CompanyProfile = {
  name: "Rennox Lubricants", address: "Warehouse 4", city: "Sharjah", country_subdivision: "SHJ", country_code: "AE",
  trn: "100123456700003", email: "sales@rennox.test", phone: "+971 50 111 2222", currency: "AED",
  legal_id: "SHJ-12345", legal_id_type: "TL", default_template: "minimal", default_accent: "#111111",
  einvoice: { legal_authority: "Sharjah Economic Development" },
};
const bank = { id: "AE070331234567890123456", name: "Rennox Lubricants LLC" };
const draft = (): EInvoiceDoc & { status: string } => ({
  status: "draft", number: "INV-DLS-032-26", issue_date: "2026-10-17", currency: "AED",
  customer_name: "Bapco Trading", customer_address: "Street 9", buyer_city: "Dubai", buyer_country_subdivision: "DXB",
  customer_trn: "100987654300003", buyer_country_code: "AE",
  items: [{ description: "H/O 68 PAIL 20L", qty: 20, unit: "PAIL", unit_price: 80, tax: 5 }],
} as never);
type Doc = EInvoiceDoc & { status: string };
// The fixtures are partial invoices; autofillEInvoice is generic over the editor's full form.
const fill = (doc: object, profile: CompanyProfile | null, account: typeof bank | null) =>
  autofillEInvoice(doc as never, profile, account) as Doc;
const seller = (issues: { field: string }[]) => issues.filter((i) => /^(seller_|einvoice\.seller|einvoice\.payment|payment_means)/.test(i.field));

it("fills the saved seller, its own TRN and the saved bank account so nothing known is flagged", () => {
  expect(seller(eInvoiceIssues(draft())).length).toBeGreaterThan(0);
  const filled = fill(draft(), company, bank);
  expect(filled).toMatchObject({ seller_name: company.name, seller_trn: company.trn, payment_means_code: "30",
    einvoice: { payment_account_id: bank.id, payment_account_name: bank.name, seller: { corporate_trn: company.trn } } });
  expect(seller(eInvoiceIssues(filled))).toEqual([]);
  expect(eInvoiceIssues(filled).filter((i) => i.section === "items")).toEqual([]);
});

it("keeps what the invoice already says, leaves issued invoices alone and does nothing when nothing is missing", () => {
  const manual = { ...draft(), payment_means_code: "10", einvoice: { seller: { tin: "1009999999" } } };
  const kept = fill(manual, null, bank);
  expect(kept.payment_means_code).toBe("10");
  expect(kept.einvoice?.seller).toEqual({ tin: "1009999999" });
  const sent = { ...draft(), status: "sent" };
  expect(fill(sent, company, bank)).toBe(sent);
  const full = fill(draft(), company, bank);
  expect(fill(full, company, bank)).toBe(full);
  const otherSeller = { ...draft(), seller_name: "Another company" };
  expect(fill(otherSeller, company, null).seller_trn).toBeUndefined();
});

it("reads everyday unit names as their official codes", () => {
  // "KGS" and "CTN" are also Rec 20 codes (kg per second, container); people mean kilograms and cartons.
  expect(["PAIL", "pails", "Drum", "CTN", "Cartons", "pieces", "Nos", "litres", "boxes", "cases", "dozen", "set", "KGS"].map(unitCode))
    .toEqual(["XPL", "XPL", "XDR", "XCT", "XCT", "H87", "H87", "LTR", "XBX", "XCS", "DZN", "SET", "KGM"]);
  expect(unitCode("H87")).toBe("H87");
  expect(unitCode("")).toBe("C62");
  expect(unitCode("widgetload")).toBe("");
});
