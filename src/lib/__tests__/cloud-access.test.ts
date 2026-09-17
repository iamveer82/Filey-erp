import { describe, expect, it } from "vitest";
import { resolveCloudAccess } from "../license";

// These assertions must agree with public.filey_cloud_access() in
// supabase/2026-09-16-cloud-access.sql. When they drift, the app either offers
// a Sync button the database then refuses, or hides one that would have worked.
describe("who may write to the cloud", () => {
  const enforced = true;

  it("lets a live paid plan through", () => {
    for (const status of ["active", "trialing", "past_due"]) {
      const access = resolveCloudAccess("cloud", status, false, enforced);
      expect(access.allowed, `status ${status}`).toBe(true);
      expect(access.reason).toBe("paid");
    }
  });

  it("keeps a grandfathered org on the cloud for free", () => {
    const access = resolveCloudAccess("free", null, true, enforced);
    expect(access.allowed).toBe(true);
    expect(access.reason).toBe("grandfathered");
  });

  it("refuses a free org that was never grandfathered", () => {
    const access = resolveCloudAccess("free", null, false, enforced);
    expect(access.allowed).toBe(false);
    expect(access.reason).toBe("none");
  });

  it("refuses a lapsed subscription", () => {
    for (const status of ["canceled", "expired", "paused", "failed", "pending", null]) {
      expect(resolveCloudAccess("cloud", status, false, enforced).allowed, `status ${status}`).toBe(
        false
      );
    }
  });

  it("still honours legacy plans that are no longer sold", () => {
    // Real organizations rows carry these. Refusing them would read as a
    // billing failure to the customers who paid the most.
    for (const plan of ["pro", "business", "enterprise"]) {
      expect(resolveCloudAccess(plan, "active", false, enforced).allowed, plan).toBe(true);
    }
  });

  it("changes nothing at all while licensing is unenforced", () => {
    const access = resolveCloudAccess("free", null, false, false);
    expect(access.allowed).toBe(true);
    expect(access.reason).toBe("unenforced");
  });
});
