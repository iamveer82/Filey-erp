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
  if (cmd === "cache_set_many") {
    for (const [key, value] of args.entries) store.set(key, value);
    return null;
  }
  if (cmd === "cache_compare_set_many") {
    if (args.expected.some(([key, value]: [string, string | null]) => (store.get(key) ?? null) !== value)) return false;
    for (const [key, value] of args.entries) {
      if (value === null) store.delete(key); else store.set(key, value);
    }
    return true;
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
  it("keeps a selected nested object isolated from a later unrelated save", async () => {
    const client = await freshClient();
    await client.from("widgets").insert([{ id: 1, custom: { rate: 10 } }, { id: 2, name: "Other" }]);
    const selected = (await client.from("widgets").select().eq("id", 1).single()).data;
    selected.custom.rate = 999;
    expect(JSON.parse(store.get("localdb:widgets")!)[0].custom.rate).toBe(10);
    await client.from("widgets").update({ name: "Renamed" }).eq("id", 2);
    expect(JSON.parse(store.get("localdb:widgets")!)[0].custom.rate).toBe(10);
  });

  it("does not publish nested mutations from an aborted transaction", async () => {
    const client = await freshClient();
    const { withLocalTransaction } = await import("../localdb");
    await client.from("widgets").insert({ id: 1, custom: { rate: 10 } });
    await expect(withLocalTransaction(async staged => {
      const row = (await staged.from("widgets").select().single()).data;
      row.custom.rate = 999;
      await staged.from("widgets").update({ name: "Abandoned" }).eq("id", 1);
      throw new Error("Abandon changes");
    })).rejects.toThrow("Abandon changes");
    expect((await client.from("widgets").select().single()).data.custom.rate).toBe(10);
    expect(JSON.parse(store.get("localdb:widgets")!)[0].custom.rate).toBe(10);
  });

  it("does not retain a caller's mutable input inside a committed memo", async () => {
    const client = await freshClient();
    const input = { id: 1, custom: { rate: 10 } };
    await client.from("widgets").insert(input);
    input.custom.rate = 999;
    await client.from("widgets").insert({ id: 2, name: "Other" });
    expect(JSON.parse(store.get("localdb:widgets")!)[0].custom.rate).toBe(10);
  });

  it("preserves blank array entries and literal prototype-shaped JSON keys during copies", async () => {
    const client = await freshClient();
    const fields = new Array(3); fields[0] = "First";
    const custom = JSON.parse('{"__proto__":{"label":"Literal field"}}');
    await client.from("widgets").insert({ id: 1, fields, custom });
    const saved = JSON.parse(store.get("localdb:widgets")!)[0];
    expect(saved.fields).toEqual(["First", null, null]);
    const result = (await client.from("widgets").select().single()).data;
    expect(Object.prototype.hasOwnProperty.call(result.custom, "__proto__")).toBe(true);
    expect(result.custom.__proto__).toEqual({ label: "Literal field" });
    expect(({} as Record<string, unknown>).label).toBeUndefined();
  });

  it("keeps a workspace and its journal intact after a failed snapshot transaction, then retries", async () => {
    const client = await freshClient();
    const { replaceWorkspaceSnapshot, journalSnapshot } = await import("../localdb");
    await client.from("products").insert({id: 1, name: "Device product"});
    await client.from("orders").insert({id: 2, order_number: "DEVICE-2", name: "Device order"});
    const before = await journalSnapshot();
    const snapshot = new Map([
      ["products", [{id: 1, name: "Cloud product"}]],
      ["orders", [{id: 2, name: "Cloud order"}]],
    ]);
    const savedInvoke = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "cache_compare_set_many") throw new Error("Disk full");
      return savedInvoke(cmd, args);
    });
    try {
      await expect(replaceWorkspaceSnapshot(snapshot, before.v)).rejects.toThrow("Disk full");
      expect((await client.from("products").select().single()).data.name).toBe("Device product");
      expect((await client.from("orders").select().single()).data.name).toBe("Device order");
      expect(await journalSnapshot()).toEqual(before);
    } finally { invoke.mockImplementation(savedInvoke); }
    await replaceWorkspaceSnapshot(snapshot, before.v);
    const reopened = await freshClient();
    expect((await reopened.from("products").select().single()).data.name).toBe("Cloud product");
    expect((await reopened.from("orders").select().single()).data.name).toBe("Cloud order");
    expect((await (await import("../localdb")).journalSnapshot()).tables).toEqual({});
  });

  it("commits a sync choice with its upload queue atomically and preserves both after a failed write", async () => {
    const client = await freshClient();
    const { resolveLocalSyncConflicts, journalSnapshot } = await import("../localdb");
    await client.from("products").insert({ id: 1, name: "Local", sync_revision: 1 });
    const local = (await client.from("products").select().single()).data;
    const choice = { id: 1, reviewedLocal: local, remote: { id: 1, name: "Cloud", sync_revision: 3 } };
    const before = await journalSnapshot();
    const savedInvoke = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "cache_compare_set_many") throw new Error("Disk full");
      return savedInvoke(cmd, args);
    });
    try {
      await expect(resolveLocalSyncConflicts("products", [choice], true)).rejects.toThrow("Disk full");
      expect((await client.from("products").select().single()).data).toEqual(local);
      expect(await journalSnapshot()).toEqual(before);
    } finally { invoke.mockImplementation(savedInvoke); }
    await resolveLocalSyncConflicts("products", [choice], true);
    const restarted = await freshClient();
    expect((await restarted.from("products").select().single()).data).toMatchObject({ name: "Local", sync_revision: 3 });
    expect((await (await import("../localdb")).journalSnapshot()).tables.products.changed).toEqual([1]);
  });
  it("revalidates storage and isolates results while reusing unchanged parsing and blob hydration", async () => {
    const c = await freshClient();
    const raw = JSON.stringify([{ name: "A", logo: { __blob: "fixture-logo" } }, { name: "B" }]);
    const logo = "logo".repeat(4096);
    store.set("localdb:widgets", raw);
    store.set("localdb:blob:fixture-logo", logo);
    const parse = vi.spyOn(JSON, "parse");
    try {
      const before = reads();
      const original = (await c.from("widgets").select()).data[0];
      for (let i = 0; i < 5; i++) await c.from("widgets").select();
      expect(reads()).toBe(before + 6);
      const next = (await c.from("widgets").select()).data[0];
      expect(next).not.toBe(original);
      expect(next.logo).toBe(logo);
      expect(parse.mock.calls.filter(([value]) => value === raw)).toHaveLength(1);
      expect(invoke.mock.calls.filter(([cmd, args]) => cmd === "cache_get" && args.key === "localdb:blob:fixture-logo")).toHaveLength(1);
    } finally { parse.mockRestore(); }
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
