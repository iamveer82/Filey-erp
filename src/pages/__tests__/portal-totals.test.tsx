// The public portal is what the customer sees and pays from, so its Total must
// equal the invoice's own. It used to drop the doc-level unit-price formula,
// the round-off flag and the per-line discount held in item meta — each of
// which moves the number.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { fmtDate } from "../../lib/format";

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
  afterEach(cleanup);
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

  it.each(["draft", "sent", "overdue"])("does not claim a %s invoice was paid based on its URL", async status => {
    currentSharedDoc = { ...sharedDoc, doc: { ...sharedDoc.doc, status } };
    window.location.hash = "#/portal/tok-1?paid=1";
    render(<PortalView />);
    expect(await screen.findByText("Contact the seller to arrange payment for this invoice.")).toBeInTheDocument();
    expect(screen.queryByText("Payment received - thank you!")).not.toBeInTheDocument();
  });

  it("confirms payment only when the saved invoice status is paid", async () => {
    currentSharedDoc = { ...sharedDoc, doc: { ...sharedDoc.doc, status: "paid" } };
    render(<PortalView />);
    expect(await screen.findByText("Payment received - thank you!")).toBeInTheDocument();
    expect(screen.queryByText("Contact the seller to arrange payment for this invoice.")).not.toBeInTheDocument();
  });

  it.each([
    { type: "quotation", number: "QT-41", party: "Quote recipient", partyLabel: "Quote To", issuedLabel: "Quote Date", dueLabel: "Valid Until" },
    { type: "purchase_order", number: "PO-42", party: "Supplier company", partyLabel: "Supplier", issuedLabel: "Order Date", dueLabel: "Expected" },
  ])("renders the normalized $type public document without losing its recipient, dates or prices", async ({ type, number, party, partyLabel, issuedLabel, dueLabel }) => {
    // get_shared_doc maps each document's native columns to this shared contract.
    currentSharedDoc = { doc_type: type, doc: {
      template: "minimal", number, status: "draft", currency: "AED", tax_rate: 0,
      seller_name: "Our company", customer_name: party, customer_address: "Dubai, UAE",
      customer_trn: "100123456700003", issue_date: "2026-10-08", due_date: "2026-10-22",
    }, items: [{ description: "Oil pail", qty: 3, unit_price: 25, unit: "pcs" }] };
    const { container } = render(<PortalView />);
    await screen.findByText(party);
    const paper = container.querySelector<HTMLElement>(".paper-texture")!;
    for (const expected of [number, partyLabel, "Dubai, UAE", "100123456700003", issuedLabel, dueLabel,
      fmtDate("2026-10-08"), fmtDate("2026-10-22"), "Oil pail", "75.00"]) expect(paper).toHaveTextContent(expected);
    expect(screen.queryByText("Payment received - thank you!")).not.toBeInTheDocument();
  });

  it("preserves invoice identities, references, payment snapshot, tax categories and frozen FX through the public projection", async () => {
    currentSharedDoc = { ...sharedDoc, doc: { ...sharedDoc.doc,
      currency: "USD", unit_price_formula: null, round_off: false, advance_applied: 5, aed_exchange_rate: 3.67, fx_rate: 1,
      seller_city: "Dubai", seller_country_subdivision: "DXB", seller_legal_id: "SELLER-LICENSE", seller_legal_id_type: "TL",
      buyer_city: "Abu Dhabi", buyer_country_subdivision: "AUH", buyer_country_code: "AE",
      invoice_type_code: "381", payment_means_code: "30", original_invoice_number: "ORIGINAL-99", original_invoice_date: "2026-10-01", date_of_supply: "2026-10-02",
      einvoice: { uuid: "0e3d9d76-e6d1-444f-bec3-32438ac81c9d", credit_reason: "DL8.61.1.C", payment_account_id: "DOCUMENT-BANK", payment_account_name: "Document payee",
        seller: { tin: "1001234567", legal_authority: "Seller authority" }, buyer: { tin: "1007654321", legal_id: "BUYER-LICENSE", legal_id_type: "TL", phone: "+971 50 444 5566" } },
      custom_columns: [{ key: "litres", label: "T.Liters" }],
    }, items: [
      { description: "Exempt service", qty: 2, unit: "HUR", unit_price: 10, tax_category: "E", custom: { einvoice_exemption_code: "DL8.46.1", litres: "40" } },
      { description: "Reverse charge", qty: 2, unit: "KGM", unit_price: 10, tax_category: "AE", custom: { einvoice_nature: "DL8.48.3.1", einvoice_gtin: "6291041500213" } },
    ] };
    const { container } = render(<PortalView />);
    await waitFor(() => expect(container.querySelector('[data-invoice-details="additional"]')).not.toBeNull());
    const paper = container.querySelector<HTMLElement>(".paper-texture")!;
    const text = paper.textContent || "";
    for (const expected of ["SELLER-LICENSE", "BUYER-LICENSE", "1001234567", "1007654321", "DOCUMENT-BANK", "Document payee", "ORIGINAL-99", "2026-10-01", "2026-10-02", "DL8.61.1.C", "DL8.46.1", "DL8.48.3.1", "6291041500213", "1 USD = 3.67 AED", "VAT total in AED: 0.00 AED", "+971 50 444 5566", "0e3d9d76-e6d1-444f-bec3-32438ac81c9d"]) expect(text).toContain(expected);
    const totals = within(paper);
    expect(totals.getByText("VAT (5%)").parentElement).toHaveTextContent("0.00");
    expect(totals.getByText("Total").parentElement).toHaveTextContent("40.00");
    expect(totals.getByText("Balance due").parentElement).toHaveTextContent("35.00");
    expect(paper.querySelector('[data-invoice-party="buyer"]')).toHaveTextContent("+971 50 444 5566");
    expect(text).toContain("T.Liters");
    expect(container.querySelector("[data-einvoice-details-sheet]")).toBeNull();
    expect(container.querySelectorAll(".paper-texture")).toHaveLength(1);
  });

  it("does not add invoice-only identity fields to shared quotations", async () => {
    currentSharedDoc = { ...sharedDoc, doc_type: "quotation", doc: { ...sharedDoc.doc, einvoice: { buyer: { identifier: "INVOICE-ONLY-ID" } } } };
    const { container } = render(<PortalView />);
    await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull());
    expect(container.querySelector("[data-invoice-details]")).toBeNull();
    expect(container.textContent).not.toContain("INVOICE-ONLY-ID");
  });
});
