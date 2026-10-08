// The offline outbox replays queued writes in order on reconnect. Order is why
// a failure stops the replay — an insert has to land before the update that
// follows it. Unconfirmed writes stay available for recovery.
import { describe, it, expect, beforeEach, vi } from "vitest";

// A table whose name starts with "doomed" always fails with a unique-violation;
// "flaky" fails with a network error; "blocked" returns no visible rows.
const attempted: string[] = [];
const state = vi.hoisted(() => ({ afterWrite: () => {}, userId: "owner", orgId: "default" }));
vi.mock("../supabase", () => {
  const result = (t: string, id: number) =>
    t.startsWith("doomed")
      ? { error: { code: "23505", message: "duplicate key value" } }
      : t.startsWith("flaky")
        ? { error: { message: "Failed to fetch" } }
        : t.startsWith("blocked") ? { data: [], error: null }
        : t.startsWith("no_rows") ? { data: null, error: { code: "PGRST116" } }
        : { data: [{ id: t.startsWith("wrong_row") ? id + 1 : id }], error: null };
  return {
    isConfigured: true,
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: state.userId } } }, error: null }) },
      rpc: async () => ({ data: state.orgId, error: null }),
    },
    sb: () => ({
      from(t: string) {
        let id = 1;
        const done = () => {
          attempted.push(t);
          state.afterWrite();
          return Promise.resolve(result(t, id));
        };
        const mutation = {
          eq: (_column: string, value: number) => { id = value; return mutation; },
          select: done,
        };
        return {
          insert: () => mutation,
          update: () => mutation,
          delete: () => mutation,
        };
      },
    }),
  };
});

const { flushOutbox, setCacheOrg, erp } = await import("../api");

const queue = (ops: { k: string; t: string; id?: number; row?: unknown }[]) =>
  localStorage.setItem(
    "outbox",
    JSON.stringify(
      ops.map((op, i) => ({
        id: i + 1,
        op: JSON.stringify({ ...op, _workspace: "default:user:owner" }),
      }))
    )
  );
const remaining = (): unknown[] => JSON.parse(localStorage.getItem("outbox") || "[]");

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "cloud");
  attempted.length = 0;
  state.afterWrite = () => {};
  state.userId = "owner"; state.orgId = "default";
  setCacheOrg(null); setCacheOrg("default", "owner");
});

describe("flushOutbox", () => {
  it("removes only confirmed writes and drains them in order", async () => {
    const change = vi.fn();
    window.addEventListener("filey:outbox-change", change, { once: true });
    queue([
      { k: "insert", t: "products", row: { name: "New product" } },
      { k: "update", t: "orders", id: 3, row: { status: "paid" } },
      { k: "delete", t: "quotes", id: 4 },
    ]);
    await flushOutbox();
    expect(attempted).toEqual(["products", "orders", "quotes"]);
    expect(remaining()).toEqual([]);
    expect(change).toHaveBeenCalledOnce();
  });

  it.each(["insert", "update", "delete"])("retains an unconfirmed %s and dependent entries when RLS returns no rows", async k => {
    queue([
      { k, t: "blocked_products", id: 7, row: { name: "Unsaved edit" } },
      { k: "update", t: "orders", id: 3, row: { status: "paid" } },
    ]);
    const before = remaining();
    await flushOutbox();
    expect(attempted).toEqual(["blocked_products"]);
    expect(remaining()).toEqual(before);
  });

  it.each(["no_rows", "wrong_row"])("retains a failed or mismatched %s acknowledgement", async table => {
    queue([{ k: "update", t: table, id: 7, row: { name: "Unsaved edit" } }]);
    const before = remaining();
    await flushOutbox();
    expect(attempted).toEqual([table]);
    expect(remaining()).toEqual(before);
  });
  it("preserves queued writes until the real account and workspace match the restored scope", async () => {
    queue([{ k: "insert", t: "products", row: { name: "Old solo workspace" } }]);
    setCacheOrg(null);
    await flushOutbox();
    expect(attempted).toEqual([]);
    setCacheOrg(null, "owner");
    state.orgId = "new-company";
    await flushOutbox();
    expect(attempted).toEqual([]);
    state.orgId = "default"; state.userId = "someone-else";
    await flushOutbox();
    expect(attempted).toEqual([]);
    expect(remaining()).toHaveLength(1);
  });
  it.each(["mode", "account"])("stops replay when the %s changes during the previous request", async kind => {
    queue([
      { k: "insert", t: "products", row: { name: "First" } },
      { k: "update", t: "orders", id: 3, row: { status: "paid" } },
    ]);
    state.afterWrite = () => {
      if (kind === "mode") localStorage.setItem("filey_data_mode", "local");
      else setCacheOrg("another-org", "another-user");
    };
    await flushOutbox();
    expect(attempted).toEqual(["products"]);
    expect(remaining()).toHaveLength(1);
  });

  it("does not send a new save to a different store after awaiting queued cloud writes", async () => {
    queue([{ k: "insert", t: "products", row: { name: "Queued" } }]);
    state.afterWrite = () => localStorage.setItem("filey_data_mode", "local");
    await expect(erp.updateProduct(1, { name: "New cloud edit" })).rejects.toThrow("workspace changed");
    expect(attempted).toEqual(["products"]);
  });
  it("preserves unattributed or other-account changes without replaying them", async () => {
    localStorage.setItem(
      "outbox",
      JSON.stringify([
        {
          id: 1,
          op: JSON.stringify({ k: "insert", t: "products", row: { name: "Old" } }),
        },
        {
          id: 2,
          op: JSON.stringify({
            k: "insert",
            t: "products",
            row: { name: "Other" },
            _workspace: "other-account",
          }),
        },
      ])
    );
    await flushOutbox();
    expect(attempted).toEqual([]);
    expect(remaining()).toHaveLength(2);
  });
  it("preserves an integrity failure and dependent writes for explicit recovery", async () => {
    queue([
      { k: "insert", t: "doomed_products", row: { name: "dupe" } },
      { k: "insert", t: "products", row: { name: "stranded behind it" } },
      { k: "update", t: "orders", id: 3, row: { status: "paid" } },
    ]);

    await flushOutbox();

    expect(attempted).toEqual(["doomed_products"]);
    expect(remaining()).toHaveLength(3);
  });

  it("keeps a transient failure queued, with everything behind it", async () => {
    queue([
      { k: "insert", t: "flaky_products", row: { name: "offline" } },
      { k: "update", t: "orders", id: 3, row: { status: "paid" } },
    ]);

    await flushOutbox();

    // Stopped at the first failure — order must hold across a reconnect.
    expect(attempted).toEqual(["flaky_products"]);
    expect(remaining()).toHaveLength(2);
  });

  it("preserves an unreadable legacy entry for explicit recovery", async () => {
    localStorage.setItem("outbox", JSON.stringify([
      { id: 1, op: "{not json" },
      { id: 2, op: "null" },
      { id: 3, op: JSON.stringify({ k: "unknown", t: "products", id: 1, _workspace: "default:user:owner" }) },
      { id: 4, op: JSON.stringify({ k: "insert", t: "products", row: { name: "Valid" }, _workspace: "default:user:owner" }) },
    ]));

    await flushOutbox();

    expect(remaining()).toHaveLength(3);
    expect(attempted).toEqual(["products"]);
  });
});
