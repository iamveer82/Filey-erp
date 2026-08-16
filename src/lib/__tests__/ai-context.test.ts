import { beforeEach, describe, expect, it } from "vitest";
import { buildAiContext, clearAiContextCache } from "../aiContext";
import { setDataMode } from "../dataMode";
import { billing, crm } from "../api";

beforeEach(async () => {
  localStorage.clear();
  clearAiContextCache();
  setDataMode("local");
});

describe("the business brief", () => {
  it("states identity the agent would otherwise guess", async () => {
    await billing.saveCompany({
      name: "Rennox Trading",
      trn: "100123456700003",
      default_tax_rate: 5,
      default_accent: "#FFD600",
      default_template: "minimal",
    });
    clearAiContextCache();

    const brief = await buildAiContext();
    expect(brief).toContain("Rennox Trading");
    expect(brief).toContain("TRN 100123456700003");
    // A guessed tax rate on a tax invoice is the expensive kind of wrong.
    expect(brief).toContain("default VAT 5%");
  });

  it("names what is outstanding, not just how many invoices exist", async () => {
    await crm.createCustomer({ name: "Acme" });
    await billing.saveDoc({
      number: "INV-1",
      status: "sent",
      template: "minimal",
      accent: "#FFD600",
      currency: "AED",
      seller_name: "Rennox Trading",
      customer_name: "Acme",
      issue_date: "2026-01-01",
      due_date: "2026-01-15",
      tax_rate: 0,
      discount: 0,
      items: [{ description: "Widget", qty: 1, unit_price: 500 }],
    });
    clearAiContextCache();

    const brief = await buildAiContext();
    expect(brief).toMatch(/Invoices: 1 total/);
    expect(brief).toMatch(/outstanding/);
  });

  it("points at the tools rather than at the user", async () => {
    const brief = await buildAiContext();
    // It used to end by telling the model to ask the user to open a page —
    // written before the agent could look anything up itself.
    expect(brief).not.toMatch(/open the relevant page/i);
    expect(brief).toMatch(/use the find\/list tools/i);
  });

  it("stays small enough to sit in every system prompt", async () => {
    for (let i = 0; i < 40; i++) await crm.createCustomer({ name: `Customer ${i}` });
    clearAiContextCache();

    const brief = await buildAiContext();
    // Counts are exact, examples are capped — 40 customers must not mean 40
    // lines of prompt on every single turn.
    expect(brief).toContain("Customers: 40");
    expect(brief.length).toBeLessThan(4000);
  });

  it("serves a repeat call from the memo instead of re-reading five tables", async () => {
    await crm.createCustomer({ name: "First" });
    const one = await buildAiContext();
    await crm.createCustomer({ name: "Second" });
    expect(await buildAiContext()).toBe(one); // within the window
    clearAiContextCache();
    expect(await buildAiContext()).not.toBe(one);
  });
});
