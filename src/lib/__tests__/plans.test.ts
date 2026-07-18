import { describe, it, expect } from "vitest";
import { FREE_LIMITS, resolveTier } from "../license";
import { planCardFor, PLANS } from "../subscription";

describe("FREE_LIMITS", () => {
  it("caps the free tier at 20 invoices per month", () => {
    expect(FREE_LIMITS.invoicesPerMonth).toBe(20);
  });
});

describe("resolveTier", () => {
  it("returns pro for any paid plan with a live/grace status", () => {
    for (const status of ["active", "trialing", "past_due"]) {
      expect(resolveTier(false, "pro", status)).toBe("pro");
      expect(resolveTier(false, "enterprise", status)).toBe("pro");
      expect(resolveTier(false, "business", status)).toBe("pro");
    }
  });

  it("returns lite for a valid offline license without a paid plan", () => {
    expect(resolveTier(true, "free", null)).toBe("lite");
    expect(resolveTier(true, null, null)).toBe("lite");
  });

  it("returns free otherwise, including a lapsed subscription", () => {
    expect(resolveTier(false, "free", null)).toBe("free");
    expect(resolveTier(false, null, null)).toBe("free");
    expect(resolveTier(false, "pro", "canceled")).toBe("free");
  });
});

describe("planCardFor", () => {
  it("maps legacy business orgs onto the Enterprise card", () => {
    expect(planCardFor("business").id).toBe("enterprise");
    expect(planCardFor("enterprise").id).toBe("enterprise");
  });

  it("maps free/pro to their own cards and defaults to Free", () => {
    expect(planCardFor("pro").id).toBe("pro");
    expect(planCardFor("free").id).toBe("free");
    expect(planCardFor(undefined).id).toBe("free");
    expect(planCardFor(null).id).toBe("free");
  });

  it("exposes exactly the four tiers, with enterprise as contact-only", () => {
    expect(PLANS.map((p) => p.id)).toEqual(["free", "lite", "pro", "enterprise"]);
    expect(PLANS.find((p) => p.id === "enterprise")?.kind).toBe("contact");
    expect(PLANS.find((p) => p.id === "lite")?.kind).toBe("license");
  });

  it("carries the launch prices (AED)", () => {
    expect(PLANS.find((p) => p.id === "free")?.price).toBe("AED 0");
    expect(PLANS.find((p) => p.id === "lite")?.price).toBe("AED 399");
    expect(PLANS.find((p) => p.id === "pro")?.price).toBe("AED 29");
  });
});
