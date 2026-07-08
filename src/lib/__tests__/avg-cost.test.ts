import { describe, it, expect } from "vitest";
import { nextAvgCost } from "../api";

describe("nextAvgCost (moving-average cost)", () => {
  it("weights old stock and receipt by quantity", () => {
    // 100 on hand @ 10, receive 100 @ 14 → 12
    expect(nextAvgCost(100, 10, 100, 14)).toBe(12);
  });

  it("uses receipt cost when there is no stock", () => {
    expect(nextAvgCost(0, 10, 50, 14)).toBe(14);
  });

  it("uses receipt cost when product had no cost", () => {
    expect(nextAvgCost(100, 0, 50, 14)).toBe(14);
  });

  it("rounds to 2 decimals", () => {
    // (3*10 + 1*11) / 4 = 10.25 ; (1*10 + 2*11)/3 = 10.666… → 10.67
    expect(nextAvgCost(3, 10, 1, 11)).toBe(10.25);
    expect(nextAvgCost(1, 10, 2, 11)).toBe(10.67);
  });
});
