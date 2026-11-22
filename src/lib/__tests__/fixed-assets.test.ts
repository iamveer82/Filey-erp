import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  settings: [] as { key: string; value: string }[],
  journal: [] as { id: number; txn_type: string; amount: number; description?: string; txn_date: string }[],
  posts: [] as unknown[][],
  failCredit: false,
}));

vi.mock("../api", () => ({
  tools: {
    settings: async () => store.settings,
    setSetting: async (key: string, value: string) => {
      store.settings = [...store.settings.filter((r) => r.key !== key), { key, value }];
    },
  },
  fin: {
    transactions: async () => store.journal,
    postFixedAsset: async (kind: string, amount: number, date: string, note: string, only?: "debit" | "credit") => {
      store.posts.push([kind, amount, date, note, only]);
      if (only !== "credit") store.journal.push({ id: store.journal.length + 1, txn_type: "debit", amount, description: note, txn_date: date });
      if (store.failCredit) throw new Error("connection lost");
      if (only !== "debit") store.journal.push({ id: store.journal.length + 1, txn_type: "credit", amount, description: note, txn_date: date });
    },
  },
}));
vi.mock("../format", () => ({ todayYmd: () => "2026-11-12" }));

import {
  addFixedAsset, assetFigures, cleanAsset, depreciationSchedule, disposeFixedAsset, loadFixedAssets, postDepreciation,
  type FixedAsset,
} from "../fixedAssets";

const van: FixedAsset = {
  id: "11111111-aaaa-bbbb-cccc-000000000001", name: "Delivery van", category: "Vehicle",
  purchase_date: "2026-01-20", cost: 100_000, salvage: 10_000, life_months: 36, method: "straight_line",
};

beforeEach(() => {
  store.settings = [];
  store.journal = [];
  store.posts = [];
  store.failCredit = false;
});

describe("depreciationSchedule", () => {
  it("spreads cost less end value evenly and ends on the exact total", () => {
    const rows = depreciationSchedule(van, "2030-12");
    expect(rows).toHaveLength(36);
    expect(rows[0]).toEqual({ month: "2026-01", amount: 2500 });
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(90_000);
  });

  it("puts the rounding remainder in the last month", () => {
    const rows = depreciationSchedule({ ...van, cost: 1000, salvage: 0, life_months: 3 }, "2030-12");
    expect(rows.map((r) => r.amount)).toEqual([333.33, 333.33, 333.34]);
  });

  it("stops the month before a disposal", () => {
    const rows = depreciationSchedule({ ...van, disposed_on: "2026-04-10" }, "2030-12");
    expect(rows.map((r) => r.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("declining balance writes off a share of what is left and never goes below the end value", () => {
    const pc: FixedAsset = { ...van, cost: 12_000, salvage: 2_000, life_months: 0, method: "declining_balance", rate: 40 };
    const rows = depreciationSchedule(pc, "2060-12");
    expect(rows[0].amount).toBe(400); // 12,000 × 40% ÷ 12
    expect(rows[1].amount).toBeLessThan(rows[0].amount);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBeLessThanOrEqual(10_000);
  });
});

describe("assetFigures", () => {
  it("reports what is written off, what is left and what is not yet in the books", () => {
    expect(assetFigures(van, "2026-03")).toMatchObject({ accumulated: 7500, book_value: 92_500, this_month: 2500, due: 7500, due_from: "2026-01", due_to: "2026-03" });
    expect(assetFigures({ ...van, posted_through: "2026-02" }, "2026-03")).toMatchObject({ due: 2500, due_from: "2026-03", due_to: "2026-03" });
    expect(assetFigures({ ...van, posted_through: "2026-03" }, "2026-03").due).toBe(0);
  });
});

describe("cleanAsset", () => {
  const ok = { name: " Van ", category: "", purchase_date: "2026-01-20", cost: 5000, salvage: 0, life_months: 24, method: "straight_line" as const };
  it("tidies a valid asset", () => {
    expect(cleanAsset(ok)).toMatchObject({ name: "Van", category: "Other", life_months: 24 });
  });
  it("refuses values that would produce wrong books", () => {
    expect(() => cleanAsset({ ...ok, name: " " })).toThrow("name");
    expect(() => cleanAsset({ ...ok, cost: 0 })).toThrow("cost");
    expect(() => cleanAsset({ ...ok, salvage: 5000 })).toThrow("less than the cost");
    expect(() => cleanAsset({ ...ok, purchase_date: "2026-02-30" })).toThrow("purchase date");
    expect(() => cleanAsset({ ...ok, life_months: 0 })).toThrow("how long");
    expect(() => cleanAsset({ ...ok, method: "declining_balance", rate: 0 })).toThrow("rate");
  });
});

describe("postDepreciation", () => {
  const seed = (...assets: FixedAsset[]) => { store.settings = [{ key: "fixed_assets", value: JSON.stringify(assets) }]; };

  it("posts what is due once and marks the asset", async () => {
    seed(van);
    const run = await postDepreciation("2026-03");
    expect(run).toEqual({ posted: [{ name: "Delivery van", amount: 7500, from: "2026-01", to: "2026-03" }], total: 7500 });
    expect(store.posts[0].slice(0, 3)).toEqual(["depreciation", 7500, "2026-03-31"]);
    expect((await loadFixedAssets())[0].posted_through).toBe("2026-03");
    expect((await postDepreciation("2026-03")).total).toBe(0);
    expect(store.journal).toHaveLength(2);
  });

  it("dates the current month's entry today, not at a month end still ahead", async () => {
    seed({ ...van, posted_through: "2026-10" });
    await postDepreciation("2026-11");
    expect(store.posts[0][2]).toBe("2026-11-12");
  });

  it("finishes a pair cut off halfway instead of posting it twice", async () => {
    seed(van);
    store.failCredit = true;
    await expect(postDepreciation("2026-01")).rejects.toThrow("connection lost");
    expect(store.journal.map((t) => t.txn_type)).toEqual(["debit"]);
    store.failCredit = false;
    await postDepreciation("2026-01");
    expect(store.journal.map((t) => t.txn_type)).toEqual(["debit", "credit"]);
    expect(store.posts[1][4]).toBe("credit");
  });

  it("refuses months ahead and a list it cannot read", async () => {
    await expect(postDepreciation("2027-01")).rejects.toThrow("months ahead");
    store.settings = [{ key: "fixed_assets", value: "{broken" }];
    await expect(postDepreciation("2026-03")).rejects.toThrow("could not be read");
  });
});

describe("register changes", () => {
  it("adds an asset and can record its purchase in the books", async () => {
    const asset = await addFixedAsset({ name: "Lathe", category: "Machinery", purchase_date: "2026-05-01", cost: 20_000, salvage: 0, life_months: 60, method: "straight_line" }, { recordPurchase: true });
    expect(await loadFixedAssets()).toEqual([asset]);
    expect(store.posts[0].slice(0, 3)).toEqual(["purchase", 20_000, "2026-05-01"]);
  });

  it("disposal stops depreciation and cannot predate the purchase", async () => {
    store.settings = [{ key: "fixed_assets", value: JSON.stringify([van]) }];
    await expect(disposeFixedAsset(van.id, "2025-12-31")).rejects.toThrow("before it was bought");
    await disposeFixedAsset(van.id, "2026-06-15");
    expect(assetFigures((await loadFixedAssets())[0], "2026-12").accumulated).toBe(12_500);
  });
});
