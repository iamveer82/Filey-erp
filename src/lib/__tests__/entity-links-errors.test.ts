// A failed read is not an empty result. The links graph swallowed the error
// from every query it made, so a broken connection looked exactly like "this
// record has no links" — and readCached would then store that empty list as the
// record's truth. The duplicate check had the sharper edge: offline it is the
// ONLY guard (the local shim has no unique index), so one failed read put a
// second identical edge on the graph.
import { describe, it, expect, beforeEach, vi } from "vitest";

let failing = false;
const inserted: unknown[] = [];

vi.mock("../supabase", () => {
  // Every builder method returns the chain; awaiting it yields the result.
  const chain = (result: () => { data: unknown; error: unknown }): any => {
    const c: any = {
      then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
    };
    for (const m of ["select", "eq", "in", "ilike", "limit", "order", "maybeSingle"])
      c[m] = () => c;
    c.insert = (row: unknown) => {
      inserted.push(row);
      return chain(() => ({ data: { id: 99 }, error: null }));
    };
    return c;
  };
  return {
    isConfigured: true,
    supabase: {},
    sb: () => ({
      from: () =>
        chain(() =>
          failing
            ? { data: null, error: { message: "connection reset", code: "08006" } }
            : { data: [], error: null }
        ),
    }),
  };
});

const { links } = await import("../api");

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  failing = false;
  inserted.length = 0;
});

describe("links.for", () => {
  it("throws when the graph cannot be read, rather than reporting no links", async () => {
    failing = true;
    await expect(links.for("customer", 1)).rejects.toMatchObject({
      message: "connection reset",
    });
  });

  it("returns an empty list when there genuinely are none", async () => {
    expect(await links.for("customer", 1)).toEqual([]);
  });
});

describe("links.add", () => {
  it("does not insert when the duplicate check failed", async () => {
    failing = true;
    await expect(
      links.add({ type: "customer", id: 1 }, { type: "invoice", id: 2 })
    ).rejects.toMatchObject({ message: "connection reset" });
    // The insert is the damage: offline there is no unique index to catch it.
    expect(inserted).toHaveLength(0);
  });

  it("inserts when the check runs and finds nothing", async () => {
    await links.add({ type: "customer", id: 1 }, { type: "invoice", id: 2 });
    expect(inserted).toHaveLength(1);
  });
});

describe("links.search", () => {
  it("throws rather than showing an empty picker", async () => {
    failing = true;
    await expect(links.search("customer", "acme")).rejects.toMatchObject({
      message: "connection reset",
    });
  });
});
