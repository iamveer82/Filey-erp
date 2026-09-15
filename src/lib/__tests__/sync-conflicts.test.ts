import { beforeEach, expect, it, vi } from "vitest";
import { localClient, journalSnapshot, replaceColl, resolveLocalSyncConflict, rememberSyncRevision } from "../localdb";
import { pushCollection, listSyncConflicts } from "../sync";

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
