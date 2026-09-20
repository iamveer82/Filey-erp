import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { localClient, journalSnapshot, replaceColl } from "../localdb";
import { saveAsset, deleteAsset, listAssets, legacyAssets } from "../assets";
import { listFiles, listFolders } from "../files";
import { sb } from "../supabase";
import { syncNow } from "../sync";

const identity = vi.hoisted(() => ({ scope: "org:user:owner" }));
vi.mock("../api", () => ({ getCacheScope: () => identity.scope }));
vi.mock("../auth", () => ({ useAuth: () => ({}) }));
vi.mock("../supabase", async () => {
  const { localClient } = await import("../localdb");
  return { sb: vi.fn(() => localClient), isConfigured: true, supabase: null };
});
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "local");
  identity.scope = "org:user:owner";
  vi.mocked(sb).mockReturnValue(localClient as never);
});
afterEach(() => vi.restoreAllMocks());
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

it("keeps offline images queued after a cloud failure, then uploads the bytes on retry", async () => {
  const image = await saveAsset("My stamp", png, 1);
  expect(await listAssets()).toEqual([image]);
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Offline" } });
  const client: any = {
    auth: { getSession: async () => ({ data: { session: { user: { id: "cloud-owner" }, expires_at: Date.now() / 1000 + 3600 } } }) },
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { org_id: "default" }, error: null }) }) }), upsert: async () => ({ error: null }) }),
  };
  expect(await syncNow(client, { manual: true })).toBe(false);
  expect((await journalSnapshot()).tables.user_assets.changed).toEqual([image.id]);
  rpc.mockResolvedValue({ data: { ok: true, revision: 1 }, error: null });
  expect(await syncNow(client, { manual: true })).toBe(true);
  expect(rpc).toHaveBeenCalledWith("sync_record", expect.objectContaining({
    p_table: "user_assets", p_row: expect.objectContaining({ id: image.id, owner: "cloud-owner", data_url: png }),
  }));
  expect((await journalSnapshot()).tables.user_assets).toBeUndefined();
  await deleteAsset(image.id);
  expect(await listAssets()).toEqual([]);
  expect((await journalSnapshot()).tables.user_assets.deleted).toEqual([image.id]);
});

it("keeps downloaded cloud-owner images, files and folders visible in the local workspace", async () => {
  const base = { id: "cloud-record", owner: "cloud-owner", name: "Cloud upload", created_at: new Date().toISOString() };
  await replaceColl("user_assets", [{ ...base, data_url: png, ratio: 1 }]);
  await replaceColl("user_files", [{ ...base, storage_path: "cloud-owner/file.png", mime: "image/png", size: 12 }]);
  await replaceColl("user_folders", [{ ...base, parent_id: null }]);
  expect((await listAssets())[0].id).toBe(base.id);
  expect((await listFiles())[0].id).toBe(base.id);
  expect((await listFolders())[0].id).toBe(base.id);
});

it("does not claim the legacy cache, report failed saves as success, or accept stale account reads", async () => {
  const old = JSON.stringify([{ id: "legacy", name: "Original", dataUrl: png, ratio: 1, createdAt: 1 }]);
  localStorage.setItem("filey.assets.v1", old);
  expect(await listAssets()).toEqual([]);
  expect(legacyAssets()).toHaveLength(1);
  const client: any = {
    auth: { getSession: async () => ({ data: { session: { user: { id: "cloud-owner" } } } }) },
    from: () => ({ insert: async () => ({ error: new Error("Upload rejected") }) }),
  };
  vi.mocked(sb).mockReturnValue(client);
  await expect(saveAsset("Cannot save", png, 1)).rejects.toThrow("Upload rejected");
  expect(localStorage.getItem("filey.assets.v1")).toBe(old);
  client.auth.getSession = async () => { identity.scope = "other:user:other"; return { data: { session: { user: { id: "other" } } } }; };
  await expect(listAssets()).rejects.toThrow("workspace changed");
});
