import { beforeEach, describe, expect, it, vi } from "vitest";
import { setDataMode } from "../dataMode";
import { billing } from "../api";
import { localClient } from "../localdb";

/* DATA LOSS REGRESSION.
 *
 * saveDoc used to delete every line of an invoice and only then insert the
 * replacements, with nothing transactional in between. Any failure in the
 * insert — a column the cloud DB hadn't migrated yet, a check constraint, a
 * dropped connection — left the invoice permanently empty and showing a zero
 * total, which is exactly what a user reported after an update.
 *
 * The lines are now retired by id only after the replacements are written, so
 * a failed save costs nothing. */

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});

const doc = (over: Record<string, unknown> = {}) =>
  ({
    number: "INV-001",
    customer_name: "Acme",
    status: "draft",
    items: [
      { description: "Widget", qty: 2, unit_price: 100 },
      { description: "Gadget", qty: 1, unit_price: 50 },
    ],
    ...over,
  }) as never;

describe("invoice line items survive saves", () => {
  it("keeps items across a normal edit", async () => {
    const id = (await billing.saveDoc(doc())) as number;
    await billing.saveDoc(doc({ id, customer_name: "Acme Ltd" }));

    const saved = await billing.getDoc(id);
    expect(saved.items).toHaveLength(2);
    expect(saved.customer_name).toBe("Acme Ltd");
  });

  it("replaces lines without leaving the old ones behind", async () => {
    const id = (await billing.saveDoc(doc())) as number;
    await billing.saveDoc(
      doc({ id, items: [{ description: "Only line", qty: 3, unit_price: 7 }] })
    );

    const saved = await billing.getDoc(id);
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0].description).toBe("Only line");
  });

  it("does not destroy existing lines when the new ones fail to insert", async () => {
    const id = (await billing.saveDoc(doc())) as number;

    // Simulate what actually bit the user: the line insert fails (a column the
    // cloud DB hasn't migrated, a constraint, a dropped connection) while the
    // delete would already have gone through. The local shim validates
    // nothing, so the failure has to be injected to reproduce it at all.
    const realFrom = localClient.from.bind(localClient);
    const spy = vi
      .spyOn(localClient, "from")
      .mockImplementation((coll: string) => {
        const q = realFrom(coll) as unknown as Record<string, unknown>;
        if (coll === "invoice_doc_items") {
          return {
            ...q,
            insert: () =>
              Promise.resolve({ data: null, error: { message: "insert failed" } }),
            select: (...a: unknown[]) => (q.select as CallableFunction)(...a),
            delete: (...a: unknown[]) => (q.delete as CallableFunction)(...a),
          } as never;
        }
        return q as never;
      });

    await billing
      .saveDoc(doc({ id, items: [{ description: "New", qty: 1, unit_price: 5 }] }))
      .catch(() => {
        /* expected to fail — the point is what survives it */
      });

    spy.mockRestore();

    // The invoice must still hold its original two lines, not be left empty
    // with a zero total.
    const saved = await billing.getDoc(id);
    expect(saved.items).toHaveLength(2);
  });
});
