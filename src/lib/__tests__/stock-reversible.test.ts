// Stock moves must be reversible. Every posting path in api.ts has an undo
// (revert an invoice to draft, delete a bill), so applying a delta and then its
// negation has to land back where it started — including when the sale took the
// product below zero. Clamping at zero broke that: the overshoot was discarded
// on the way down and handed back on the way up, inventing stock.
import { describe, it, expect, beforeEach } from "vitest";
import { localClient } from "../localdb";
import { erp } from "../api";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
});

const qtyOf = async (id: number): Promise<number> => {
  const { data } = await localClient.from("products").select("*").eq("id", id).single();
  return Number((data as { quantity: number }).quantity);
};

describe("stock adjustments", () => {
  it("round-trips through an oversell", async () => {
    await localClient.from("products").insert({ name: "Widget", quantity: 3 });

    await erp.updateStock(1, -5, "Invoice INV-2026-0001"); // sold 5, held 3
    expect(await qtyOf(1)).toBe(-2); // owes 2, not 0

    await erp.updateStock(1, 5, "Posting reversed");
    expect(await qtyOf(1)).toBe(3); // back where it started
  });

  it("round-trips normally when stock covers the sale", async () => {
    await localClient.from("products").insert({ name: "Widget", quantity: 10 });

    await erp.updateStock(1, -4, "sale");
    expect(await qtyOf(1)).toBe(6);
    await erp.updateStock(1, 4, "reversed");
    expect(await qtyOf(1)).toBe(10);
  });

  it("logs the true movement even when it goes negative", async () => {
    await localClient.from("products").insert({ name: "Widget", quantity: 1 });

    await erp.updateStock(1, -3, "oversold");

    const { data } = await localClient.from("stock_movements").select("*");
    const moves = data as { qty: number }[];
    // The ledger already recorded -3; the product row now agrees with it.
    expect(moves.map((m) => Number(m.qty))).toEqual([-3]);
    expect(await qtyOf(1)).toBe(-2);
  });
});
