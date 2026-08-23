import { beforeEach, describe, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { fin, billing } from "../api";

// Collecting payment moves an invoice from "sent" to "paid". Posting used to be
// gated on "sent" alone, so that transition ran unpropagateInvoice and stripped
// the sale back out of the ledger — revenue and VAT vanished for work that had
// been invoiced and actually paid for.
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});

const bal = async (re: RegExp) =>
  (await fin.accounts()).find((a) => re.test(a.name))?.balance ?? 0;

const doc = {
  number: "INV-PAID",
  currency: "AED",
  tax_rate: 5,
  discount: 0,
  customer_name: "Gulf Line Trading LLC",
  items: [{ description: "Bracket", qty: 10, unit_price: 20 }],
};

describe("a paid invoice stays on the books", () => {
  it("keeps revenue and VAT after saveDoc moves it to paid", async () => {
    const id = (await billing.saveDoc({ ...doc, status: "sent" } as never)) as number;
    expect(await bal(/sales revenue/i)).toBeCloseTo(200);

    await billing.saveDoc({ ...doc, id, status: "paid" } as never);
    expect(await bal(/sales revenue/i)).toBeCloseTo(200);
    expect(await bal(/output vat/i)).toBeCloseTo(10);
  });

  it("keeps revenue after setStatus moves it to paid", async () => {
    const id = (await billing.saveDoc({
      ...doc,
      number: "INV-PAID-2",
      status: "sent",
    } as never)) as number;
    await billing.setStatus(id, "paid");
    expect(await bal(/sales revenue/i)).toBeCloseTo(200);
  });

  it("still un-posts when the invoice goes back to draft", async () => {
    const id = (await billing.saveDoc({
      ...doc,
      number: "INV-DRAFT",
      status: "sent",
    } as never)) as number;
    await billing.setStatus(id, "draft");
    expect(await bal(/sales revenue/i)).toBeCloseTo(0);
  });

  it("does not double-post when a paid invoice is edited again", async () => {
    const id = (await billing.saveDoc({
      ...doc,
      number: "INV-ONCE",
      status: "sent",
    } as never)) as number;
    await billing.saveDoc({ ...doc, id, number: "INV-ONCE", status: "paid" } as never);
    await billing.saveDoc({ ...doc, id, number: "INV-ONCE", status: "paid" } as never);
    const txns = (await fin.transactions()).filter((t) =>
      String(t.description).startsWith("Invoice INV-ONCE")
    );
    expect(txns.length).toBe(3); // AR + Revenue + Output VAT, posted once
  });
});
