import { beforeEach, expect, it, vi } from "vitest";
import { localClient, withLocalTransaction, journalSnapshot } from "../localdb";
import { billing, erp, fin, hr } from "../api";

vi.mock("../exchange-rates", async (original) => ({
  ...await original<typeof import("../exchange-rates")>(),
  getExchangeRates: async () => ({ AED: 1, USD: 3.6725, EUR: 4 }),
}));
beforeEach(() => { localStorage.clear(); localStorage.setItem("filey_data_mode", "local"); });
const invoice = (extra = {}) => ({ number: "INV-SAFE", status: "sent", currency: "AED", tax_rate: 0,
  discount: 0, customer_name: "Acme", items: [{ description: "Service", qty: 1, unit_price: 100 }], ...extra }) as never;
const balance = async (pattern: RegExp) => Number((await fin.accounts()).find((row) => pattern.test(row.name))?.balance ?? 0);

it("refuses to overwrite an unreadable collection and preserves concurrent inserts and stock changes", async () => {
  localStorage.setItem("localdb:products", "broken-original");
  expect((await localClient.from("products").insert({ name: "Replacement" })).error?.message).toContain("Could not read local products");
  expect(localStorage.getItem("localdb:products")).toBe("broken-original");
  localStorage.removeItem("localdb:products");
  await Promise.all(Array.from({ length: 20 }, (_, i) => localClient.from("products").insert({ id: i + 1, name: `Product ${i}`, quantity: 0 })));
  expect((await erp.products())).toHaveLength(20);
  await Promise.all(Array.from({ length: 20 }, () => erp.updateStock(1, 0.5)));
  expect((await erp.products()).find((product) => product.id === 1)?.quantity).toBe(10);
});

it("keeps transaction writes invisible until commit and rolls back a failed second collection", async () => {
  await localClient.from("products").insert({ id: 1, name: "Original" });
  const journal = await journalSnapshot();
  const saved = Storage.prototype.setItem;
  let failed = false;
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "localdb:invoice_docs" && !failed) { failed = true; throw new Error("Disk full"); }
    saved.call(this, key, value);
  });
  try {
    await expect(withLocalTransaction(async (client) => {
      await client.from("products").update({ name: "Staged" }).eq("id", 1);
      await client.from("invoice_docs").insert({ number: "INV-FAIL" });
      expect((await localClient.from("products").select().single()).data.name).toBe("Original");
    })).rejects.toThrow("Disk full");
  } finally { spy.mockRestore(); }
  expect((await erp.products())[0].name).toBe("Original");
  expect(await billing.listDocs()).toEqual([]);
  expect(await journalSnapshot()).toEqual(journal);
});

it("does not leave an invoice header or replacement lines when their save fails", async () => {
  const saved = Storage.prototype.setItem;
  const failLines = () => vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "localdb:invoice_doc_items") throw new Error("Lines unavailable");
    saved.call(this, key, value);
  });
  let spy = failLines();
  try { await expect(billing.saveDoc(invoice({ status: "draft" }))).rejects.toThrow("Lines unavailable"); }
  finally { spy.mockRestore(); }
  expect(await billing.listDocs()).toEqual([]);
  const id = await billing.saveDoc(invoice({ status: "draft" }));
  spy = failLines();
  try { await expect(billing.saveDoc(invoice({ id, status: "draft", number: "CHANGED", items: [{ description: "Changed", qty: 3, unit_price: 50 }] }))).rejects.toThrow(); }
  finally { spy.mockRestore(); }
  expect((await billing.getDoc(id)).number).toBe("INV-SAFE");
  expect((await billing.getDoc(id)).items).toHaveLength(1);
  expect((await billing.getDoc(id)).items[0].description).toBe("Service");
});

it("rolls back invoice finalization and posted edits when stock or ledger commits fail", async () => {
  const tables = ["invoice_docs", "invoice_doc_items", "products", "orders", "stock_movements", "accounts", "transactions"];
  const snapshot = async () => ({
    records: await Promise.all(tables.map(async (table) => (await localClient.from(table).select()).data)),
    journal: await journalSnapshot(),
  });
  const saved = Storage.prototype.setItem;
  for (const docType of ["invoice", "purchase"]) {
    localStorage.clear();
    localStorage.setItem("filey_data_mode", "local");
    await localClient.from("products").insert({ id: 1, name: "Widget", quantity: 10, cost_price: 4 });
    const items = [{ description: "Widget", product_id: 1, qty: 3, unit_price: 10 }];
    const id = await billing.saveDoc(invoice({ doc_type: docType, status: "draft", items, tax_rate: 5 }));
    const draft = await snapshot();
    for (const table of ["products", "stock_movements", "transactions"]) {
      let failed = false;
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
        if (key === `localdb:${table}` && !failed) { failed = true; throw new Error("Posting unavailable"); }
        saved.call(this, key, value);
      });
      try { await expect(billing.setStatus(id, "sent")).rejects.toThrow("Posting unavailable"); }
      finally { spy.mockRestore(); }
      expect(await snapshot()).toEqual(draft);
    }
    await billing.setStatus(id, "sent");
    expect((await erp.products())[0].quantity).toBe(docType === "purchase" ? 13 : 7);
    const posted = await snapshot();
    for (const table of ["products", "transactions"]) {
      let failed = false;
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
        if (key === `localdb:${table}` && !failed) { failed = true; throw new Error("Posting unavailable"); }
        saved.call(this, key, value);
      });
      try {
        await expect(billing.saveDoc(invoice({ id, doc_type: docType, number: "CHANGED", items: [{ ...items[0], qty: 5 }] }))).rejects.toThrow("Posting unavailable");
      } finally { spy.mockRestore(); }
      expect(await snapshot()).toEqual(posted);
    }
    const transactions = await fin.transactions();
    expect(transactions.reduce((sum, row) => sum + (row.txn_type === "debit" ? 1 : -1) * Number(row.amount), 0)).toBeCloseTo(0);
  }
});

it("rejects missing and draft invoice payments before writing money records", async () => {
  await expect(billing.addPayment(999, 100, "cash", "2026-09-07")).rejects.toBeTruthy();
  const id = await billing.saveDoc(invoice({ status: "draft" }));
  await expect(billing.addPayment(id, 100, "cash", "2026-09-07")).rejects.toThrow("Finalize");
  expect((await localClient.from("invoice_payments").select()).data).toEqual([]);
  expect(await fin.transactions()).toEqual([]);
});

it("posts supplier bill payments to cash out and AP, including FX, and reverses only that payment", async () => {
  const id = await billing.saveDoc(invoice({ doc_type: "purchase", currency: "EUR", fx_rate: 3.9 }));
  const payment = await billing.addPayment(id, 100, "bank", "2026-09-07");
  expect(await balance(/payable/i)).toBeCloseTo(0);
  expect(await balance(/cash|bank/i)).toBeCloseTo(-400);
  expect(await balance(/foreign exchange/i)).toBeCloseTo(10);
  expect(await balance(/receivable/i)).toBe(0);
  const transactions = await fin.transactions();
  expect(transactions.reduce((sum, row) => sum + (row.txn_type === "debit" ? 1 : -1) * Number(row.amount), 0)).toBeCloseTo(0);
  await billing.removePayment(payment!);
  expect(await balance(/payable/i)).toBeCloseTo(390);
  expect(await balance(/cash|bank/i)).toBe(0);
  expect(await balance(/foreign exchange/i)).toBe(0);
});

it("rolls back payment, status and account changes when its ledger save fails", async () => {
  const id = await billing.saveDoc(invoice());
  const accounts = await fin.accounts();
  const saved = Storage.prototype.setItem;
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "localdb:transactions") throw new Error("Ledger unavailable");
    saved.call(this, key, value);
  });
  try { await expect(billing.addPayment(id, 100, "cash", "2026-09-07")).rejects.toThrow("Ledger unavailable"); }
  finally { spy.mockRestore(); }
  expect(await billing.payments(id)).toEqual([]);
  expect((await billing.getDoc(id)).status).toBe("sent");
  expect(await fin.accounts()).toEqual(accounts);
});

it("does not mistake a hardware asset for accounts receivable", async () => {
  await fin.createAccount({ code: "1500", name: "Hardware", account_type: "asset", balance: 50 });
  await billing.saveDoc(invoice());
  expect(await balance(/^Hardware$/)).toBe(50);
  expect(await balance(/receivable/i)).toBe(100);
});

it("preserves the collection if its pending-change journal cannot be read", async () => {
  await localClient.from("products").insert({ id: 1, name: "Keep me" });
  localStorage.setItem("syncjournal", "unreadable-original");
  const { error } = await localClient.from("products").update({ name: "Must not save" }).eq("id", 1);
  expect(error?.message).toContain("Could not read pending local changes");
  expect((await erp.products())[0].name).toBe("Keep me");
  expect(localStorage.getItem("syncjournal")).toBe("unreadable-original");
});

it("records one payroll for simultaneous and repeated employee-period requests", async () => {
  await localClient.from("employees").insert({ id: 1, name: "Asha" });
  const results = await Promise.allSettled([
    hr.runPayroll(1, "2026-09", 1000, 100, 50),
    hr.runPayroll(1, " 2026-09 ", 1000, 100, 50),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  await expect(hr.runPayroll(1, "2026-09", 1000, 100, 50)).rejects.toThrow("already recorded");
  expect(await hr.payroll()).toHaveLength(1);
  expect(await balance(/salaries/i)).toBe(1050);
  expect(await balance(/cash|bank/i)).toBe(-1050);
  expect(await fin.transactions()).toHaveLength(2);
});

it("rolls back payroll when its ledger fails, then allows a clean retry", async () => {
  await localClient.from("employees").insert({ id: 1, name: "Asha" });
  const saved = Storage.prototype.setItem;
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "localdb:transactions") throw new Error("Ledger unavailable");
    saved.call(this, key, value);
  });
  try { await expect(hr.runPayroll(1, "2026-09", 1000, 0, 0)).rejects.toThrow("Ledger unavailable"); }
  finally { spy.mockRestore(); }
  expect(await hr.payroll()).toEqual([]);
  expect(await fin.accounts()).toEqual([]);
  await hr.runPayroll(1, "2026-09", 1000, 0, 0);
  expect(await hr.payroll()).toHaveLength(1);
});
