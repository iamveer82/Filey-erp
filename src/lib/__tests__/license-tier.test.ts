import { describe, it, expect } from "vitest";
import { resolveTier, FREE_LIMITS } from "../license";

describe("resolveTier", () => {
  it("active/trialing/past_due paid plan → pro (past_due = grace period)", () => {
    expect(resolveTier(false, "pro", "active")).toBe("pro");
    expect(resolveTier(false, "business", "trialing")).toBe("pro");
    expect(resolveTier(false, "pro", "past_due")).toBe("pro");
    expect(resolveTier(true, "pro", "active")).toBe("pro"); // pro outranks lite
  });

  it("canceled or free plan falls back to license", () => {
    expect(resolveTier(true, "pro", "canceled")).toBe("lite");
    expect(resolveTier(true, "free", "active")).toBe("lite");
    expect(resolveTier(true, null, null)).toBe("lite");
  });

  it("nothing → free", () => {
    expect(resolveTier(false, null, null)).toBe("free");
    expect(resolveTier(false, "pro", "canceled")).toBe("free");
  });

  it("free caps are volume/branding, not zero", () => {
    expect(FREE_LIMITS.invoicesPerMonth).toBeGreaterThan(0);
  });
});
