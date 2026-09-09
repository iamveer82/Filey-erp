import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { setDataMode } from "../dataMode";
import { pos, fin } from "../api";
import { sb } from "../supabase";
import { useReportsData } from "../../pages/reports/useReportsData";

// Money path: a received purchase order must post to Accounting (debit
// Purchases, credit Accounts Payable) and fully reverse when reverted to draft.
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});
afterEach(cleanup);

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
    expect(descs).toContain("PO PO-1 — Inventory");
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

  it("splits Input VAT and books gross Accounts Payable when the PO has tax", async () => {
    await pos.save({ ...po("received"), tax_rate: 5 }); // net 100, 5% VAT
    const accts = await fin.accounts();
    const bal = (re: RegExp) => accts.find((a) => re.test(a.name))?.balance ?? 0;
    expect(bal(/inventory|stock/i)).toBeCloseTo(100); // net, ex-VAT
    expect(bal(/input vat/i)).toBeCloseTo(5); // recoverable VAT (asset)
    expect(bal(/payable/i)).toBeCloseTo(105); // gross owed to supplier

    // Double-entry still balances: debits (100 + 5) == credits (105).
    const txns = await fin.transactions();
    const d = txns
      .filter((t) => t.txn_type === "debit")
      .reduce((s, t) => s + Number(t.amount), 0);
    const c = txns
      .filter((t) => t.txn_type === "credit")
      .reduce((s, t) => s + Number(t.amount), 0);
    expect(d).toBeCloseTo(c);
  });
});

it("posts foreign-currency PO amounts in the ledger currency without taxing VAT twice", async () => {
  const id = await pos.save({ ...po("received"), currency:"USD", fx_rate:3.6725, tax_rate:5 });
  // Old rows stored a net-only total. Reading must still agree with the PDF.
  await sb().from("purchase_orders").update({ total:100 }).eq("id", id);
  expect((await pos.get(id)).total).toBe(105);
  expect((await pos.list()).find(row => row.id === id)?.total).toBe(105);
  const accounts = await fin.accounts();
  const balance = (re: RegExp) => accounts.find(a => re.test(a.name))?.balance ?? 0;
  expect(balance(/inventory|stock/i)).toBeCloseTo(367.25);
  expect(balance(/input vat/i)).toBeCloseTo(18.36);
  expect(balance(/payable/i)).toBeCloseTo(385.61);
});

it("uses the same frozen PO rate for reported purchases and their payments", async () => {
  const id = await pos.save({ ...po("received"), currency: "USD", fx_rate: 4, tax_rate: 0 });
  await pos.addPayment(id, 50);
  expect((await pos.list()).find(row => row.id === id)?.fx_rate).toBe(4);
  const { result } = renderHook(() => useReportsData());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe("");
  expect(result.current.poList.find(row => row.id === id)?.total).toBe(400);
  expect(result.current.poPayments).toEqual([{ po_id: id, amount: 200 }]);
});
