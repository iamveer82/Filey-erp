import { describe, it, expect } from "vitest";
import { computeVatReturn } from "../api";

const txn = (account_name: string, txn_type: string, amount: number, txn_date: string) => ({
  account_name,
  txn_type,
  amount,
  txn_date,
});

describe("computeVatReturn", () => {
  it("nets output/input VAT and derives standard-rated net at 5%", () => {
    const r = computeVatReturn(
      [
        txn("Output VAT", "credit", 50, "2026-01-15"), // 1000 net sale
        txn("Output VAT", "credit", 25, "2026-02-10"), // 500 net sale
        txn("Input VAT", "debit", 30, "2026-01-20"), // 600 net purchase
        txn("Sales Revenue", "credit", 1000, "2026-01-15"), // ignored (not a VAT account)
      ],
      5,
      "2026-01-01",
      "2026-03-31"
    );
    expect(r.outputVat).toBe(75);
    expect(r.inputVat).toBe(30);
    expect(r.netVatDue).toBe(45);
    expect(r.standardSupplyNet).toBe(1500); // 75 / 0.05
    expect(r.standardExpenseNet).toBe(600); // 30 / 0.05
  });

  it("subtracts reversals (debit to output, credit to input)", () => {
    const r = computeVatReturn(
      [
        txn("Output VAT", "credit", 50, "2026-01-15"),
        txn("Output VAT", "debit", 50, "2026-01-16"), // invoice reverted to draft
        txn("Input VAT", "debit", 30, "2026-01-20"),
        txn("Input VAT", "credit", 10, "2026-01-21"),
      ],
      5
    );
    expect(r.outputVat).toBe(0);
    expect(r.inputVat).toBe(20);
    expect(r.netVatDue).toBe(-20); // refundable
  });

  it("filters strictly by the date range", () => {
    const r = computeVatReturn(
      [
        txn("Output VAT", "credit", 50, "2025-12-31"), // before
        txn("Output VAT", "credit", 25, "2026-01-15"), // in
        txn("Output VAT", "credit", 99, "2026-04-01"), // after
      ],
      5,
      "2026-01-01",
      "2026-03-31"
    );
    expect(r.outputVat).toBe(25);
  });

  it("falls back to 5% when the rate is missing", () => {
    const r = computeVatReturn([txn("Output VAT", "credit", 50, "2026-01-15")], 0);
    expect(r.rate).toBe(5);
    expect(r.standardSupplyNet).toBe(1000);
  });
});

const inv = (
  status: string,
  issue_date: string,
  net_by_tax_category: Record<string, number>
) => ({ status, issue_date, net_by_tax_category });

describe("computeVatReturn — boxes 3/4/5 from invoices", () => {
  it("reports zero-rated, exempt and reverse-charge net off the invoices", () => {
    const r = computeVatReturn([], 5, "2026-01-01", "2026-03-31", [
      inv("sent", "2026-01-15", { S: 1000, Z: 400 }),
      inv("paid", "2026-02-02", { E: 250, AE: 100 }),
    ]);
    expect(r.zeroRatedNet).toBe(400);
    expect(r.exemptNet).toBe(250);
    expect(r.reverseChargeNet).toBe(100);
  });

  it("ignores drafts and anything outside the period", () => {
    const r = computeVatReturn([], 5, "2026-01-01", "2026-03-31", [
      inv("draft", "2026-01-15", { Z: 999 }), // not issued — not a supply yet
      inv("sent", "2025-12-31", { Z: 111 }), // before the period
      inv("sent", "2026-04-01", { Z: 222 }), // after it
      inv("sent", "2026-03-31", { Z: 50 }), // last day counts
    ]);
    expect(r.zeroRatedNet).toBe(50);
  });

  it("reads zero for those boxes when no invoices are supplied", () => {
    const r = computeVatReturn([txn("Output VAT", "credit", 50, "2026-01-15")], 5);
    expect(r.zeroRatedNet).toBe(0);
    expect(r.exemptNet).toBe(0);
  });
});
