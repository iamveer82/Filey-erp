import { afterEach, beforeEach, expect, it, vi } from "vitest";

const cloud = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../moduleAccess", () => ({
  loadModuleAccess: async () => ({ admin: true, modules: null }),
  requireToolModuleAccess: async () => {},
}));
vi.mock("../supabase", () => ({
  isConfigured: true, supabase: null,
  sb: () => ({ from: (table: string) => {
    let single = false;
    const filters: Record<string, unknown> = {};
    const orders: { column: string; ascending: boolean; nullsFirst?: boolean }[] = [];
    const query = {
      select: () => query, range: () => query,
      order: (column: string, options: { ascending: boolean; nullsFirst?: boolean }) => { orders.push({ column, ...options }); return query; },
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      single: () => { single = true; return query; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        cloud.read(table, filters, single, orders).then(resolve, reject),
    };
    return query;
  } }),
}));
import { billing, setCacheOrg } from "../api";
import { runTool } from "../aiTools";
import { setDataMode } from "../dataMode";

const older = { id: 28, number: "INV-028", customer_name: "Fixture customer", currency: "AED", status: "draft", issue_date: "2026-09-01", tax_rate: 5, discount: 0 };
const newer = { ...older, id: 29, number: "INV-029", issue_date: "2026-09-23", unit_price_formula: { a: "liters", b: "unit_price" } };
const olderLine = { id: 1, invoice_id: 28, description: "Earlier service", qty: 2, unit_price: 10 };
const newerLine = { id: 2, invoice_id: 29, description: "Newer oil", qty: 50, unit_price: 0.2, custom: { liters: "1000" } };

function remoteRows(docs: Record<string, unknown>[], items: Record<string, unknown>[]) {
  cloud.read.mockImplementation(async (table: string, filters: Record<string, unknown>, single: boolean,
    orders: { column: string; ascending: boolean; nullsFirst?: boolean }[]) => {
    const rows = (table === "invoice_docs" ? docs : table === "invoice_doc_items" ? items : [])
      .filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
    // Postgres defaults to NULLS FIRST for DESC, unlike the local store.
    rows.sort((a, b) => {
      for (const order of orders) {
        const av = a[order.column], bv = b[order.column];
        if (av == null && bv == null) continue;
        const nullsFirst = order.nullsFirst ?? !order.ascending;
        if (av == null) return nullsFirst ? -1 : 1;
        if (bv == null) return nullsFirst ? 1 : -1;
        const comparison = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        if (comparison) return order.ascending ? comparison : -comparison;
      }
      return 0;
    });
    return { data: single ? rows[0] : rows, error: null };
  });
}

beforeEach(() => {
  localStorage.clear();
  setDataMode("cloud");
  setCacheOrg("freshness-org", "freshness-user");
  cloud.read.mockReset();
  vi.spyOn(billing, "verifyPendingInvoiceSaves").mockResolvedValue([]);
});
afterEach(() => { vi.restoreAllMocks(); setCacheOrg(null); });

it("chooses the remotely newer invoice for same-as-last even while the UI has a cached list", async () => {
  remoteRows([older], [olderLine]);
  expect((await billing.listDocs())[0].number).toBe("INV-028");
  remoteRows([newer, older], [newerLine, olderLine]);
  // No realtime notification: another device saved an invoice after this UI's snapshot.
  expect((await billing.listDocs())[0].number).toBe("INV-028");
  const choices = await runTool("list_invoices", { query: "Fixture customer", limit: 1 }) as { number: string; issue_date: string }[];
  expect(choices[0]).toMatchObject({ number: "INV-029", issue_date: "2026-09-23" });
  expect(await runTool("get_invoice", { invoice_number: choices[0].number })).toMatchObject({
    number: "INV-029", total: 210, items: [{ description: "Newer oil", qty: 50, unit_price: 0.2, custom: { liters: "1000" } }],
  });
  // This fix is specific to authoritative agent reads, not normal UI list caching.
  expect((await billing.listDocs())[0].number).toBe("INV-028");
});

it.each(["list_invoices", "list_purchase_invoices"])("does not choose an old source if the current %s read fails", async name => {
  remoteRows([{ ...older, doc_type: name === "list_purchase_invoices" ? "purchase" : "sales" }], [olderLine]);
  const type = name === "list_purchase_invoices" ? "purchase" : "sales";
  expect(await billing.listDocs(type)).toHaveLength(1);
  cloud.read.mockRejectedValue(new Error("Current invoice list unavailable"));
  expect(await runTool(name, {})).toMatchObject({ error: "Current invoice list unavailable" });
});

it.each(["sales", "purchase"] as const)("orders dated %s invoices before undated legacy records in the cloud query and agent selection", async type => {
  remoteRows([
    { ...older, doc_type: type },
    { ...older, doc_type: type, id: 30, number: "INV-UNDATED", issue_date: null },
    { ...newer, doc_type: type },
  ], [olderLine, newerLine]);
  expect((await billing.listDocs(type, true)).map(row => row.number)).toEqual(["INV-029", "INV-028", "INV-UNDATED"]);
  expect(cloud.read).toHaveBeenCalledWith("invoice_docs", {}, false, expect.arrayContaining([
    { column: "issue_date", ascending: false, nullsFirst: false },
  ]));
  const latest = await runTool(type === "sales" ? "list_invoices" : "list_purchase_invoices", { limit: 1 });
  expect(latest).toMatchObject(type === "sales" ? [{ number: "INV-029" }] : { bills: [{ number: "INV-029" }] });
});

it("resolves a remotely renamed draft before revising instead of trusting its old list number", async () => {
  remoteRows([older], [olderLine]);
  await billing.listDocs();
  remoteRows([{ ...older, number: "INV-RENAMED" }], [olderLine]);
  vi.spyOn(billing, "pendingInvoiceSaves").mockResolvedValue([]);
  const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(28);
  expect(await runTool("revise_invoice", { invoice_number: "INV-RENAMED", notes: "Requested note" }, () => true))
    .toMatchObject({ ok: true, id: 28, number: "INV-RENAMED" });
  expect(save.mock.calls[0][0]).toMatchObject({ id: 28, number: "INV-RENAMED", notes: "Requested note", items: [
    { description: "Earlier service", qty: 2, unit_price: 10 },
  ] });
});
