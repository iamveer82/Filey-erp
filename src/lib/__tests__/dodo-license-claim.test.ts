import { beforeEach, describe, expect, it, vi } from "vitest";

// The buyer's whole experience after paying is this function: Dodo redirects
// them back, the webhook may not have landed yet, and the app has to end up on
// Freedom without anyone pasting a code.
const calls: { action: string }[] = [];
const state = { licensedAfter: 0, activateCalls: 0 };
const workspace = vi.hoisted(() => ({ scope: "cloud:org-a:user:buyer" }));
vi.mock("../agentStorage", () => ({ agentStorageScope: () => workspace.scope, AGENT_STORAGE_EVENT: "filey:agent-storage" }));

vi.mock("../supabase", () => ({
  isConfigured: true,
  cloudConfigured: true,
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "buyer" }, access_token: "fixture-buyer-token" } }, error: null }) } },
  invokeFn: async (_client: unknown, fn: string, opts: { body: { action: string }; headers: Record<string, string> }) => {
    expect(opts.headers.Authorization).toBe("Bearer fixture-buyer-token");
    calls.push({ action: opts.body.action });
    if (fn !== "dodo") throw new Error(`unexpected function: ${fn}`);
    if (opts.body.action === "license_status") {
      const seen = calls.filter((c) => c.action === "license_status").length;
      return { data: { licensed: seen >= state.licensedAfter }, error: null };
    }
    if (opts.body.action === "license_activate") {
      state.activateCalls++;
      return { data: { token: "token.sig" }, error: null };
    }
    return { data: {}, error: null };
  },
}));

vi.mock("../dataMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../dataMode")>()),
  isLocalMode: () => false,
}));

describe("claiming a Freedom licence after checkout", () => {
  beforeEach(() => {
    calls.length = 0;
    state.licensedAfter = 0;
    state.activateCalls = 0;
    workspace.scope = "cloud:org-a:user:buyer";
  });

  it("activates this device as soon as the webhook has landed", async () => {
    const { claimPurchasedLicense } = await import("../license");
    state.licensedAfter = 1; // licensed on the first poll
    const result = await claimPurchasedLicense(3, 0);
    expect(result).not.toBeNull();
    expect(state.activateCalls).toBe(1);
  });

  it("keeps polling while the payment is still in flight", async () => {
    const { claimPurchasedLicense } = await import("../license");
    state.licensedAfter = 3; // webhook lands on the third poll
    const result = await claimPurchasedLicense(5, 0);
    expect(result).not.toBeNull();
    expect(calls.filter((c) => c.action === "license_status").length).toBe(3);
    expect(state.activateCalls).toBe(1);
  });

  it("gives up rather than activating when no payment ever arrives", async () => {
    const { claimPurchasedLicense } = await import("../license");
    state.licensedAfter = 99; // never licensed
    const result = await claimPurchasedLicense(3, 0);
    expect(result).toBeNull();
    expect(state.activateCalls).toBe(0);
    expect(calls.filter((c) => c.action === "license_status").length).toBe(3);
  });

  it("cannot activate a different workspace's license after the checkout wait changes scope", async () => {
    vi.useFakeTimers();
    try {
      const { claimPurchasedLicense } = await import("../license");
      state.licensedAfter = 2;
      const pending = claimPurchasedLicense(4, 50);
      const rejected = expect(pending).rejects.toThrow("workspace changed");
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.filter((c) => c.action === "license_status").length).toBe(1);
      workspace.scope = "cloud:org-b:user:buyer";
      await vi.advanceTimersByTimeAsync(50);
      await rejected;
      expect(calls.filter((c) => c.action === "license_status").length).toBe(1);
      expect(state.activateCalls).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
