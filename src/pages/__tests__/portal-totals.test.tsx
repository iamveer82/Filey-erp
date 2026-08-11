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

vi.mock("../../lib/supabase", () => ({
  supabase: { rpc: async () => ({ data: sharedDoc, error: null }) },
  invokeFn: async () => ({ data: null, error: null }),
  isConfigured: true,
  cloudConfigured: true,
  sb: () => ({}),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));

import PortalView from "../PortalView";

describe("public portal totals", () => {
  beforeEach(() => {
    window.location.hash = "#/portal/tok-1";
  });

  it("applies the doc formula, per-line discount and round-off", async () => {
    const { container } = render(<PortalView />);
    await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull());
    const text = container.textContent ?? "";
    expect(text).toContain("284.00");
    // The pre-discount, pre-round figure must not be what the customer sees.
    expect(text).not.toContain("315.00");
  });
});
