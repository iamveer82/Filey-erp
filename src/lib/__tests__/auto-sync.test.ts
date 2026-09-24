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

import { localClient } from "../localdb";
import { startAutoSync } from "../sync";
import { PUSH_TABLES } from "../syncTables";

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

it("coalesces saves, preserves pending full checks, and stops polling on cleanup", async () => {
  stop = startAutoSync();
  await localClient.from("products").insert({ id: 1, name: "First" });
  await vi.advanceTimersByTimeAsync(1000);
  // A save during startup must not cancel the initial all-table reconciliation.
  expect(PUSH_TABLES.every(t => cloud.reads.includes(t))).toBe(true);
  cloud.reads.length = 0; cloud.writes.length = 0;
  await localClient.from("products").insert({ id: 2, name: "Second" });
  await localClient.from("products").update({ name: "Latest" }).eq("id", 2);
  await vi.advanceTimersByTimeAsync(1000);
  expect(cloud.writes).toEqual(["products"]);
  expect(cloud.reads.filter(t => t !== "profiles")).toEqual(["products"]);
  cloud.reads.length = 0;
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(PUSH_TABLES.every(t => cloud.reads.includes(t))).toBe(true);
  cloud.reads.length = 0;
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(PUSH_TABLES.every(t => cloud.reads.includes(t))).toBe(true);
  cloud.reads.length = 0;
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await vi.advanceTimersByTimeAsync(300_000);
  expect(cloud.reads).toEqual([]);
  stop();
  window.dispatchEvent(new Event("online"));
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(300_000);
  expect(cloud.reads).toEqual([]);
});
