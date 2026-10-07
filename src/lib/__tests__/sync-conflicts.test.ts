import * as localSync from "../sync";
import { transferPushCollection as pushCollection, transferSyncNow as syncNow } from "./cloud-transfer-fixture";
import { beforeEach, expect, it, vi } from "vitest";
import { localClient, journalMark, journalSnapshot, loadColl, replaceColl, resolveLocalSyncConflict, resolveLocalSyncConflicts, rememberSyncRevision } from "../localdb";
import { LOCAL_ID_MIN } from "../recordId";
import { listSyncConflicts, getSyncStatus, syncStatusMessage } from "../sync";

beforeEach(() => { localStorage.clear(); localStorage.setItem("filey_data_mode", "local"); });

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
  expect(await localSync.syncNow(client)).toBe(false);
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

it("reconciles overlapping settings IDs together without losing device-only settings or their values", async () => {
  const keys = ["company_bank", "company_letterhead", "company_stamp", "company_signature", "invoice_number_format", "cheque_register", "email_templates", "declaration_letters", "purchase_invoice_number_format", "quote_number_format", "purchase_order_number_format", "payment_receipt_number_format", "declaration_letter_number_format", "sales_order_number_format"];
  const rows = keys.map((key, i) => ({ id: i + 1, key, value: key === "company_letterhead" ? "synthetic image".repeat(900) : `saved ${key}` }));
  const pendingRows = rows.filter(row => row.key !== "declaration_letter_number_format");
  const cloudIds: Record<string, number> = { company_bank: 6, company_letterhead: 7, company_stamp: 11, company_signature: 12, email_templates: 9, invoice_number_format: 14 };
  await replaceColl("app_settings", rows);
  await journalMark("app_settings", { changed: pendingRows.map(row => row.id) });
  const choices = pendingRows.map(row => ({ id: row.id, reviewedLocal: row,
    remote: cloudIds[row.key] ? { ...row, id: cloudIds[row.key], value: "older cloud value", sync_revision: 6 } : null }));
  await resolveLocalSyncConflicts("app_settings", choices, true);
  const result = await loadColl("app_settings");
  expect(result).toHaveLength(14);
  expect(new Set(result.map(row => row.id)).size).toBe(14);
  expect(Object.fromEntries(result.map(row => [row.key, row.value]))).toEqual(Object.fromEntries(rows.map(row => [row.key, row.value])));
  for (const [key, id] of Object.entries(cloudIds)) expect(result.find(row => row.key === key)).toMatchObject({ id, sync_revision: 6 });
  for (const key of keys.filter(key => !cloudIds[key] && key !== "declaration_letter_number_format"))
    expect(result.find(row => row.key === key)?.id).toBeGreaterThanOrEqual(LOCAL_ID_MIN);
  expect(result.find(row => row.key === "declaration_letter_number_format")).toEqual(rows[12]);
  const pending = (await journalSnapshot()).tables.app_settings;
  expect(new Set(pending.changed)).toEqual(new Set(result.filter(row => row.key !== "declaration_letter_number_format").map(row => row.id)));
  expect(pending.deleted).toEqual([]);
});

it("moves device-only legacy settings out of the cloud ID range while retaining safe offline IDs", async () => {
  const rows = [{ id: 8, key: "declaration_letters", value: "local letters" }, { id: 10, key: "quote_number_format", value: "local numbering" }, { id: LOCAL_ID_MIN + 1, key: "new_setting", value: "already safe" }];
  await replaceColl("app_settings", rows);
  await journalMark("app_settings", { changed: rows.map(row => row.id) });
  // No cloud match by business key. IDs 8/10 can belong to unrelated cloud
  // settings (or an RLS-hidden account) and must not be reused for inserts.
  await resolveLocalSyncConflicts("app_settings", rows.map(row => ({ id: row.id, reviewedLocal: row, remote: null })), true);
  const saved = await loadColl("app_settings");
  expect(saved.every(row => row.id >= LOCAL_ID_MIN)).toBe(true);
  expect(saved.find(row => row.key === "new_setting")?.id).toBe(LOCAL_ID_MIN + 1);
  expect(Object.fromEntries(saved.map(row => [row.key, row.value]))).toEqual(Object.fromEntries(rows.map(row => [row.key, row.value])));
  expect(new Set((await journalSnapshot()).tables.app_settings.changed)).toEqual(new Set(saved.map(row => row.id)));
});

it("applies a cloud settings ID swap without overwriting either reviewed setting", async () => {
  const rows = [{ id: 1, key: "first", value: "device A" }, { id: 2, key: "second", value: "device B" }];
  await replaceColl("app_settings", rows);
  await journalMark("app_settings", { changed: [1, 2] });
  const choices = rows.map(row => ({ id: row.id, reviewedLocal: row, remote: { ...row, id: row.id === 1 ? 2 : 1, value: `cloud ${row.key}`, sync_revision: 3 } }));
  await resolveLocalSyncConflicts("app_settings", choices, false);
  expect(await loadColl("app_settings")).toEqual(expect.arrayContaining(choices.map(choice => choice.remote)));
  expect((await journalSnapshot()).tables.app_settings).toBeUndefined();
});

it("remaps a reviewed settings tombstone and preserves the unrelated occupant for upload", async () => {
  await replaceColl("app_settings", [{ id: 2, key: "unrelated", value: "preserve" }]);
  await journalMark("app_settings", { deleted: [1], deletedRevisions: { "1": 2 } });
  await resolveLocalSyncConflicts("app_settings", [{ id: 1, reviewedLocal: null, remote: { id: 2, key: "deleted-setting", value: "cloud", sync_revision: 4 } }], true);
  const [preserved] = await loadColl("app_settings");
  expect(preserved).toMatchObject({ key: "unrelated", value: "preserve" });
  expect(preserved.id).toBeGreaterThanOrEqual(LOCAL_ID_MIN);
  expect((await journalSnapshot()).tables.app_settings).toMatchObject({ changed: [preserved.id], deleted: [2], deletedRevisions: { "2": 4 } });
  expect((await journalSnapshot()).tables.app_settings.deletedRevisions).not.toHaveProperty("1");
});

it("preserves settings and their journal when remapping is ambiguous or the review is stale", async () => {
  const rows = [{ id: 1, key: "first", value: "local A" }, { id: 2, key: "second", value: "local B" }];
  await replaceColl("app_settings", rows);
  await journalMark("app_settings", { changed: [1, 2], deleted: [9], deletedRevisions: { "9": 2 } });
  const before = await journalSnapshot();
  const cloud = { id: 9, key: "first", value: "cloud", sync_revision: 3 };
  await expect(resolveLocalSyncConflicts("app_settings", rows.map(row => ({ id: row.id, reviewedLocal: row, remote: { ...cloud, key: row.key } })), true)).rejects.toThrow(/Company settings changed/);
  await expect(resolveLocalSyncConflicts("app_settings", [{ id: 1, reviewedLocal: rows[0], remote: cloud }], true)).rejects.toThrow(/Company settings changed/);
  await expect(resolveLocalSyncConflicts("app_settings", [{ id: 1, reviewedLocal: { ...rows[0], value: "stale" }, remote: { ...cloud, id: 2 } }], true)).rejects.toThrow(/changed while/);
  expect(await loadColl("app_settings")).toEqual(rows);
  expect(await journalSnapshot()).toEqual(before);
});
