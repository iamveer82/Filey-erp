import { beforeEach, describe, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { crm } from "../api";
import { TOOLS } from "../aiTools";

// "Confidently wrong" in an ERP looks like a tidy invoice raised for a customer
// that doesn't exist under that name — it reconciles against nothing and nobody
// notices until someone chases the payment.
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});

const tool = (name: string) => {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`${name} is not registered`);
  return t;
};

const draftFor = (customer: string) =>
  tool("create_invoice_draft").run({
    customer_name: customer,
    items: [{ description: "work", qty: 1, unit_price: 100 }],
  }) as Promise<{ ok: boolean; warning?: string; did_you_mean?: string[] }>;

describe("raising a document for an unknown party", () => {
  it("still creates the draft, but flags the name", async () => {
    const r = await draftFor("Totally New Co");
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/No customer named/i);
  });

  it("points at the near-miss when one exists", async () => {
    await crm.createCustomer({ name: "ACME Trading LLC" } as never);
    const r = await draftFor("Acme Trading");
    expect(r.warning).toBeTruthy();
    expect(r.did_you_mean).toContain("ACME Trading LLC");
  });

  it("says nothing when the customer is on file", async () => {
    await crm.createCustomer({ name: "Acme Trading" } as never);
    const r = await draftFor("Acme Trading");
    expect(r.ok).toBe(true);
    expect(r.warning).toBeUndefined();
  });

  it("matches case-insensitively rather than nagging about capitals", async () => {
    await crm.createCustomer({ name: "Acme Trading" } as never);
    const r = await draftFor("acme trading");
    expect(r.warning).toBeUndefined();
  });
});

describe("supplier bills", () => {
  it("flags a supplier nobody has heard of", async () => {
    const r = (await tool("create_purchase_invoice_draft").run({
      supplier_name: "Ghost Supplies",
      items: [{ description: "paper", qty: 1, unit_price: 10 }],
    })) as { ok: boolean; warning?: string };
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/No supplier named/i);
  });
});
