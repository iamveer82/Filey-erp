import { beforeEach, describe, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { billing, fin } from "../api";

// Money path: balances must be natural-positive (matching the Reports page) and
// reversals must net to zero — the old fixed-sign reverse doubled AR/expense.
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});

const bal = (accts: { name: string; balance: number }[], re: RegExp) =>
  accts.find((a) => re.test(a.name))?.balance ?? 0;

describe("accounting sign convention", () => {
  it("invoice posts AR + Sales, then reverts to zero (no doubling)", async () => {
    const id = (await billing.saveDoc({
      number: "INV-1",
      status: "sent",
      currency: "AED",
      tax_rate: 0,
      discount: 0,
      customer_name: "X",
      items: [{ description: "a", qty: 1, unit_price: 100 }],
    } as any)) as number;

    let accts = await fin.accounts();
    expect(bal(accts, /receivable/i)).toBe(100); // debtor up
    expect(bal(accts, /sales|revenue/i)).toBe(100); // revenue up

    await billing.setStatus(id, "draft");
    accts = await fin.accounts();
    expect(bal(accts, /receivable/i)).toBe(0); // fully reversed, not 200
    expect(bal(accts, /sales|revenue/i)).toBe(0);
  });

  it("re-finalizing twice does not double AR", async () => {
    const id = (await billing.saveDoc({
      number: "INV-2",
      status: "sent",
      currency: "AED",
      tax_rate: 0,
      discount: 0,
      customer_name: "Y",
      items: [{ description: "b", qty: 1, unit_price: 50 }],
    } as any)) as number;
    await billing.setStatus(id, "draft");
    await billing.setStatus(id, "sent");
    const accts = await fin.accounts();
    expect(bal(accts, /receivable/i)).toBe(50); // still 50, not 100
  });

  it("expense increases the expense account (positive)", async () => {
    await fin.createExpense("Rent", "Office", 200, "2026-06-18", null);
    const accts = await fin.accounts();
    expect(bal(accts, /operating|expense|general/i)).toBe(200);
  });
});
