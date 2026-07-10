// Reconciliation persistence: fin.markReconciled stamps reconciled_at on the
// local store (and the write lands in the sync journal for the cloud push).
import { describe, it, expect, beforeEach } from "vitest";
import { localClient, journalSnapshot } from "../localdb";
import { fin } from "../api";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
});

describe("fin.markReconciled", () => {
  it("stamps reconciled_at and journals the table", async () => {
    await localClient.from("transactions").insert([
      { account_id: 1, txn_type: "debit", amount: 100, txn_date: "2026-07-01" },
      { account_id: 1, txn_type: "credit", amount: 50, txn_date: "2026-07-02" },
    ]);

    await fin.markReconciled([1]);

    const { data } = await localClient.from("transactions").select("*");
    const rows = data as { id: number; reconciled_at?: string }[];
    expect(rows.find((r) => r.id === 1)?.reconciled_at).toBeTruthy();
    expect(rows.find((r) => r.id === 2)?.reconciled_at).toBeUndefined();

    const j = await journalSnapshot();
    expect(j.tables.transactions).toBeTruthy();
  });
});
