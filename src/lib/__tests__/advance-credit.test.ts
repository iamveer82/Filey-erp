// Advance credit available to an invoice. The ledger is a list of entries per
// party: deposits positive, consumptions negative, balance = the sum. What a
// given invoice may draw on is that balance with its OWN prior consumption
// added back, so editing the applied amount rebalances against the right pool.
import { describe, it, expect, beforeEach } from "vitest";
import { localClient } from "../localdb";
import { advances } from "../api";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
});

const deposit = (partyId: number, amount: number, note?: string) =>
  localClient.from("advances").insert({
    party_type: "customer",
    party_id: partyId,
    party_name: "Acme",
    amount,
    note: note ?? null,
    paid_at: "2026-07-01",
  });

describe("advances.creditForInvoice", () => {
  it("offers the full balance to an invoice that has no id yet", async () => {
    // A plain deposit carries note = null, and an unsaved invoice has no id.
    // Both being null used to make the deposit look like this invoice's own
    // consumption, so the editor showed nothing available.
    await deposit(1, 5000);

    expect(await advances.creditForInvoice(1, undefined)).toBe(5000);
  });

  it("adds back only this invoice's own consumption", async () => {
    await deposit(1, 5000);
    await advances.applyToInvoice(1, "Acme", 7, 2000);
    await advances.applyToInvoice(1, "Acme", 9, 1000);

    expect(await advances.creditFor(1)).toBe(2000); // 5000 - 2000 - 1000
    expect(await advances.creditForInvoice(1, 7)).toBe(4000); // invoice 7's own 2000 back
    expect(await advances.creditForInvoice(1, 9)).toBe(3000); // invoice 9's own 1000 back
  });

  it("keeps a noted deposit in the balance", async () => {
    await deposit(1, 5000, "Cheque 88213");

    expect(await advances.creditForInvoice(1, undefined)).toBe(5000);
    expect(await advances.creditFor(1)).toBe(5000);
  });
});

describe("advances.applyToInvoice", () => {
  it("replaces a prior application rather than stacking", async () => {
    await deposit(1, 5000);
    await advances.applyToInvoice(1, "Acme", 7, 2000);
    await advances.applyToInvoice(1, "Acme", 7, 3000);

    expect(await advances.creditFor(1)).toBe(2000); // 5000 - 3000, not - 5000
  });

  it("releases the credit when the invoice moves to another customer", async () => {
    await deposit(1, 5000);
    await deposit(2, 1000);
    await advances.applyToInvoice(1, "Acme", 7, 2000);
    // Invoice 7 is re-assigned to customer 2 and saved again.
    await advances.applyToInvoice(2, "Globex", 7, 500);

    // Customer 1 gets their 2000 back — it was eaten by an invoice that is no
    // longer theirs.
    expect(await advances.creditFor(1)).toBe(5000);
    expect(await advances.creditFor(2)).toBe(500);
  });

  it("clears the application when the amount is zero", async () => {
    await deposit(1, 5000);
    await advances.applyToInvoice(1, "Acme", 7, 2000);
    await advances.applyToInvoice(1, "Acme", 7, 0);

    expect(await advances.creditFor(1)).toBe(5000);
  });
});
