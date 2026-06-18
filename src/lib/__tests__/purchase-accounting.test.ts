import { beforeEach, describe, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { pos, fin } from "../api";

// Money path: a received purchase order must post to Accounting (debit
// Purchases, credit Accounts Payable) and fully reverse when reverted to draft.
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});

const po = (status: string) =>
  ({
    po_number: "PO-1",
    supplier_name: "Acme Supplies",
    status,
    order_date: "2026-06-18",
    currency: "AED",
    template: "uae",
    items: [{ description: "Widget", quantity: 2, unit_cost: 50 }], // total 100
  }) as any;

describe("purchase order → accounting", () => {
  it("posts Purchases + Accounts Payable when received", async () => {
    await pos.save(po("received"));
    const descs = (await fin.transactions()).map((t) => t.description);
    expect(descs).toContain("PO PO-1 — Purchases");
    expect(descs).toContain("PO PO-1 — Accounts Payable");
  });

  it("does NOT post while still a draft", async () => {
    await pos.save(po("draft"));
    const txns = await fin.transactions();
    expect(txns.some((t) => String(t.description).startsWith("PO PO-1"))).toBe(false);
  });

  it("reverses the footprint when reverted to draft", async () => {
    const id = (await pos.save(po("received"))) as number;
    await pos.setStatus(id, "draft");
    const txns = await fin.transactions();
    expect(txns.some((t) => String(t.description).startsWith("PO PO-1"))).toBe(false);
  });
});
