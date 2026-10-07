// Advance credit available to an invoice. The ledger is a list of entries per
// party: deposits positive, consumptions negative, balance = the sum. What a
// given invoice may draw on is that balance with its OWN prior consumption
// added back, so editing the applied amount rebalances against the right pool.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { localClient } from "../localdb";
import { advances, billing, crm, setCacheOrg } from "../api";

const orgId = "advance-credit-test-org";
const userId = "advance-credit-test-owner";
let acme: number;
let globex: number;
let invoiceSequence: number;

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  setCacheOrg(null);
  setCacheOrg(orgId, userId);
  acme = await crm.createCustomer({ name: "Acme" } as never);
  globex = await crm.createCustomer({ name: "Globex" } as never);
  expect(acme).toBeGreaterThan(0);
  expect(globex).toBeGreaterThan(0);
  invoiceSequence = 0;
});
afterEach(() => setCacheOrg(null));

const savedInvoice = (customerId = acme, customerName = "Acme") =>
  billing.saveDoc({
    number: `INV-ADVANCE-${++invoiceSequence}`,
    status: "draft",
    customer_id: customerId,
    customer_name: customerName,
    issue_date: "2026-07-01",
    currency: "AED",
    tax_rate: 0,
    discount: 0,
    items: [{ description: "Goods", qty: 1, unit_price: 5000 }],
  } as never);

const deposit = async (partyId: number, amount: number, note?: string) => {
  const { error } = await localClient.from("advances").insert({
    party_type: "customer",
    party_id: partyId,
    party_name: partyId === acme ? "Acme" : "Globex",
    amount,
    note: note ?? null,
    paid_at: "2026-07-01",
    org_id: orgId,
    user_id: userId,
  });
  expect(error).toBeNull();
};

describe("advances.creditForInvoice", () => {
  it("offers the full balance to an invoice that has no id yet", async () => {
    // A plain deposit carries note = null, and an unsaved invoice has no id.
    // Both being null used to make the deposit look like this invoice's own
    // consumption, so the editor showed nothing available.
    await deposit(acme, 5000);

    expect(await advances.creditForInvoice(acme, undefined)).toBe(5000);
  });

  it("adds back only this invoice's own consumption", async () => {
    await deposit(acme, 5000);
    const first = await savedInvoice();
    const second = await savedInvoice();
    await advances.applyToInvoice(acme, "Acme", first, 2000);
    await advances.applyToInvoice(acme, "Acme", second, 1000);

    expect(await advances.creditFor(acme)).toBe(2000); // 5000 - 2000 - 1000
    expect(await advances.creditForInvoice(acme, first)).toBe(4000); // first invoice's own 2000 back
    expect(await advances.creditForInvoice(acme, second)).toBe(3000); // second invoice's own 1000 back
  });

  it("keeps a noted deposit in the balance", async () => {
    await deposit(acme, 5000, "Cheque 88213");

    expect(await advances.creditForInvoice(acme, undefined)).toBe(5000);
    expect(await advances.creditFor(acme)).toBe(5000);
  });
});

describe("advances.applyToInvoice", () => {
  it("replaces a prior application rather than stacking", async () => {
    await deposit(acme, 5000);
    const id = await savedInvoice();
    await advances.applyToInvoice(acme, "Acme", id, 2000);
    await advances.applyToInvoice(acme, "Acme", id, 3000);

    expect(await advances.creditFor(acme)).toBe(2000); // 5000 - 3000, not - 5000
  });

  it("releases the credit when the invoice moves to another customer", async () => {
    await deposit(acme, 5000);
    await deposit(globex, 1000);
    const id = await savedInvoice();
    await advances.applyToInvoice(acme, "Acme", id, 2000);
    // Save the authorized customer change before applying its new credit.
    // Passing another party to applyToInvoice alone must never reassign a doc.
    const doc = await billing.getDoc(id);
    await billing.saveDoc({ ...doc, customer_id: globex, customer_name: "Globex", advance_applied: 500 });
    await advances.applyToInvoice(globex, "Globex", id, 500);

    // Customer 1 gets their 2000 back — it was eaten by an invoice that is no
    // longer theirs.
    expect(await advances.creditFor(acme)).toBe(5000);
    expect(await advances.creditFor(globex)).toBe(500);
  });

  it("clears the application when the amount is zero", async () => {
    await deposit(acme, 5000);
    const id = await savedInvoice();
    await advances.applyToInvoice(acme, "Acme", id, 2000);
    await advances.applyToInvoice(acme, "Acme", id, 0);

    expect(await advances.creditFor(acme)).toBe(5000);
  });
});

describe("billing.listDocs outstanding balance", () => {
  it("nets allocated advance credit off the balance like a payment", async () => {
    await deposit(acme, 5000);
    const id = await savedInvoice();
    const doc = await billing.getDoc(id);
    await billing.saveDoc({ ...doc, status: "sent", advance_applied: 2000 });
    await billing.addPayment(id, 1000, "cash", "2026-07-02");

    const summary = (await billing.listDocs()).find((row) => row.id === id)!;
    expect(summary.total).toBe(5000);
    expect(summary.paid).toBe(1000);
    expect(summary.advance_applied).toBe(2000);
    // 5000 − 1000 cash − 2000 credit. Before the fix this read 4000 and the
    // payments dialog asked for money the advance had already covered.
    expect(summary.balance).toBe(2000);
  });
});
