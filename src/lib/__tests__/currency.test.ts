import { describe, it, expect } from "vitest";
import { aedEquivalent } from "../api";

describe("aedEquivalent", () => {
  it("returns the amount unchanged for AED or missing currency", () => {
    expect(aedEquivalent(100, "AED", 3.67)).toBe(100);
    expect(aedEquivalent(100, null, 3.67)).toBe(100);
    expect(aedEquivalent(100, undefined)).toBe(100);
  });

  it("multiplies by the frozen rate (AED per unit) for a foreign currency", () => {
    expect(aedEquivalent(100, "USD", 3.6725)).toBeCloseTo(367.25, 2);
  });

  it("passes through when the rate is missing or non-positive", () => {
    expect(aedEquivalent(100, "USD")).toBe(100);
    expect(aedEquivalent(100, "USD", 0)).toBe(100);
    expect(aedEquivalent(100, "USD", -5)).toBe(100);
  });
});
