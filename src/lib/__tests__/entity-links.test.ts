import { beforeEach, describe, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { links, crm, billing } from "../api";

/* The graph's whole value is that one row is read from both ends: link an
 * invoice to a customer and the customer must show the invoice, without a
 * second row. These guard that, plus the two ways it could quietly rot —
 * duplicate edges piling up, and a link surviving as a blank chip. */

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});

const mkCustomer = (name: string) =>
  crm.createCustomer({ name } as never) as Promise<number>;

const mkInvoice = (number: string) =>
  billing.saveDoc({
    number,
    customer_name: "x",
    status: "draft",
    items: [{ description: "line", qty: 1, unit_price: 10 }],
  } as never) as Promise<number>;

describe("entity links", () => {
  it("reads from both ends off a single row", async () => {
    const cust = await mkCustomer("Acme Trading");
    const inv = await mkInvoice("INV-100");

    await links.add({ type: "invoice", id: inv }, { type: "customer", id: cust });

    // The end it was linked FROM sees an outgoing edge...
    const fromInvoice = await links.for("invoice", inv);
    expect(fromInvoice).toHaveLength(1);
    expect(fromInvoice[0].type).toBe("customer");
    expect(fromInvoice[0].direction).toBe("outgoing");

    // ...and the other end sees the same edge, incoming. No second row.
    const fromCustomer = await links.for("customer", cust);
    expect(fromCustomer).toHaveLength(1);
    expect(fromCustomer[0].type).toBe("invoice");
    expect(fromCustomer[0].id).toBe(inv);
    expect(fromCustomer[0].direction).toBe("incoming");
  });

  it("resolves the label from the target row, so renaming keeps the link", async () => {
    const cust = await mkCustomer("Old Name");
    const inv = await mkInvoice("INV-101");
    await links.add({ type: "invoice", id: inv }, { type: "customer", id: cust });

    await crm.updateCustomer(cust, { name: "New Name" } as never);

    // crm_activities.related_to matches on a name and would have orphaned
    // here; this resolves through the id every read.
    const after = await links.for("invoice", inv);
    expect(after).toHaveLength(1);
    expect(after[0].label).toBe("New Name");
  });

  it("linking the same pair twice does not duplicate the edge", async () => {
    const cust = await mkCustomer("Acme");
    const inv = await mkInvoice("INV-102");
    await links.add({ type: "invoice", id: inv }, { type: "customer", id: cust });
    await links.add({ type: "invoice", id: inv }, { type: "customer", id: cust });

    expect(await links.for("invoice", inv)).toHaveLength(1);
  });

  it("unlinking removes it from both ends", async () => {
    const cust = await mkCustomer("Acme");
    const inv = await mkInvoice("INV-103");
    await links.add({ type: "invoice", id: inv }, { type: "customer", id: cust });

    const [edge] = await links.for("invoice", inv);
    await links.remove(edge.linkId);

    expect(await links.for("invoice", inv)).toHaveLength(0);
    expect(await links.for("customer", cust)).toHaveLength(0);
  });
});
