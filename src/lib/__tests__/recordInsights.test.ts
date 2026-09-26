import { expect, it, vi } from "vitest";
import { recordInsights } from "../recordInsights";

it("uses local months for timestamps while preserving date-only fields", () => {
  // Simulate a viewer east of UTC: this August instant is September locally.
  const nativeMonth = Date.prototype.getMonth;
  const month = vi.spyOn(Date.prototype, "getMonth").mockImplementation(function (this: Date) {
    return this.toISOString() === "2026-08-31T22:00:00.000Z" ? 8 : nativeMonth.call(this);
  });
  try {
    const result = recordInsights(
      ["2026-08-31T22:00:00Z", "2026-08-31"], () => "Saved", value => value, 2, new Date(2026, 8, 7)
    );
    expect(result.trend.map(row => row.count)).toEqual([1, 1]);
  } finally {
    month.mockRestore();
  }
});

it("counts real records, preserves totals in overflow groups, and does not shift date-only months", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    category: `Group ${i}`,
    date: i === 0 ? "invalid" : i === 1 ? "2025-01-01" : "2026-09-01",
  }));
  const result = recordInsights(
    rows,
    (r) => r.category,
    (r) => r.date,
    6,
    new Date(2026, 8, 6)
  );
  expect(result.distribution).toHaveLength(8);
  expect(result.distribution.reduce((sum, row) => sum + row.count, 0)).toBe(10);
  expect(result.undated).toBe(1);
  expect(result.trend.map((row) => row.count)).toEqual([0, 0, 0, 0, 0, 8]);
  expect(
    recordInsights([{ category: " " }], (r) => r.category, undefined).distribution
  ).toEqual([{ name: "Unassigned", count: 1 }]);
});
