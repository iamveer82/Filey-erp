import { beforeEach, expect, it, vi } from "vitest";
import { inRealOrg, prepareSyncRows, pushCollection } from "../sync";
import { journalCommit, journalMark, journalSnapshot, localClient, replaceColl } from "../localdb";

beforeEach(() => localStorage.clear());

it.each([false, true])("stops an upload when its account changes between requests (legacy server: %s)", async legacy => {
  let user = "owner";
  const rows = Array.from({ length: 51 }, (_, id) => ({ id: id + 1, name: "Private", sync_revision: 1 }));
  await replaceColl("products", rows);
  await journalMark("products", { all: true });
  const rpc = vi.fn(async (name: string, args: any) => {
    if (legacy && name === "sync_records") return { error: { code: "PGRST202" } };
    user = "other-account";
    return { data: legacy ? { ok: true, revision: 2 } : args.p_records.map(({ row }: any) => ({ id: row.id, ok: true, revision: 2 })), error: null };
  });
  const client = { rpc, auth: { getSession: async () => ({ data: { session: { user: { id: user }, expires_at: Date.now() / 1000 + 3600 } } }) } } as any;
  await expect(pushCollection(client, "products", rows, undefined, "owner")).rejects.toThrow("account changed");
  expect(rpc).toHaveBeenCalledTimes(legacy ? 2 : 1);
  expect((await journalSnapshot()).tables.products.all).toBe(true);
  expect((await localClient.from("products").select().eq("id", 1).single()).data.sync_revision).toBe(1);
});

it("uploads 120 rows in three batches and preserves edits made during a request", async () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, name: "Local", sync_revision: 1 }));
  await replaceColl("products", rows);
  const rpc = vi.fn(async (_name, args) => {
    await localClient.from("products").update({ name: "New edit" }).eq("id", 1);
    return { data: args.p_records.map(({ row }: any) => ({ id: row.id, ok: true, revision: 2 })), error: null };
  });
  expect(await pushCollection({ rpc } as any, "products", rows)).toEqual([]);
  expect(rpc).toHaveBeenCalledTimes(3);
  expect(rpc.mock.calls.every(([name]) => name === "sync_records")).toBe(true);
  expect((await localClient.from("products").select().eq("id", 1).single()).data).toMatchObject({ name: "New edit", sync_revision: 2 });
});

it("falls back only for a missing batch function, never after an uncertain network response", async () => {
  const rows = [{ id: 1 }, { id: 2 }];
  const rpc = vi.fn().mockResolvedValueOnce({ error: { code: "PGRST202" } }).mockResolvedValue({ data: { ok: true, revision: 1 }, error: null });
  const client = { rpc } as any;
  expect(await pushCollection(client, "products", rows)).toEqual([]);
  expect(rpc).toHaveBeenCalledTimes(3);
  rpc.mockClear();
  await pushCollection(client, "products", rows);
  expect(rpc).toHaveBeenCalledTimes(2);
  const unavailable = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "Network lost" } }) } as any;
  expect(await pushCollection(unavailable, "products", rows)).toEqual([1, 2]);
  expect(unavailable.rpc).toHaveBeenCalledTimes(1);
});

it("keeps only failed rows pending after a partial seed and never clears edits made in flight", async () => {
  await journalMark("products", { all: true });
  const snapshot = await journalSnapshot();
  await journalCommit(snapshot.v, ["products"], { products: [2] });
  expect((await journalSnapshot()).tables.products).toEqual({ changed: [2], deleted: [] });
  const next = await journalSnapshot();
  await localClient.from("products").insert({ id: 3, name: "Created while syncing" });
  await journalCommit(next.v, ["products"], { products: [] });
  expect((await journalSnapshot()).tables.products.changed).toEqual([2, 3]);
});

it("keeps mixed batch errors pending while acknowledging valid rows and queued deletions", async () => {
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
  await replaceColl("products", rows);
  await journalMark("products", { all: true, deleted: [4], deletedRevisions: { "4": 7 } });
  const snapshot = await journalSnapshot();
  const report = vi.fn();
  const failed = await pushCollection({ rpc: vi.fn().mockResolvedValue({ data: [
    { id: 1, ok: true, revision: 2 },
    { id: 2, ok: false, conflict: true },
    { id: 3, ok: false, error: { code: "23503" } },
  ], error: null }) } as any, "products", rows, report);
  await journalCommit(snapshot.v, ["products"], { products: [...failed, 4] });
  expect((await journalSnapshot()).tables.products).toEqual({ changed: [2, 3], deleted: [4], deletedRevisions: { "4": 7 } });
  expect(report.mock.calls.map(([failure]) => failure.kind)).toEqual(["conflict", "record"]);
  expect((await localClient.from("sync_conflicts").select()).data).toEqual([expect.objectContaining({ recordId: 2 })]);
});

it("rejects legacy rows belonging to a different company before stripping ownership", async () => {
  const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { org_id: "company-a" }, error: null }) }) }) }) } as any;
  await inRealOrg(client, "owner", true);
  const report = vi.fn();
  const prepared = prepareSyncRows([{ id: 1, org_id: "company-a" }, { id: 2, org_id: "company-b" }, { id: 3 }], "owner", "products", report);
  expect(prepared.rows.map(row => row.id)).toEqual([1, 3]);
  expect(prepared.failed).toEqual([2]);
  expect(report).toHaveBeenCalledWith(expect.objectContaining({ kind: "permission", recordId: 2 }));
});
