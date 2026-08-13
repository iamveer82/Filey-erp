import { describe, it, expect } from "vitest";
import { FREE_LIMITS, resolveTier } from "../license";
import { planCardFor, PLANS } from "../subscription";

describe("FREE_LIMITS", () => {
  // Must match the server trigger in supabase/2026-07-29-free-invoice-cap-5.sql.
  // If they drift, the client lets an invoice through and the database rejects
  // it — a save that fails for no reason the user can see.
  it("caps the free tier at 5 invoices per month", () => {
    expect(FREE_LIMITS.invoicesPerMonth).toBe(5);
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
  // Pro and Enterprise were withdrawn from sale. Orgs still carry those plan
  // values, so the mapping must keep answering for them — a card lookup that
  // returned undefined would crash the billing panel of the very customers who
  // paid the most.
  it("still answers for plans that are no longer sold", () => {
    for (const legacy of ["pro", "business", "enterprise"]) {
      expect(planCardFor(legacy).id).toBe("lite");
    }
  });

  it("maps free to its own card and defaults to Free", () => {
    expect(planCardFor("free").id).toBe("free");
    expect(planCardFor(undefined).id).toBe("free");
    expect(planCardFor(null).id).toBe("free");
  });

  it("sells exactly two plans: Free, and Freedom as a one-time licence", () => {
    expect(PLANS.map((p) => p.id)).toEqual(["free", "lite"]);
    expect(PLANS.find((p) => p.id === "lite")?.kind).toBe("license");
    expect(PLANS.find((p) => p.id === "lite")?.period).toBe(" one-time");
  });

  it("carries the current prices (AED)", () => {
    expect(PLANS.find((p) => p.id === "free")?.price).toBe("AED 0");
    expect(PLANS.find((p) => p.id === "lite")?.price).toBe("AED 1,499");
  });
});

describe("withdrawn plans keep their entitlements", () => {
  // Removing a plan from the price list must never remove access from someone
  // already on it — that would look like a billing failure to a paying user.
  it("still resolves an existing pro/business org to the pro tier", () => {
    expect(resolveTier(false, "pro", "active")).toBe("pro");
    expect(resolveTier(false, "business", "active")).toBe("pro");
  });
});
