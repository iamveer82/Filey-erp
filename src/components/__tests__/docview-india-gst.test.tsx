import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import DocView, { type DocViewForm } from "../DocView";
import { EMPTY_BANK } from "../BankDetails";

afterEach(cleanup);

const india: DocViewForm = {
  template: "minimal", currency: "INR", tax_country_code: "IN", tax_rate: 18, number: "INV-IN-1", issue_date: "2026-10-05",
  seller_name: "Seller Pvt Ltd", seller_country_subdivision: "Maharashtra", seller_trn: "27AAPFU0939F1ZV",
  customer_name: "Buyer", buyer_country_code: "IN", buyer_country_subdivision: "Maharashtra",
  customColumns: [{ key: "hsn", label: "HSN/SAC" }],
  items: [{ description: "Engine oil", qty: 10, unit_price: 100, custom: { hsn: "2710" } }],
};

describe("Indian GST invoice", () => {
  it("prints CGST and SGST halves, the place of supply, the HSN column and rupees in lakh words", () => {
    const view = render(<DocView form={{ ...india, items: [{ description: "Engine oil", qty: 1000, unit_price: 150, custom: { hsn: "2710" } }] }} />);
    const text = view.container.textContent ?? "";
    expect(text).toContain("Place of supply");
    expect(text).toContain("Maharashtra (27)");
    expect(text).toContain("CGST (9%)");
    expect(text).toContain("SGST (9%)");
    expect(text).not.toContain("IGST");
    expect(text).toContain("HSN/SAC");
    expect(text).toContain("2710");
    expect(text).toContain("One Lakh Seventy Seven Thousand"); // 1,77,000
  });

  it("prints IGST for a buyer in another state", () => {
    const view = render(<DocView form={{ ...india, buyer_country_subdivision: "Karnataka" }} />);
    const text = view.container.textContent ?? "";
    expect(text).toContain("IGST (18%)");
    expect(text).toContain("Karnataka (29)");
    expect(text).not.toContain("CGST");
  });

  it("prints a Scan-to-pay UPI QR for the amount due beside the bank details", () => {
    const bank = { ...EMPTY_BANK, bank_name: "HDFC Bank", ifsc: "HDFC0001234", upi_id: "seller@okhdfcbank" };
    const view = render(<DocView form={{ ...india, advance_applied: 180 }} bank={bank} />);
    const qr = view.getByRole("img", { name: /UPI QR code to pay/ });
    expect(qr.getAttribute("aria-label")).toContain("1,000.00"); // 1,180 total less the 180 advance
    expect(view.container.textContent).toContain("UPI ID");
    // No QR without bank details shown, on a credit note, or for another currency.
    const hasQr = (f: DocViewForm, b?: typeof bank) => !!render(<DocView form={f} bank={b} />).container.querySelector("[data-upi-qr]");
    expect(hasQr(india)).toBe(false);
    expect(hasQr({ ...india, invoice_type_code: "381" }, bank)).toBe(false);
    expect(hasQr({ ...india, currency: "USD" }, bank)).toBe(false);
    expect(hasQr(india, bank)).toBe(true);
  });

  it("leaves UAE invoices as they were", () => {
    const view = render(<DocView form={{ ...india, currency: "AED", tax_country_code: "AE", tax_rate: 5, customColumns: [] }} />);
    const text = view.container.textContent ?? "";
    expect(text).toContain("VAT (5%)");
    expect(text).not.toContain("Place of supply");
    expect(text).not.toContain("CGST");
  });
});
