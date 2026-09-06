// The offline outbox replays queued writes in order on reconnect. Order is why
// a failure stops the replay — an insert has to land before the update that
// follows it. But an op that can never succeed used to stop it in exactly the
// same way and was never cleared, so the queue jammed on that entry and every
// write made offline afterwards stayed stranded behind it, silently, forever.
import { describe, it, expect, beforeEach, vi } from "vitest";

// A table whose name starts with "doomed" always fails with a unique-violation;
// "flaky" fails with a network error; everything else succeeds.
const attempted: string[] = [];
vi.mock("../supabase", () => {
  const result = (t: string) =>
    t.startsWith("doomed")
      ? { error: { code: "23505", message: "duplicate key value" } }
      : t.startsWith("flaky")
        ? { error: { message: "Failed to fetch" } }
        : { error: null };
  return {
    isConfigured: true,
    supabase: {},
    sb: () => ({
      from(t: string) {
        const done = () => {
          attempted.push(t);
          return Promise.resolve(result(t));
        };
        return {
          insert: done,
          update: () => ({ eq: done }),
          delete: () => ({ eq: done }),
        };
      },
    }),
  };
});

const { flushOutbox, outboxOpIsDoomed } = await import("../api");

const queue = (ops: { k: string; t: string; id?: number; row?: unknown }[]) =>
  localStorage.setItem(
    "outbox",
    JSON.stringify(ops.map((op, i) => ({ id: i + 1, op: JSON.stringify(op) })))
  );
const remaining = (): unknown[] => JSON.parse(localStorage.getItem("outbox") || "[]");

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "cloud");
  attempted.length = 0;
});

describe("outboxOpIsDoomed", () => {
  it("treats integrity violations and no-rows as unrepeatable", () => {
    expect(outboxOpIsDoomed({ code: "23505" })).toBe(true); // unique key taken
    expect(outboxOpIsDoomed({ code: "23503" })).toBe(true); // foreign key gone
    expect(outboxOpIsDoomed({ code: "PGRST116" })).toBe(true); // row deleted elsewhere
  });

  it("treats anything else as worth retrying", () => {
    expect(outboxOpIsDoomed({ message: "Failed to fetch" })).toBe(false);
    expect(outboxOpIsDoomed({ code: "500" })).toBe(false);
    expect(outboxOpIsDoomed(null)).toBe(false);
  });
});

describe("flushOutbox", () => {
  it("drops an op that can never apply and drains the rest", async () => {
    queue([
      { k: "insert", t: "doomed_products", row: { name: "dupe" } },
      { k: "insert", t: "products", row: { name: "stranded behind it" } },
      { k: "update", t: "orders", id: 3, row: { status: "paid" } },
    ]);

    await flushOutbox();

    // Every op was tried, not just the first, and the queue is empty.
    expect(attempted).toEqual(["doomed_products", "products", "orders"]);
    expect(remaining()).toEqual([]);
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

  it("discards an entry whose payload is not readable", async () => {
    localStorage.setItem("outbox", JSON.stringify([{ id: 1, op: "{not json" }]));

    await flushOutbox();

    expect(remaining()).toEqual([]);
  });
});
