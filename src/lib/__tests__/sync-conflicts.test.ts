import { beforeEach, expect, it, vi } from "vitest";
import { localClient, journalSnapshot, replaceColl, resolveLocalSyncConflict, resolveLocalSyncConflicts, rememberSyncRevision } from "../localdb";
import { pushCollection, listSyncConflicts, syncNow, getSyncStatus, syncStatusMessage } from "../sync";

beforeEach(() => localStorage.clear());

it("preserves a stale local edit and records a durable conflict without an unsafe fallback", async () => {
  await replaceColl("products", [{ id: 1, name: "Original", sync_revision: 2 }]);
  await localClient.from("products").update({ name: "Local edit" }).eq("id", 1);
  const rpc = vi.fn().mockResolvedValue({ data: { ok: false, conflict: true }, error: null });
  const row = (await localClient.from("products").select().single()).data;
  expect(await pushCollection({ rpc } as any, "products", [row])).toEqual([1]);
  expect(rpc).toHaveBeenCalledWith("sync_record", { p_table: "products", p_row: { id: 1, name: "Local edit" }, p_expected: 2 });
  expect((await listSyncConflicts())[0]).toMatchObject({ table: "products", recordId: 1 });
  expect((await journalSnapshot()).tables.products.changed).toEqual([1]);
  expect((await localClient.from("products").select().single()).data.name).toBe("Local edit");
});

it("a successful response advances the base revision without losing an edit made in flight", async () => {
  await replaceColl("products", [{ id: 1, name: "Original", sync_revision: 2 }]);
  const rpc = vi.fn(async () => {
    await localClient.from("products").update({ name: "Typed while syncing" }).eq("id", 1);
    return { data: { ok: true, revision: 3 }, error: null };
  });
  expect(await pushCollection({ rpc } as any, "products", [{ id: 1, name: "Uploaded edit", sync_revision: 2 }])).toEqual([]);
  expect((await localClient.from("products").select().single()).data).toEqual({ id: 1, name: "Typed while syncing", sync_revision: 3 });
  await localClient.from("products").delete().eq("id", 1);
  expect((await journalSnapshot()).tables.products.deletedRevisions).toEqual({ "1": 3 });
  await rememberSyncRevision("products", 1, 4);
  expect((await journalSnapshot()).tables.products.deletedRevisions).toEqual({ "1": 4 });
});

it("resolving one record preserves unrelated pending edits and rejects an outdated local review", async () => {
  const local = { id: 1, name: "Local", sync_revision: 2 };
  const cloud = { id: 1, name: "Cloud", sync_revision: 3 };
  await replaceColl("products", [local, { id: 2, name: "Keep me" }]);
  await localClient.from("products").update({ name: "Pending" }).eq("id", 2);
  await resolveLocalSyncConflict("products", 1, cloud, false, local);
  expect((await journalSnapshot()).tables.products.changed).toEqual([2]);
  expect((await localClient.from("products").select().eq("id", 1).single()).data).toEqual(cloud);
  await expect(resolveLocalSyncConflict("products", 1, cloud, true, local)).rejects.toThrow(/changed while/);
  await resolveLocalSyncConflict("products", 1, cloud, true, cloud);
  expect((await journalSnapshot()).tables.products.changed).toEqual([2, 1]);
});

it("reports server validation failures without leaking details and preserves nullable invoice links", async () => {
  localStorage.setItem("filey_data_mode", "local");
  await localClient.from("products").insert({ id: 1, name: "Pending" });
  await localClient.from("invoice_payments").insert({ id: 2, invoice_id: null, amount: 100 });
  const rpc = vi.fn();
  const client: any = {
    auth: { getSession: async () => ({ data: { session: { user: { id: "diagnostic-owner" }, expires_at: Date.now() / 1000 + 3600 } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { org_id: "default" }, error: null }) }) }), upsert: async () => ({ error: null }) }),
    rpc,
  };
  for (const [response, kind] of [
    [{ data: { ok: false, conflict: true }, error: null }, "conflict"],
    [{ data: null, error: { code: "42501", message: "private record details" } }, "permission"],
    [{ data: null, error: { code: "23503", message: "private record details" } }, "record"],
    [{ data: null, error: { code: "PGRST202", message: "missing sync_record" } }, "schema"],
  ] as const) {
    rpc.mockResolvedValue(response);
    expect(await syncNow(client, { manual: true })).toBe(false);
    expect(getSyncStatus().failures).toEqual([
      expect.objectContaining({ table: "products", kind }),
      expect.objectContaining({ table: "invoice_payments", kind }),
    ]);
    expect(getSyncStatus().error?.includes("schema needs an update")).toBe(kind === "schema");
    expect(JSON.stringify(getSyncStatus())).not.toContain("private record details");
  }
  expect(rpc.mock.calls.some(([, args]) => args?.p_table === "invoice_payments" && args.p_row.invoice_id === null)).toBe(true);
  expect((await journalSnapshot()).tables.invoice_payments.changed).toEqual([2]);
  localStorage.setItem("filey_auto_sync", "on");
  rpc.mockClear();
  expect(await syncNow(client)).toBe(false);
  expect(rpc.mock.calls.some(([name]) => name === "sync_record")).toBe(false);
  expect((await journalSnapshot()).tables.products.changed).toEqual([1]);
  rpc.mockResolvedValue({ data: { ok: true, revision: 2 }, error: null });
  await syncNow(client, { manual: true });
  expect(rpc.mock.calls.some(([, args]) => args?.p_table === "products")).toBe(true);
  expect(await listSyncConflicts()).toEqual([]);
});


it("resolves a collection in one write and leaves all records unchanged if any reviewed row changed", async () => {
  const rows = Array.from({ length: 137 }, (_, id) => ({ id: id + 1, name: `Local ${id}`, sync_revision: 1 }));
  await replaceColl("products", rows);
  await localClient.from("products").update({ name: "New edit" }).eq("id", 137);
  const choices = rows.map(row => ({ id: row.id, reviewedLocal: row, remote: { ...row, name: "Cloud", sync_revision: 2 } }));
  await expect(resolveLocalSyncConflicts("products", choices, false)).rejects.toThrow(/changed while/);
  expect((await localClient.from("products").select().eq("id", 1).single()).data.name).toBe("Local 0");
  choices[136].reviewedLocal = { ...rows[136], name: "New edit" };
  const write = vi.spyOn(Storage.prototype, "setItem");
  await resolveLocalSyncConflicts("products", choices, true);
  expect(write.mock.calls.filter(([key]) => key.endsWith("localdb:products"))).toHaveLength(1);
  expect((await journalSnapshot()).tables.products.changed).toHaveLength(137);
  expect((await localClient.from("products").select().eq("id", 137).single()).data).toMatchObject({ name: "New edit", sync_revision: 2 });
  write.mockRestore();
});

it("explains workspace and record repairs without claiming a connection retry fixes them", () => {
  expect(syncStatusMessage({ state: "error", failures: [{ table: "invoices", recordId: 1, kind: "permission", message: "This record belongs to a different company." }] })).toMatch(/Choose which changes/);
  expect(syncStatusMessage({ state: "error", failures: [{ table: "items", recordId: 1, kind: "record", message: "Missing parent" }] })).toMatch(/missing or invalid links/);
});
