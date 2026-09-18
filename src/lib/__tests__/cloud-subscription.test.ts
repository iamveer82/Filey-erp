import { beforeEach, describe, expect, it, vi } from "vitest";

// The buyer pays $5 in a browser window and this poll is what turns the app on.
// It must not settle on "free" while the webhook is still in flight, and must
// not spin forever when the payment never happens.
const plan = { value: "free", status: null as string | null, reads: 0 };

vi.mock("../supabase", () => ({
  isConfigured: true,
  cloudConfigured: true,
  supabase: {
    from: () => {
      const query = {
        select: () => query,
        limit: () => query,
        maybeSingle: async () => {
          plan.reads++;
          return {
            data: {
              plan: plan.value,
              plan_status: plan.status,
              current_period_end: null,
            },
            error: null,
          };
        },
      };
      return query;
    },
  },
  invokeFn: async () => ({ data: {}, error: null }),
}));

describe("waiting for the Cloud plan to switch on", () => {
  beforeEach(() => {
    plan.value = "free";
    plan.status = null;
    plan.reads = 0;
  });

  it("returns as soon as the webhook has set the plan", async () => {
    const { awaitCloudPlan } = await import("../subscription");
    plan.value = "cloud";
    plan.status = "active";
    const sub = await awaitCloudPlan(5, 0);
    expect(sub?.plan).toBe("cloud");
    expect(plan.reads).toBe(1);
  });

  it("keeps waiting while the subscription is still pending", async () => {
    const { awaitCloudPlan } = await import("../subscription");
    let reads = 0;
    const tick = setInterval(() => {
      if (++reads >= 2) {
        plan.value = "cloud";
        plan.status = "active";
        clearInterval(tick);
      }
    }, 1);
    const sub = await awaitCloudPlan(20, 2);
    clearInterval(tick);
    expect(sub?.plan).toBe("cloud");
    expect(plan.reads).toBeGreaterThan(1);
  });

  it("does not mistake a pending subscription for a paid one", async () => {
    const { awaitCloudPlan } = await import("../subscription");
    plan.value = "free";
    plan.status = "pending";
    const sub = await awaitCloudPlan(3, 0);
    expect(sub).toBeNull();
    expect(plan.reads).toBe(3);
  });

  it("gives up when no payment ever arrives", async () => {
    const { awaitCloudPlan } = await import("../subscription");
    const sub = await awaitCloudPlan(4, 0);
    expect(sub).toBeNull();
    expect(plan.reads).toBe(4);
  });
});
