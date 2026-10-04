import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ values: new Map<string, string>(), beforeCommit: undefined as undefined | (() => void), commits: 0 }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (command: string, args: any) => {
  if (command === "cache_get") return native.values.get(args.key) ?? null;
  if (command === "cache_set") { native.values.set(args.key, args.value); return; }
  if (command === "cache_compare_set_many") {
    native.commits++;
    const hook = native.beforeCommit; native.beforeCommit = undefined; hook?.();
    if (args.expected.some(([key, value]: [string, string | null]) => (native.values.get(key) ?? null) !== value)) return false;
    for (const [key, value] of args.entries) if (value === null) native.values.delete(key); else native.values.set(key, value);
    return true;
  }
  throw new Error(`Unexpected command ${command}`);
} }));

const coll = (name: string) => JSON.parse(native.values.get("localdb:" + name) ?? "[]");
function externalInsert(name: string, row: Record<string, unknown>) {
  native.values.set("localdb:" + name, JSON.stringify([...coll(name), row]));
  const journal = JSON.parse(native.values.get("syncjournal") ?? '{"v":0,"tables":{}}');
  journal.v++;
  const entry = journal.tables[name] ??= { changed: [], deleted: [] };
  entry.changed.push(row.id);
  native.values.set("syncjournal", JSON.stringify(journal));
}
async function fresh() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  vi.resetModules();
  return import("../localdb");
}
beforeEach(() => { native.values.clear(); native.commits = 0; native.beforeCommit = undefined; });
afterAll(() => { delete (window as any).__TAURI_INTERNALS__; });

describe("independent desktop/MCP collection writers", () => {
  it("refreshes memoized rows, deletions, and the journal after another writer commits", async () => {
    const db = await fresh();
    await db.localClient.from("products").insert({ id: 1, name: "Desktop" });
    const previous = await db.journalSnapshot();
    await db.loadColl("products");
    externalInsert("products", { id: 2, name: "MCP" });
    expect((await db.loadColl("products")).map(row => row.id)).toEqual([1, 2]);
    expect((await db.journalSnapshot()).v).toBe(previous.v + 1);
    native.values.set("localdb:products", '[{"id":2,"name":"MCP"}]');
    expect((await db.loadColl("products")).map(row => row.id)).toEqual([2]);
  });

  it("retries a pure insert from fresh records while preserving both writers' IDs and journal", async () => {
    const db = await fresh();
    native.beforeCommit = () => externalInsert("products", { id: 7, name: "MCP" });
    const result = await db.localClient.from("products").insert({ name: "Desktop" }).select().single();
    expect(result.error).toBeNull();
    expect(native.commits).toBe(2);
    expect(coll("products").map((row: any) => row.name)).toEqual(["MCP", "Desktop"]);
    expect(Number.isSafeInteger(result.data.id)).toBe(true);
    expect(new Set(coll("products").map((row: any) => row.id)).size).toBe(2);
    expect((await db.journalSnapshot()).tables.products.changed).toEqual([7, result.data.id]);
  });

  it("does not replay a document workflow or commit any header/lines when an independent writer wins", async () => {
    const db = await fresh();
    const work = vi.fn(async (client: any) => {
      await client.from("invoice_docs").insert({ id: 1, number: "DESKTOP" });
      await client.from("invoice_doc_items").insert({ id: 1, invoice_id: 1 });
    });
    native.beforeCommit = () => externalInsert("invoice_docs", { id: 9, number: "MCP" });
    await expect(db.withLocalTransaction(work)).rejects.toMatchObject({ code: "local_conflict" });
    expect(work).toHaveBeenCalledTimes(1);
    expect(coll("invoice_docs")).toEqual([{ id: 9, number: "MCP" }]);
    expect(coll("invoice_doc_items")).toEqual([]);
    expect((await db.journalSnapshot()).tables.invoice_docs.changed).toEqual([9]);
  });

  it("validates read-only dependencies and rejects stale update/delete without replay", async () => {
    const db = await fresh();
    await db.localClient.from("products").insert({ id: 1, quantity: 10, sync_revision: 3 });
    native.beforeCommit = () => { native.values.set("localdb:products", '[{"id":1,"quantity":20,"sync_revision":4}]'); };
    await expect(db.withLocalTransaction(async client => {
      const product = (await client.from("products").select().single()).data;
      const saved = await client.from("invoice_docs").insert({ id: 10, number: "DEPENDENCY-10", quantity: product.quantity });
      if (saved.error) throw saved.error;
    })).rejects.toMatchObject({ code: "local_conflict" });
    expect(coll("invoice_docs")).toEqual([]);
    native.beforeCommit = () => externalInsert("products", { id: 2, quantity: 5 });
    expect((await db.localClient.from("products").delete().eq("id", 1)).error.code).toBe("local_conflict");
    expect(coll("products").map((row: any) => row.id)).toEqual([1, 2]);
    expect((await db.journalSnapshot()).tables.products.deleted).toEqual([]);
  });

  it("recomputes a pure stock delta rather than replaying its stale balance", async () => {
    const db = await fresh();
    await db.localClient.from("products").insert({ id: 1, quantity: 10 });
    native.beforeCommit = () => {
      native.values.set("localdb:products", '[{"id":1,"quantity":15}]');
      externalInsert("orders", { id: 90 });
    };
    expect((await db.localClient.rpc("adjust_product_stock", { p_id: 1, p_delta: 2 })).error).toBeNull();
    expect(coll("products")[0].quantity).toBe(17);
    expect((await db.journalSnapshot()).tables.orders.changed).toEqual([90]);
  });

  it("keeps concurrent dirty IDs when a stale push tries to clear the journal", async () => {
    const db = await fresh();
    await db.localClient.from("products").insert({ id: 1 });
    const before = await db.journalSnapshot();
    native.beforeCommit = () => externalInsert("products", { id: 2 });
    await db.journalCommit(before.v, ["products"]);
    expect((await db.journalSnapshot()).tables.products.changed).toEqual([1, 2]);
  });

  it("rejects a stale pull/copy and commits successful delete tombstones with their revision", async () => {
    const db = await fresh();
    await db.localClient.from("products").insert({ id: 1, sync_revision: 4 });
    let before = await db.journalSnapshot();
    native.beforeCommit = () => externalInsert("products", { id: 2 });
    expect(await db.replaceColl("products", [{ id: 1, name: "old cloud" }], before.v)).toBe(false);
    before = await db.journalSnapshot();
    native.beforeCommit = () => externalInsert("orders", { id: 3 });
    await expect(db.replaceWorkspaceSnapshot(new Map([["products", []]]), before.v)).rejects.toMatchObject({ code: "local_conflict" });
    expect(coll("products").map((row: any) => row.id)).toEqual([1, 2]);
    expect((await db.localClient.from("products").delete().eq("id", 1)).error).toBeNull();
    const entry = (await db.journalSnapshot()).tables.products;
    expect(entry.deleted).toEqual([1]); expect(entry.deletedRevisions).toEqual({ "1": 4 });
  });

  it("stops pure retries after three conflicts with no partial or phantom save", async () => {
    const db = await fresh();
    const conflict = () => { externalInsert("products", { id: 100 + native.commits }); native.beforeCommit = conflict; };
    native.beforeCommit = conflict;
    const result = await db.localClient.from("products").insert({ name: "unsaved" });
    expect(result.error.code).toBe("local_conflict");
    expect(native.commits).toBe(3);
    expect(coll("products")).toHaveLength(3);
    expect(coll("products").some((row: any) => row.name === "unsaved")).toBe(false);
  });

  it("rolls back every staged write even if a workflow ignores a builder write error", async () => {
    const db = await fresh();
    await db.localClient.from("invoice_docs").insert({ id: 1, number: "EXISTING" });
    const before = await db.journalSnapshot();
    await expect(db.withLocalTransaction(async client => {
      await client.from("products").insert({ id: 9, name: "must roll back" });
      await client.from("invoice_docs").insert({ id: 2, number: " existing " });
    })).rejects.toThrow("already in use");
    expect(coll("products")).toEqual([]);
    expect(coll("invoice_docs")).toHaveLength(1);
    expect(await db.journalSnapshot()).toEqual(before);
  });

  it("preserves invalid stock data instead of resetting it during a delta", async () => {
    const db = await fresh();
    native.values.set("localdb:products", '[{"id":1,"quantity":"invalid"}]');
    const result = await db.localClient.rpc("adjust_product_stock", { p_id: 1, p_delta: 2 });
    expect(result.error.message).toContain("stored quantity");
    expect(coll("products")[0].quantity).toBe("invalid");
    expect(native.commits).toBe(0);
    expect(native.values.get("syncjournal")).toBeUndefined();
  });
});
