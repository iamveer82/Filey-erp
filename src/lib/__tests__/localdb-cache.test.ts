import { beforeEach, describe, expect, it, vi } from "vitest";

// The desktop read cache (localdb.ts) only engages under Tauri, so this file
// fakes that: __TAURI_INTERNALS__ present + a stubbed invoke standing in for the
// SQLite-backed kv_cache. It guards the thing a cache gets wrong — serving a
// stale collection after a write.

const store = new Map<string, string>();
const invoke = vi.fn(async (cmd: string, args: any) => {
  if (cmd === "cache_get") return store.get(args.key) ?? null;
  if (cmd === "cache_set") {
    store.set(args.key, args.value);
    return null;
  }
  return null;
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (c: string, a: any) => invoke(c, a) }));

const reads = (): number =>
  invoke.mock.calls.filter(([c, a]) => c === "cache_get" && a.key === "localdb:widgets")
    .length;

/** Fresh module per test: the cache is module state, and so is `hasTauri`. */
async function freshClient() {
  (window as any).__TAURI_INTERNALS__ = {};
  vi.resetModules();
  invoke.mockClear();
  return (await import("../localdb")).localClient;
}

beforeEach(() => store.clear());

describe("localdb desktop read cache", () => {
  it("reads storage once, then serves repeat queries from memory", async () => {
    const c = await freshClient();
    await c.from("widgets").insert([{ name: "A" }, { name: "B" }]);
    const before = reads();
    for (let i = 0; i < 5; i++) await c.from("widgets").select();
    expect(reads()).toBe(before); // five queries, zero extra round trips
  });

  it("does not serve stale rows after an insert", async () => {
    const c = await freshClient();
    await c.from("widgets").insert({ name: "A" });
    await c.from("widgets").select(); // warm the cache
    await c.from("widgets").insert({ name: "B" });
    const { data } = await c.from("widgets").select();
    expect(data.map((r: any) => r.name)).toEqual(["A", "B"]);
  });

  it("does not serve stale rows after an update or a delete", async () => {
    const c = await freshClient();
    await c.from("widgets").insert([{ name: "A" }, { name: "B" }]);
    await c.from("widgets").select();

    await c.from("widgets").update({ name: "A2" }).eq("name", "A");
    let { data } = await c.from("widgets").select().eq("name", "A2");
    expect(data).toHaveLength(1);

    await c.from("widgets").delete().eq("name", "B");
    ({ data } = await c.from("widgets").select());
    expect(data.map((r: any) => r.name)).toEqual(["A2"]);
  });

  it("survives a restart: a cold module reads what the last one wrote", async () => {
    let c = await freshClient();
    await c.from("widgets").insert({ name: "A" });
    c = await freshClient(); // new process, same kv_cache
    const { data } = await c.from("widgets").select();
    expect(data.map((r: any) => r.name)).toEqual(["A"]);
  });

  it("replaceColl reports no change when the pulled rows match, and writes when they differ", async () => {
    await freshClient();
    const { replaceColl } = await import("../localdb");
    const rows = [{ id: 1, name: "A" }];
    expect(await replaceColl("widgets", rows)).toBe(true);
    expect(await replaceColl("widgets", [{ id: 1, name: "A" }])).toBe(false);
    expect(await replaceColl("widgets", [{ id: 1, name: "B" }])).toBe(true);
  });

  it("does not keep rows whose write failed", async () => {
    const c = await freshClient();
    await c.from("widgets").insert({ name: "kept" });
    await c.from("widgets").select(); // warm

    invoke.mockImplementationOnce(async () => {
      throw new Error("disk full");
    });
    const { error } = await c.from("widgets").insert({ name: "lost" });
    expect(error).toBeTruthy();

    const { data } = await c.from("widgets").select();
    expect(data.map((r: any) => r.name)).toEqual(["kept"]);
  });

  it("replaceColl's rows are visible to the next query", async () => {
    const c = await freshClient();
    await c.from("widgets").insert({ name: "old" });
    await c.from("widgets").select(); // warm
    const { replaceColl } = await import("../localdb");
    await replaceColl("widgets", [{ id: 9, name: "pulled" }]);
    const { data } = await c.from("widgets").select();
    expect(data.map((r: any) => r.name)).toEqual(["pulled"]);
  });
});
