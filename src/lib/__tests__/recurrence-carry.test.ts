// A recurring invoice must bill the same figure as the invoice it recurs from.
// The generator used to name the fields it copied one by one, which quietly
// left out everything that decides the money: the document's unit_price_formula
// and each line's `custom` blob, where a manual line amount and a per-line
// discount live (see docItems.ts). A monthly invoice for a manually-priced line
// would silently revert to qty x unit_price.
import { describe, it, expect, beforeEach } from "vitest";
import { localClient } from "../localdb";
import { billing, recurrences } from "../api";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
});

const baseDoc = async () => {
  await billing.saveDoc({
    number: "INV-2026-0001",
    status: "sent",
    template: "modern",
    accent: "#000",
    currency: "AED",
    seller_name: "Acme",
    customer_name: "Globex",
    issue_date: "2026-08-01",
    tax_rate: 5,
    discount: 0,
    round_off: true,
    unit_price_formula: { a: "hours", b: "unit_price" },
    items: [
      {
        description: "Retainer",
        qty: 1,
        unit_price: 100,
        unit: "mo",
        tax_category: "S",
        // Per-line meta as docItems packs it: a manual amount of 4200.
        custom: { hours: "42", __calc: "manual", __amount: "4200" },
      },
    ],
  } as any);
  const docs = await localClient.from("invoice_docs").select("*");
  return (docs.data as { id: number }[])[0].id;
};

describe("recurrences.generateDue", () => {
  it("carries the fields that decide the total", async () => {
    const baseId = await baseDoc();
    await localClient.from("invoice_recurrence").insert({
      base_invoice_id: baseId,
      interval: "monthly",
      next_run: "2026-01-01", // overdue
      active: true,
    });

    expect(await recurrences.generateDue()).toBe(1);

    const { data } = await localClient.from("invoice_docs").select("*");
    const docs = data as any[];
    const made = docs.find((d) => d.id !== baseId);
    expect(made).toBeTruthy();
    expect(made.unit_price_formula).toEqual({ a: "hours", b: "unit_price" });
    expect(made.round_off).toBe(true);
    expect(made.status).toBe("draft");

    const items = await localClient.from("invoice_doc_items").select("*");
    const line = (items.data as any[]).find((i) => i.invoice_id === made.id);
    expect(line.custom).toEqual({ hours: "42", __calc: "manual", __amount: "4200" });
    expect(line.unit).toBe("mo");
    expect(line.tax_category).toBe("S");
  });

  it("does not inherit the old cycle's due date or quotation link", async () => {
    const baseId = await baseDoc();
    await localClient
      .from("invoice_docs")
      .update({ due_date: "2026-08-31", quotation_id: 77 })
      .eq("id", baseId);
    await localClient.from("invoice_recurrence").insert({
      base_invoice_id: baseId,
      interval: "monthly",
      next_run: "2026-01-01",
      active: true,
    });

    await recurrences.generateDue();

    const { data } = await localClient.from("invoice_docs").select("*");
    const made = (data as any[]).find((d) => d.id !== baseId);
    expect(made.due_date).toBeUndefined();
    expect(made.quotation_id).toBeUndefined();
  });

  it("retires a recurrence whose base invoice was deleted", async () => {
    await localClient.from("invoice_recurrence").insert({
      base_invoice_id: 4242, // never existed
      interval: "monthly",
      next_run: "2026-01-01",
      active: true,
    });

    expect(await recurrences.generateDue()).toBe(0);

    const { data } = await localClient.from("invoice_recurrence").select("*");
    expect((data as any[])[0].active).toBe(false);
  });
});
