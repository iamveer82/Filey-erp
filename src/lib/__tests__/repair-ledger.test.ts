// fin.repairLedger drops duplicate journal entries and re-derives balances.
// The thing it must NOT do is throw away the part of a balance that was never
// a transaction: createAccount stores an opening balance straight on the row
// and posts no journal entry for it, so recomputing purely from transactions
// zeroes every account that was opened with money in it.
import { describe, it, expect, beforeEach } from "vitest";
import { localClient } from "../localdb";
import { fin } from "../api";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
});

const balanceOf = async (id: number): Promise<number> => {
  const { data } = await localClient.from("accounts").select("*").eq("id", id).single();
  return Number((data as { balance: number }).balance);
};

describe("fin.repairLedger", () => {
  it("removes the duplicate and keeps the opening balance", async () => {
    // Bank account opened with 50,000 on the books, no journal entry for it.
    await localClient
      .from("accounts")
      .insert({ name: "Bank", account_type: "asset", balance: 50000 });
    // One 1,000 receipt, posted twice by the legacy bug. Both are reflected in
    // the stored balance: 50,000 + 1,000 + 1,000.
    await localClient.from("transactions").insert([
      { account_id: 1, txn_type: "debit", amount: 1000, description: "Receipt", txn_date: "2026-07-01" },
      { account_id: 1, txn_type: "debit", amount: 1000, description: "Receipt", txn_date: "2026-07-01" },
    ]);
    await localClient.from("accounts").update({ balance: 52000 }).eq("id", 1);

    const { removed } = await fin.repairLedger();

    expect(removed).toBe(1);
    expect(await balanceOf(1)).toBe(51000); // 50,000 opening + one 1,000 receipt
    const { data } = await localClient.from("transactions").select("*");
    expect(data).toHaveLength(1);
  });

  it("is idempotent — a second run changes nothing", async () => {
    await localClient
      .from("accounts")
      .insert({ name: "Bank", account_type: "asset", balance: 50000 });
    await localClient.from("transactions").insert([
      { account_id: 1, txn_type: "debit", amount: 1000, description: "Receipt", txn_date: "2026-07-01" },
      { account_id: 1, txn_type: "debit", amount: 1000, description: "Receipt", txn_date: "2026-07-01" },
    ]);
    await localClient.from("accounts").update({ balance: 52000 }).eq("id", 1);

    await fin.repairLedger();
    const once = await balanceOf(1);
    const second = await fin.repairLedger();

    expect(second.removed).toBe(0);
    expect(await balanceOf(1)).toBe(once);
  });

  it("still corrects a balance that drifted from its journal", async () => {
    await localClient
      .from("accounts")
      .insert({ name: "Bank", account_type: "asset", balance: 0 });
    await localClient.from("transactions").insert([
      { account_id: 1, txn_type: "debit", amount: 700, description: "A", txn_date: "2026-07-01" },
      { account_id: 1, txn_type: "credit", amount: 200, description: "B", txn_date: "2026-07-02" },
    ]);
    // Balance says 500 and the journal agrees; add a duplicate that was also
    // double-counted into the stored figure.
    await localClient
      .from("transactions")
      .insert({ account_id: 1, txn_type: "debit", amount: 700, description: "A", txn_date: "2026-07-01" });
    await localClient.from("accounts").update({ balance: 1200 }).eq("id", 1);

    await fin.repairLedger();

    expect(await balanceOf(1)).toBe(500); // 700 - 200, duplicate 700 undone
  });

  it("respects account type when undoing a duplicate on a liability", async () => {
    // Credit increases a liability, so removing a duplicate credit must
    // decrease the balance, not increase it.
    await localClient
      .from("accounts")
      .insert({ name: "Accounts Payable", account_type: "liability", balance: 0 });
    await localClient.from("transactions").insert([
      { account_id: 1, txn_type: "credit", amount: 300, description: "Bill", txn_date: "2026-07-01" },
      { account_id: 1, txn_type: "credit", amount: 300, description: "Bill", txn_date: "2026-07-01" },
    ]);
    await localClient.from("accounts").update({ balance: 600 }).eq("id", 1);

    await fin.repairLedger();

    expect(await balanceOf(1)).toBe(300);
  });
});
