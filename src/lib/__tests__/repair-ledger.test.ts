// Ledger repair may remove replayed source postings, but identical manual
// entries and shared reference text are not proof of a duplicate. Reversing a
// known duplicate must also retain the account's unjournaled opening balance.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { localClient } from "../localdb";
import { fin, setCacheOrg } from "../api";

const orgId = "repair-ledger-test-org";
const userId = "repair-ledger-test-owner";
const identity = { org_id: orgId, user_id: userId };
const insert = async (table: string, rows: Record<string, unknown>[]) => {
  const { error } = await localClient.from(table).insert(rows.map(row => ({ ...identity, ...row })));
  expect(error).toBeNull();
};

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  setCacheOrg(null);
  setCacheOrg(orgId, userId);
  // These are persisted legacy documents and receipts, rather than new
  // workflow calls: the fixture intentionally reproduces their old double
  // postings without generating an additional correct journal via the API.
  await insert("crm_customers", [{ id: 1, name: "Acme" }]);
  await insert("suppliers", [{ id: 2, name: "Supplier" }]);
  await insert("invoice_docs", [7, 9].map(id => ({ id, number: `INV-REPAIR-${id}`,
    customer_id: 1, customer_name: "Acme", status: "sent", issue_date: "2026-07-01",
    currency: "AED", tax_rate: 0, discount: 0 })));
  await insert("invoice_doc_items", [7, 9].map(invoice_id => ({ invoice_id,
    description: "Goods", qty: 1, unit_price: 10000, position: 0 })));
  await insert("invoice_payments", [
    { id: 101, invoice_id: 7, amount: 1000, method: "bank", paid_at: "2026-07-01" },
    { id: 102, invoice_id: 9, amount: 1000, method: "bank", paid_at: "2026-07-01" },
  ]);
  await insert("purchase_orders", [{ id: 5, po_number: "PO-REPAIR", supplier_id: 2,
    supplier_name: "Supplier", status: "received", currency: "AED", tax_rate: 0, discount: 0 }]);
  await insert("purchase_order_items", [{ po_id: 5, description: "Goods", quantity: 1, unit_price: 300 }]);
});
afterEach(() => setCacheOrg(null));

const balanceOf = async (id: number): Promise<number> => {
  const { data, error } = await localClient.from("accounts").select("*").eq("id", id).single();
  expect(error).toBeNull();
  return Number(data.balance);
};
const storedBalance = async (id: number, balance: number) => {
  const { error } = await localClient.from("accounts").update({ balance }).eq("id", id);
  expect(error).toBeNull();
};
const cashAccounts = (opening = 50000) => insert("accounts", [
  { id: 1, code: "1010", name: "Bank", account_type: "asset", balance: opening },
  { id: 2, code: "1200", name: "Accounts Receivable", account_type: "asset", balance: 10000 },
]);
const receipt = (amount = 1000, invoice_id = 7, workflow_payment_id = 101) => [
  { account_id: 1, txn_type: "debit", amount },
  { account_id: 2, txn_type: "credit", amount },
].map(leg => ({ ...leg, invoice_id, workflow_payment_id, source: "payment",
  ref: "Legacy receipt", description: "Receipt", txn_date: "2026-07-01" }));
const journal = async () => (await localClient.from("transactions").select("*")).data;


describe("fin.repairLedger", () => {
  it("removes the duplicate source bundle and keeps the opening balance", async () => {
    await cashAccounts();
    await insert("transactions", [...receipt(), ...receipt()]);
    await storedBalance(1, 52000);
    await storedBalance(2, 8000);

    const { removed } = await fin.repairLedger();

    expect(removed).toBe(2); // one repeated debit and its matching credit
    expect(await balanceOf(1)).toBe(51000); // 50,000 opening + one 1,000 receipt
    expect(await balanceOf(2)).toBe(9000);
    expect(await journal()).toHaveLength(2);
  });

  it("is idempotent — a second run changes nothing", async () => {
    await cashAccounts();
    await insert("transactions", [...receipt(), ...receipt()]);
    await storedBalance(1, 52000);
    await storedBalance(2, 8000);

    expect((await fin.repairLedger()).removed).toBe(2);
    const once = await Promise.all([balanceOf(1), balanceOf(2)]);
    const second = await fin.repairLedger();

    expect(second.removed).toBe(0);
    expect(await Promise.all([balanceOf(1), balanceOf(2)])).toEqual(once);
    expect(await journal()).toHaveLength(2);
  });

  it("undoes a counted duplicate without discarding other journal activity", async () => {
    await cashAccounts(0);
    const { error } = await localClient.from("invoice_payments").update({ amount: 700 }).eq("id", 101);
    expect(error).toBeNull();
    await insert("transactions", [...receipt(700),
      { account_id: 1, txn_type: "credit", amount: 200, description: "B", txn_date: "2026-07-02" },
      ...receipt(700)]);
    await storedBalance(1, 1200);
    await storedBalance(2, 8600);

    expect((await fin.repairLedger()).removed).toBe(2);

    expect(await balanceOf(1)).toBe(500); // 700 - 200, duplicate 700 undone
    expect(await balanceOf(2)).toBe(9300);
    expect(await journal()).toHaveLength(3);
  });

  it("respects account type when undoing a duplicate on a liability", async () => {
    await insert("accounts", [
      { id: 1, code: "2000", name: "Accounts Payable", account_type: "liability", balance: 600 },
      { id: 2, code: "1300", name: "Inventory", account_type: "asset", balance: 600 },
    ]);
    const bill = [
      { account_id: 1, txn_type: "credit" },
      { account_id: 2, txn_type: "debit" },
    ].map(leg => ({ ...leg, po_id: 5, source: "purchase", ref: "PO PO-REPAIR",
      amount: 300, description: "Bill", txn_date: "2026-07-01" }));
    await insert("transactions", [...bill, ...bill]);

    expect((await fin.repairLedger()).removed).toBe(2);

    expect(await balanceOf(1)).toBe(300); // a liability grows with a credit
    expect(await balanceOf(2)).toBe(300);
  });

  it("preserves legitimate identical manual entries", async () => {
    await cashAccounts();
    const manual = { account_id: 1, txn_type: "debit", amount: 1000,
      description: "Receipt", txn_date: "2026-07-01" };
    await insert("transactions", [manual, manual]);
    await storedBalance(1, 52000);

    expect((await fin.repairLedger()).removed).toBe(0);
    expect(await balanceOf(1)).toBe(52000);
    expect(await journal()).toHaveLength(2);
  });

  it("preserves ref-only history without an immutable source identity", async () => {
    await cashAccounts();
    const legacy = receipt().map(({ invoice_id: _invoice, workflow_payment_id: _payment, ...leg }) => leg);
    await insert("transactions", [...legacy, ...legacy]);
    await storedBalance(1, 52000);
    await storedBalance(2, 8000);

    expect((await fin.repairLedger()).removed).toBe(0);
    expect(await balanceOf(1)).toBe(52000);
    expect(await balanceOf(2)).toBe(8000);
    expect(await journal()).toHaveLength(4);
  });

  it("preserves equal reference text belonging to distinct saved payments on one invoice", async () => {
    await cashAccounts();
    const { error } = await localClient.from("invoice_payments").update({ invoice_id: 7 }).eq("id", 102);
    expect(error).toBeNull();
    await insert("transactions", [...receipt(), ...receipt(1000, 7, 102)]);
    await storedBalance(1, 52000);
    await storedBalance(2, 8000);

    expect((await fin.repairLedger()).removed).toBe(0);
    expect(await balanceOf(1)).toBe(52000);
    expect(await balanceOf(2)).toBe(8000);
    expect(await journal()).toHaveLength(4);
  });

  it("preserves ambiguous legacy payments linked only to their invoice", async () => {
    await cashAccounts();
    const { error } = await localClient.from("invoice_payments").update({ invoice_id: 7 }).eq("id", 102);
    expect(error).toBeNull();
    // Both legitimate receipts have the same old generic ref. Their journal
    // rows do not carry the payment IDs, so the common invoice is insufficient
    // evidence that one receipt was replayed.
    const legacy = receipt().map(({ workflow_payment_id: _payment, ...leg }) => leg);
    await insert("transactions", [...legacy, ...legacy]);
    await storedBalance(1, 52000);
    await storedBalance(2, 8000);

    expect((await fin.repairLedger()).removed).toBe(0);
    expect(await balanceOf(1)).toBe(52000);
    expect(await balanceOf(2)).toBe(8000);
    expect(await journal()).toHaveLength(4);
  });

  it("does not merge otherwise identical source history recorded by different owners", async () => {
    await cashAccounts();
    await insert("transactions", [...receipt(), ...receipt().map(leg => ({
      ...leg, user_id: "historic-other-owner",
    }))]);
    await storedBalance(1, 52000);
    await storedBalance(2, 8000);

    expect((await fin.repairLedger()).removed).toBe(0);
    expect(await balanceOf(1)).toBe(52000);
    expect(await balanceOf(2)).toBe(8000);
    expect(await journal()).toHaveLength(4);
  });
});
