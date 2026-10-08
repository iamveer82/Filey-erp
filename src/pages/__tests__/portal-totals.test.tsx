// The public portal is what the customer sees and pays from, so its Total must
// equal the invoice's own. It used to drop the doc-level unit-price formula,
// the round-off flag and the per-line discount held in item meta — each of
// which moves the number.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const sharedDoc = {
  doc_type: "invoice",
  doc: {
    number: "INV-1",
    currency: "AED",
    tax_country_code: "AE",
    transaction_type: "10000001",
    template: "minimal",
    tax_rate: 5,
    discount: 0,
    round_off: true,
    unit_price_formula: { a: "area", b: "unit_price" },
    status: "sent",
    seller_name: "My Company",
    customer_name: "Test Co",
  },
  // 3 (area) × 100 = 300 gross, less 10% line discount = 270, +5% VAT = 283.50,
  // round-off on = 284.00.
  items: [
    {
      description: "Flooring",
      qty: 1,
      unit_price: 100,
      custom: { area: "3", __disc_pct: "10" },
    },
  ],
};
let currentSharedDoc: unknown = sharedDoc;

vi.mock("../../lib/supabase", () => ({
  supabase: { rpc: async () => ({ data: currentSharedDoc, error: null }) },
  invokeFn: async () => ({ data: null, error: null }),
  isConfigured: true,
  cloudConfigured: true,
  sb: () => ({}),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));

import PortalView from "../PortalView";

describe("public portal totals", () => {
  beforeEach(() => {
    currentSharedDoc = structuredClone(sharedDoc);
    window.location.hash = "#/portal/tok-1";
  });

  it("applies the doc formula, per-line discount and round-off", async () => {
    const { container } = render(<PortalView />);
    await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull());
    const text = container.textContent ?? "";
    expect(text).toContain("284.00");
    // The pre-discount, pre-round figure must not be what the customer sees.
    expect(text).not.toContain("315.00");
    expect(container.querySelector("[data-invoice-transactions]")?.textContent)
      .toBe("Transaction details: Free Trade zone · Exports");
  });

  it("preserves invoice identities, references, payment snapshot, tax categories and frozen FX through the public projection", async () => {
    currentSharedDoc = { ...sharedDoc, doc: { ...sharedDoc.doc,
      currency: "USD", unit_price_formula: null, round_off: false, advance_applied: 5, aed_exchange_rate: 3.67,
      seller_city: "Dubai", seller_country_subdivision: "DXB", seller_legal_id: "SELLER-LICENSE", seller_legal_id_type: "TL",
      buyer_city: "Abu Dhabi", buyer_country_subdivision: "AUH", buyer_country_code: "AE",
      invoice_type_code: "381", payment_means_code: "30", original_invoice_number: "ORIGINAL-99", original_invoice_date: "2026-10-01", date_of_supply: "2026-10-02",
      einvoice: { uuid: "0e3d9d76-e6d1-444f-bec3-32438ac81c9d", credit_reason: "DL8.61.1.C", payment_account_id: "DOCUMENT-BANK", payment_account_name: "Document payee",
        seller: { tin: "1001234567", legal_authority: "Seller authority" }, buyer: { tin: "1007654321", legal_id: "BUYER-LICENSE", legal_id_type: "TL" } },
      custom_columns: [{ key: "litres", label: "T.Liters" }],
    }, items: [
      { description: "Exempt service", qty: 2, unit: "HUR", unit_price: 10, tax_category: "E", custom: { einvoice_exemption_code: "DL8.46.1", litres: "40" } },
      { description: "Reverse charge", qty: 2, unit: "KGM", unit_price: 10, tax_category: "AE", custom: { einvoice_nature: "DL8.48.3.1", einvoice_gtin: "6291041500213" } },
    ] };
    const { container } = render(<PortalView />);
    await waitFor(() => expect(container.querySelector("[data-einvoice-details]")).not.toBeNull());
    const details = Array.from(container.querySelectorAll("[data-einvoice-details]")).map(node => node.textContent).join("");
    for (const expected of ["SELLER-LICENSE", "BUYER-LICENSE", "1001234567", "1007654321", "DOCUMENT-BANK", "Document payee", "ORIGINAL-99", "2026-10-01", "2026-10-02", "DL8.61.1.C", "DL8.46.1", "DL8.48.3.1", "6291041500213", "146.80 AED"]) expect(details).toContain(expected);
    const field = (name: string) => Array.from(container.querySelectorAll("[data-einvoice-detail-row]")).find(row => row.querySelector("dt")?.textContent === name)?.querySelector("dd")?.textContent;
    expect(field("VAT total")).toBe("0.00 USD");
    expect(field("Total including VAT")).toBe("40.00 USD");
    expect(field("Amount due")).toBe("35.00 USD");
    expect(container.textContent).toContain("T.Liters");
  });

  it("does not attach invoice identity sheets to shared quotations", async () => {
    currentSharedDoc = { ...sharedDoc, doc_type: "quotation" };
    const { container } = render(<PortalView />);
    await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull());
    expect(container.querySelector("[data-einvoice-details]")).toBeNull();
  });
});
