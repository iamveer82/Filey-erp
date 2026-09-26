import { expect, it } from "vitest";
import { reportMoney } from "../reportMoney";
import { recordInsights } from "../recordInsights";
import { allZero } from "../../components/ChartEmpty";
import { chartAmount, setDisplayCurrency } from "../format";

it("keeps chart axes compact and in the same display currency as totals", () => {
  try {
    setDisplayCurrency("USD", 4);
    expect(chartAmount(720000)).toBe("180K");
    expect(chartAmount(-2000)).toBe("-500");
  } finally {
    setDisplayCurrency("AED");
  }
});

it("normalizes mixed-currency reports using frozen rates without changing source records", () => {
  const original = {
    currency: "USD",
    fx_rate: 3.67,
    total: 100,
    paid: 25,
    balance: 75,
    net_by_tax_category: { Z: 100 },
  };
  const normalized = reportMoney(original, ["total", "paid", "balance"], { USD: 4 });
  expect(normalized.total).toBeCloseTo(367);
  expect(normalized.balance).toBeCloseTo(275.25);
  expect(normalized.net_by_tax_category.Z).toBeCloseTo(367);
  expect(normalized.currency).toBe("AED");
  expect(original.total).toBe(100);
  expect(() => reportMoney({ currency: "XXX", total: 10 }, ["total"], {})).toThrow(
    "No AED exchange rate"
  );
});

it("shows negative chart data and excludes impossible calendar dates", () => {
  expect(allZero([{ value: -25 }], "value")).toBe(false);
  expect(allZero([{ value: NaN }], "value")).toBe(true);
  const result = recordInsights(
    [{ date: "2026-02-30" }, { date: "2026-02-28" }],
    () => "Sales",
    (row) => row.date,
    6,
    new Date("2026-03-10")
  );
  expect(result.undated).toBe(1);
  expect(result.trend.reduce((sum, row) => sum + row.count, 0)).toBe(1);
});
