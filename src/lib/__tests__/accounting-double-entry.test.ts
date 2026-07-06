import { beforeEach, describe, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { fin, billing, erp, advances } from "../api";

// Money path: every posting must keep total debits == total credits, and the
// balance sign must follow each account's normal balance (asset/expense grow on
// a debit). These guard the single-sided + type-blind bugs that were fixed.
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});

const sums = async () => {
  const txns = await fin.transactions();
  const d = txns
    .filter((t) => t.txn_type === "debit")
    .reduce((s, t) => s + Number(t.amount), 0);
  const c = txns
    .filter((t) => t.txn_type === "credit")
    .reduce((s, t) => s + Number(t.amount), 0);
  return { d, c };
};

describe("accounting double-entry", () => {
  it("an expense posts equal debit and credit legs", async () => {
    await fin.createExpense("Rent", "Office", 500, "2026-06-19", null);
    const { d, c } = await sums();
    expect(d).toBeCloseTo(500);
    expect(c).toBeCloseTo(500);
  });

  it("a manual debit increases an asset account (type-aware sign)", async () => {
    const id = (await fin.createAccount({
      code: "1500",
      name: "Equipment",
      account_type: "asset",
      balance: 0,
    } as never)) as number;
    await fin.postTransaction(id, "debit", 200, "buy");
    const acct = (await fin.accounts()).find((a) => a.id === id);
    expect(acct?.balance).toBeCloseTo(200);
  });

  it("deleting a posting restores the balance", async () => {
    const id = (await fin.createAccount({
      code: "1600",
      name: "Tools",
      account_type: "asset",
      balance: 0,
    } as never)) as number;
    const txnId = (await fin.postTransaction(id, "debit", 80, "x")) as number;
    await fin.deleteTransaction(txnId);
    const acct = (await fin.accounts()).find((a) => a.id === id);
    expect(acct?.balance).toBeCloseTo(0);
  });

  it("re-finalizing an invoice does not duplicate ledger entries", async () => {
    const doc = {
      number: "INV-1",
      status: "sent",
      currency: "AED",
      tax_rate: 0,
      discount: 0,
      customer_name: "Acme",
      items: [{ description: "Widget", qty: 1, unit_price: 100 }],
    };
    const id = (await billing.saveDoc(doc as never)) as number;
    await billing.saveDoc({ ...doc, id } as never); // edit / re-finalize
    const invTxns = (await fin.transactions()).filter((t) =>
      String(t.description).startsWith("Invoice INV-1")
    );
    expect(invTxns.length).toBe(2); // AR + Revenue, not 4
  });

  it("a sales invoice books VAT separately from revenue", async () => {
    await billing.saveDoc({
      number: "INV-VAT",
      status: "sent",
      currency: "AED",
      tax_rate: 5,
      discount: 0,
      customer_name: "Acme",
      items: [{ description: "Widget", qty: 1, unit_price: 100 }],
    } as never);
    const accts = await fin.accounts();
    const bal = (re: RegExp) => accts.find((a) => re.test(a.name))?.balance ?? 0;
    expect(bal(/sales revenue/i)).toBeCloseTo(100); // net, ex-VAT
    expect(bal(/output vat/i)).toBeCloseTo(5); // VAT liability
    expect(bal(/receivable/i)).toBeCloseTo(105); // gross owed
  });

  it("a sale books COGS and relieves inventory at cost", async () => {
    const pid = (await erp.createProduct({
      sku: "W1",
      name: "Widget",
      unit_price: 100,
      cost_price: 60,
      quantity: 10,
      reorder_level: 0,
    } as never)) as number;
    await billing.saveDoc({
      number: "INV-COGS",
      status: "sent",
      currency: "AED",
      tax_rate: 0,
      discount: 0,
      customer_name: "Acme",
      items: [{ description: "Widget", qty: 1, unit_price: 100, product_id: pid }],
    } as never);
    const accts = await fin.accounts();
    const bal = (re: RegExp) => accts.find((a) => re.test(a.name))?.balance ?? 0;
    expect(bal(/cost of goods/i)).toBeCloseTo(60); // COGS expense booked
    expect(bal(/inventory|stock/i)).toBeCloseTo(-60); // inventory relieved at cost
    expect(bal(/sales revenue/i)).toBeCloseTo(100); // revenue unaffected
  });

  it("repairLedger removes duplicates and recomputes balances", async () => {
    const id = (await fin.createAccount({
      code: "1700",
      name: "Van",
      account_type: "asset",
      balance: 0,
    } as never)) as number;
    await fin.postTransaction(id, "debit", 300, "Van purchase");
    await fin.postTransaction(id, "debit", 300, "Van purchase"); // identical → dup
    expect((await fin.accounts()).find((a) => a.id === id)?.balance).toBeCloseTo(600);

    const { removed } = await fin.repairLedger();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect((await fin.accounts()).find((a) => a.id === id)?.balance).toBeCloseTo(300);
  });

  it("deleting an invoice restores the advance credit it consumed", async () => {
    await advances.add({
      party_type: "customer",
      party_id: 1,
      party_name: "Acme",
      amount: 100,
    });
    const id = (await billing.saveDoc({
      number: "INV-ADV",
      status: "draft",
      currency: "AED",
      tax_rate: 0,
      discount: 0,
      customer_id: 1,
      customer_name: "Acme",
      items: [{ description: "Widget", qty: 1, unit_price: 100 }],
    } as never)) as number;
    await advances.applyToInvoice(1, "Acme", id, 40);
    expect(await advances.creditFor(1)).toBeCloseTo(60);

    await billing.deleteDoc(id);
    expect(await advances.creditFor(1)).toBeCloseTo(100); // consumption purged
  });
});
