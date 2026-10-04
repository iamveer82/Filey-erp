import { afterEach, beforeEach, expect, it, vi } from "vitest";

const cloud = vi.hoisted(() => ({ reads: [] as string[], writes: [] as string[] }));
vi.mock("../supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "sync-test-user" }, expires_at: Date.now() / 1000 + 3600 } } }) },
    rpc: async (name: string, args?: { p_table: string; p_tables?: string[] }) => {
      if (name === "filey_sync_manifest") {
        cloud.reads.push(...args!.p_tables!);
        return { data: Object.fromEntries(args!.p_tables!.map(t => [t, []])), error: null };
      }
      if (name === "sync_record") cloud.writes.push(args!.p_table);
      return { data: { ok: true, revision: 1 }, error: null };
    },
    from: (table: string) => ({
      upsert: async () => ({ error: null }),
      select: () => {
        cloud.reads.push(table);
        const query = {
          eq: () => query,
          order: () => query,
          maybeSingle: async () => ({ data: { org_id: "default" }, error: null }),
          range: async () => ({ data: [], error: null }),
        };
        return query;
      },
    }),
  },
}));

import { localClient, journalSnapshot } from "../localdb";
import { autoSyncEnabled, startAutoSync, scheduleSync } from "../sync";

let stop = () => {};
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  localStorage.setItem("filey_auto_sync", "on");
  localStorage.setItem("filey_cloud_seeded", "1");
  cloud.reads.length = 0; cloud.writes.length = 0;
});
afterEach(() => { stop(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("keeps local saves private despite legacy flags, startup, reconnect and focus", async () => {
  // jsdom schedules its own zero-delay StorageEvent notifications. Exclude
  // only that implementation detail; sync must create no timeout or interval.
  const timeouts = vi.spyOn(globalThis, "setTimeout");
  const intervals = vi.spyOn(globalThis, "setInterval");
  const scheduled = () => timeouts.mock.calls.filter(([callback, delay]) =>
    !(delay === 0 && typeof callback === "function" && callback.name === "bound _dispatchStorageEvent"));
  stop = startAutoSync();
  expect(autoSyncEnabled()).toBe(false);
  expect(localStorage.getItem("filey_auto_sync")).toBe("off");
  expect(scheduled()).toEqual([]);
  expect(intervals).not.toHaveBeenCalled();
  await localClient.from("products").insert({ id: 1, name: "First" });
  await vi.advanceTimersByTimeAsync(1000);
  await localClient.from("products").insert({ id: 2, name: "Second" });
  await localClient.from("products").update({ name: "Latest" }).eq("id", 2);
  await vi.advanceTimersByTimeAsync(1000);
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(1000);
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(1000);
  document.dispatchEvent(new Event("visibilitychange"));
  scheduleSync(1, true);
  expect(scheduled()).toEqual([]);
  expect(intervals).not.toHaveBeenCalled();
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await vi.advanceTimersByTimeAsync(300_000);
  expect(cloud.reads).toEqual([]);
  expect(cloud.writes).toEqual([]);
  expect((await localClient.from("products").select().order("id")).data).toMatchObject([
    { id: 1, name: "First" }, { id: 2, name: "Latest" },
  ]);
  expect((await journalSnapshot()).tables.products.changed).toEqual([1, 2]);
  stop();
  window.dispatchEvent(new Event("online"));
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("filey:local-write"));
  await vi.advanceTimersByTimeAsync(300_000);
  expect(cloud.reads).toEqual([]);
  expect(cloud.writes).toEqual([]);
  expect(scheduled()).toEqual([]);
  expect(intervals).not.toHaveBeenCalled();
  expect((await journalSnapshot()).tables.products.changed).toEqual([1, 2]);
});
