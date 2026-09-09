import { beforeEach, expect, it } from "vitest";
import { localClient } from "../localdb";
import { billing, crm, erp, pos, quotes, suppliers, setCacheOrg } from "../api";
import { runTool } from "../aiTools";
import { setAgentMode } from "../agentMode";
import { allZero } from "../../components/ChartEmpty";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  setCacheOrg("test-org", "test-user");
  setAgentMode("accept_edits");
});

it("rejects updates to missing records instead of reporting success", async () => {
  await expect(erp.updateProduct(999999, { name: "Missing" })).rejects.toBeTruthy();
});

it("links agent documents to saved parties and products, and receives a PO once", async () => {
  const customer = await crm.createCustomer({
    name: "Acme",
    email: "acme@example.test",
  } as never);
  const supplier = await suppliers.create({ name: "Supply Co" } as never);
  const product = await erp.createProduct({
    sku: "OIL",
    name: "Oil",
    quantity: 10,
    cost_price: 4,
    unit_price: 8,
    reorder_level: 2,
  });
  const made = (await runTool("create_invoice_draft", {
    customer_name: "Acme",
    items: [{ description: "Oil", qty: 2.5, unit_price: 8 }],
  })) as { ok: boolean };
  expect(made.ok).toBe(true);
  const invoice = await billing.getDoc((await billing.listDocs())[0].id);
  expect(invoice.customer_id).toBe(customer);
  expect(invoice.items[0].product_id).toBe(product);
  expect(invoice.customer_email).toBe("acme@example.test");
  await runTool("create_purchase_order", {
    supplier_name: "Supply Co",
    currency: "AED",
    items: [{ description: "Oil", qty: 2.5, unit_price: 4 }],
  });
  const po = (await pos.list())[0];
  expect(po.supplier_id).toBe(supplier);
  expect((await pos.get(po.id)).items[0].product_id).toBe(product);
  await pos.receive(po.id);
  await pos.receive(po.id);
  expect((await erp.products())[0].quantity).toBe(12.5);
  await erp.recordStockEntry(product, "adjust", -0.25, "Correction");
  expect((await erp.products())[0].quantity).toBe(12.25);
  expect(allZero([{ value: -2 }], "value")).toBe(false);
});

it("creates linked CRM tasks through the agent, with plan mode preventing changes", async () => {
  const made = (await runTool("save_crm_record", {
    section: "contacts",
    values: { name: "Sam" },
  })) as { id: number };
  await runTool("save_crm_record", {
    section: "tasks",
    values: {
      title: "Call Sam",
      target_type: "person",
      target_id: made.id,
      due_date: "2026-09-10",
    },
  });
  const result = (await runTool("crm_records", { section: "tasks" })) as {
    count: number;
    records: { title: string }[];
  };
  expect(result.count).toBe(1);
  expect(result.records[0].title).toBe("Call Sam");
  setAgentMode("plan");
  expect(
    await runTool("save_crm_record", { section: "tasks", values: { title: "Blocked" } })
  ).toHaveProperty("error");
});

it("rejects invalid agent quantities and preserves the original lines when a quotation insert fails", async () => {
  expect(
    await runTool("create_invoice_draft", {
      customer_name: "Acme",
      items: [{ description: "Oil", qty: -2, unit_price: 8 }],
    })
  ).toHaveProperty("error");
  expect(await billing.listDocs()).toHaveLength(0);
  const id = await quotes.saveDoc({
    number: "VERIFY-QUOTE",
    status: "draft",
    items: [{ product: "Original", qty: 1, rate: 10, discount: 0, tax: 0 }],
  } as never);
  // A rejected replacement must never delete the old lines first.
  const originalFrom = localClient.from.bind(localClient);
  const { vi } = await import("vitest");
  const spy = vi.spyOn(localClient, "from").mockImplementation((table: string) => {
    const query = originalFrom(table);
    if (table === "quotation_items")
      query.insert = (() => {
        throw new Error("simulated line write failure");
      }) as typeof query.insert;
    return query;
  });
  try {
    await expect(
      quotes.saveDoc({
        id,
        number: "CHANGED",
        items: [{ product: "Replacement", qty: 1, rate: 20 }],
      } as never)
    ).rejects.toThrow("simulated");
  } finally {
    spy.mockRestore();
  }
  const saved = await quotes.getDoc(id);
  expect(saved.number).toBe("VERIFY-QUOTE");
  expect(saved.items[0].product).toBe("Original");
});
