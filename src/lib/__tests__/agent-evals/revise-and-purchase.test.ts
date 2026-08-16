import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDataMode } from "../../dataMode";
import { setAgentMode } from "../../agentMode";
import { billing, pos } from "../../api";
import { TOOLS } from "../../aiTools";
import { invoiceLineAmount } from "../../money";

/* The buy side of the pricing family, and the tool that lets the agent correct
 * itself instead of leaving a trail of near-identical drafts. */

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setAgentMode("auto");
});
afterEach(() => vi.unstubAllGlobals());

const tool = (name: string) => {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`${name} is not registered`);
  return t;
};

describe("purchase orders", () => {
  it("prices by the measure the supplier quotes", async () => {
    const res = (await tool("create_purchase_order").run({
      supplier_name: "Gulf Lubricants",
      custom_columns: [{ key: "total_liters", label: "T.Liters" }],
      price_by: "total_liters",
      items: [
        {
          description: "H/O 68 Pail 20L",
          qty: 20,
          unit: "Pail",
          unit_price: 4.1,
          custom: { total_liters: "400" },
        },
      ],
    })) as { ok: boolean; number: string; total: number };

    expect(res.total).toBe(1640);
    const list = (await pos.list()) as unknown as Record<string, unknown>[];
    const saved = list.find((p) => p.po_number === res.number)!;
    // The persisted total is the figure the document shows. It used to be 0
    // for every agent-made PO: the tool passed total: 0, and pos.save trusts
    // a passed total.
    expect(saved.total).toBe(1640);
  });

  it("records the supplier, and says so when there isn't one", async () => {
    const named = (await tool("create_purchase_order").run({
      supplier_name: "Gulf Lubricants",
      items: [{ description: "Drum", qty: 2, unit_price: 100 }],
    })) as { number: string; total: number };
    expect(named.total).toBe(200);

    const list = (await pos.list()) as unknown as Record<string, unknown>[];
    expect(list.find((p) => p.po_number === named.number)?.supplier_name).toBe(
      "Gulf Lubricants"
    );

    const anon = (await tool("create_purchase_order").run({
      items: [{ description: "Drum", qty: 1, unit_price: 100 }],
    })) as { warning?: string };
    expect(anon.warning).toMatch(/cannot be sent/i);
  });
});

describe("revising a draft", () => {
  const draft = async () =>
    (await tool("create_invoice_draft").run({
      customer_name: "Rennox",
      items: [{ description: "H/O 68 Pail 20L", qty: 20, unit_price: 4.1 }],
    })) as { number: string };

  it("corrects the pricing in place instead of drafting a second invoice", async () => {
    const made = await draft();

    const res = (await tool("revise_invoice").run({
      invoice_number: made.number,
      custom_columns: [{ key: "total_liters", label: "T.Liters" }],
      price_by: "total_liters",
      items: [
        {
          description: "H/O 68 Pail 20L",
          qty: 20,
          unit: "Pail",
          unit_price: 4.1,
          custom: { total_liters: "400" },
        },
      ],
    })) as { ok: boolean; subtotal: number };

    expect(res.subtotal).toBe(1640);
    const docs = await billing.listDocs("sales");
    expect(docs).toHaveLength(1); // corrected, not duplicated
    const doc = await billing.getDoc(Number(docs[0].id));
    expect(invoiceLineAmount(doc.items[0], doc.unit_price_formula)).toBe(1640);
  });

  it("keeps the lines when only the customer changes", async () => {
    const made = await draft();
    await tool("revise_invoice").run({
      invoice_number: made.number,
      customer_name: "Rennox Trading LLC",
    });
    const docs = await billing.listDocs("sales");
    const doc = await billing.getDoc(Number(docs[0].id));
    expect(doc.customer_name).toBe("Rennox Trading LLC");
    expect(doc.items).toHaveLength(1);
  });

  it("can drop a formula and go back to qty × price", async () => {
    const made = await draft();
    await tool("revise_invoice").run({
      invoice_number: made.number,
      custom_columns: [{ key: "total_liters", label: "T.Liters" }],
      price_by: "total_liters",
      items: [
        { description: "x", qty: 20, unit_price: 4.1, custom: { total_liters: "400" } },
      ],
    });
    const res = (await tool("revise_invoice").run({
      invoice_number: made.number,
      price_by: "",
    })) as { subtotal: number };
    expect(res.subtotal).toBe(82);
  });

  it("refuses to edit an invoice the customer already has", async () => {
    const made = await draft();
    const docs = await billing.listDocs("sales");
    await billing.setStatus(Number(docs[0].id), "sent");

    const res = (await tool("revise_invoice").run({
      invoice_number: made.number,
      customer_name: "Someone Else",
    })) as { error?: string };
    // Editing a sent document underneath the customer is how their copy and
    // the books stop agreeing.
    expect(res.error).toMatch(/only drafts can be revised/i);
  });

  it("says so when the number matches nothing", async () => {
    const res = (await tool("revise_invoice").run({ invoice_number: "NOPE-1" })) as {
      error?: string;
    };
    expect(res.error).toMatch(/no invoice matching/i);
  });
});
