import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { fin } from "../api";
import { fileBytes, getSavedFile, uploadUserFile } from "../files";
import { expenseTotals, validateExpense, validateReceipt, type ExpenseDetails } from "../expenseDetails";

beforeEach(() => { localStorage.clear(); localStorage.setItem("filey_data_mode", "local"); vi.stubGlobal("Blob", NodeBlob); vi.stubGlobal("File", NodeFile); });
afterEach(() => vi.unstubAllGlobals());
const detail = (): ExpenseDetails => ({ version: 1, submission_id: crypto.randomUUID(), vendor: "Receipt fixture", reference: "TEST-1", currency: "USD", fx_rate: 3.6725,
  items: [{ description: "Paper", qty: 2, unit: "box", unit_price: 15 }, { description: "Ink", qty: 1, unit: "pcs", unit_price: 20 }], discount: 5, tax_rate: 5, payment_method: "Cash", payment_account_id: null, notes: "Disposable test" });

it("preserves itemized foreign-currency expense and receipt bytes, prevents duplicate retries and reverses the ledger on deletion", async () => {
  const cogs = await fin.createAccount({ code: "5100", name: "Cost of Goods Sold", account_type: "expense", balance: 0 } as never);
  const file = new File(["%PDF-receipt-fixture"], "receipt.pdf", { type: "application/pdf" });
  const fileId = await uploadUserFile(file, "expense-receipt");
  const details = { ...detail(), receipt: { id: fileId, name: file.name, mime: file.type, size: file.size } };
  expect(expenseTotals(details)).toEqual({ subtotal: 50, discount: 5, tax: 2.25, total: 47.25 });
  const id = await fin.createExpense("Office Supplies", "Supplies", 173.53, "2026-09-13", null, details);
  expect(await fin.createExpense("Office Supplies", "Supplies", 173.53, "2026-09-13", null, details)).toBe(id);
  expect((await fin.expenses())).toHaveLength(1);
  expect((await fin.getExpense(id)).details).toEqual(details);
  expect((await fin.getExpense(id)).account_id).not.toBe(cogs);
  expect(new TextDecoder().decode((await fileBytes(await getSavedFile(fileId)))!)).toBe("%PDF-receipt-fixture");
  const postings = await fin.transactions();
  expect(postings).toHaveLength(2);
  expect(postings.map(post => post.amount)).toEqual([173.53, 173.53]);
  await fin.deleteExpense(id);
  expect(await fin.expenses()).toEqual([]);
  expect(await fin.transactions()).toEqual([]);
  expect((await fin.accounts()).every(account => account.balance === 0)).toBe(true);
  expect(await getSavedFile(fileId)).toMatchObject({ name: "receipt.pdf" });
});

it("rolls back expense and ledger together when device storage fails", async () => {
  const original = Storage.prototype.setItem;
  let failed = false;
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "localdb:transactions" && !failed) { failed = true; throw new Error("Disk full"); }
    original.call(this, key, value);
  });
  try { await expect(fin.createExpense("Rent", "Office", 50, "2026-09-13", null)).rejects.toThrow("Disk full"); }
  finally { spy.mockRestore(); }
  expect(await fin.expenses()).toEqual([]);
  expect(await fin.transactions()).toEqual([]);
  expect(await fin.accounts()).toEqual([]);
});

it("validates dates, totals, quantities and attachment types before any accounting writes", async () => {
  const details = detail();
  expect(() => validateExpense("Office", 1, "2026-09-13", details)).toThrow("does not match");
  expect(() => validateExpense("Office", 173.53, "2026-02-31", details)).toThrow("valid expense date");
  expect(() => validateExpense("Office", 173.53, "2026-09-13", { ...details, items: [{ ...details.items[0], qty: -1 }] })).toThrow("Item 1");
  expect(() => validateReceipt(new File(["html"], "receipt.html", { type: "text/html" }))).toThrow("PDF");
  await expect(fin.createExpense("Office", null, -50, "2026-09-13", null)).rejects.toThrow("greater than zero");
  const asset = await fin.createAccount({ code: "1010", name: "Cash", account_type: "asset", balance: 0 } as never);
  await expect(fin.createExpense("Office", null, 50, "2026-09-13", asset)).rejects.toThrow("expense account");
  expect(await fin.expenses()).toEqual([]);
  expect(await fin.transactions()).toEqual([]);
});
