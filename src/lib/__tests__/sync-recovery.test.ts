import { beforeEach, expect, it, vi } from "vitest";
import { journalMark, journalSnapshot, loadColl, replaceColl } from "../localdb";
import { transferResolveConflicts } from "./cloud-transfer-fixture";

const owner = "recovery-fixture-owner";
const org = "recovery-fixture-company";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  localStorage.setItem("filey_cloud_seeded", "1");
});

function cloudFixture(id: string | number) {
  const records: Record<string, Record<string, any>[]> = {
    app_settings: [{ id, key: "unrelated-cloud-setting", value: "preserve cloud value", sync_revision: 4 }],
  };
  const rpc = vi.fn(async (name: string, args: any) => {
    if (name === "filey_prepare_workspace_sync") return { data: { org_id: org, recovered_orgs: args.p_source_orgs }, error: null };
    if (name === "filey_sync_manifest") return { data: Object.fromEntries(args.p_tables.map((table: string) => [table, records[table] ?? []])), error: null };
    if (name === "sync_record") {
      const rows = records[args.p_table] ??= [];
      records[args.p_table] = rows.filter(row => row.id !== args.p_row.id);
      if (!args.p_delete) records[args.p_table].push({ ...args.p_row, sync_revision: 5 });
      return { data: { ok: true, revision: 5 }, error: null };
    }
    throw new Error(`Unexpected fixture RPC: ${name}`);
  });
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: owner }, expires_at: Date.now() / 1000 + 3600 } }, error: null }) },
    rpc,
    from: (table: string) => ({ upsert: async () => ({ error: null }), select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: { org_id: org }, error: null }) }),
      in: async (field: string, ids: unknown[]) => ({ data: (records[table] ?? []).filter(row => ids.includes(row[field])), error: null }),
      order: () => ({ range: async () => ({ data: records[table] ?? [], error: null }) }),
    }) }),
  };
  return { client: client as any, rpc, records };
}

it.each([true, false])("preserves an unknown legacy settings deletion before workspace recovery or writes (keep local: %s)", async keepLocal => {
  const id = keepLocal ? 8 : "8";
  const product = { id: 99, name: "Preserve device inventory", user_id: owner, org_id: "older-company" };
  await replaceColl("products", [product]);
  await journalMark("app_settings", { deleted: [id], ...(keepLocal ? { deletedRevisions: { "8": null } } : {}) });
  const before = await journalSnapshot();
  const { client, rpc, records } = cloudFixture(id);
  await expect(transferResolveConflicts(keepLocal, client)).rejects.toThrow(/deleted company setting.*Review this deletion/);
  expect(rpc).not.toHaveBeenCalled();
  expect(await journalSnapshot()).toEqual(before);
  expect(await loadColl("products")).toEqual([product]);
  expect(await loadColl("app_settings")).toEqual([]);
  expect(records.app_settings[0].value).toBe("preserve cloud value");
});

it.each([true, false])("allows an acknowledged legacy settings deletion to use the normal conflict preference (keep local: %s)", async keepLocal => {
  await journalMark("app_settings", { deleted: [8], deletedRevisions: { "8": 2 } });
  const { client, rpc, records } = cloudFixture(8);
  expect(await transferResolveConflicts(keepLocal, client)).toBe(true);
  expect((await journalSnapshot()).tables.app_settings).toBeUndefined();
  if (keepLocal) {
    expect(rpc).toHaveBeenCalledWith("sync_record", { p_table: "app_settings", p_row: { id: 8 }, p_expected: 4, p_delete: true });
    expect(records.app_settings).toEqual([]);
    expect(await loadColl("app_settings")).toEqual([]);
  } else {
    expect(rpc.mock.calls.some(([name]) => name === "sync_record")).toBe(false);
    expect(await loadColl("app_settings")).toEqual(records.app_settings);
  }
});
