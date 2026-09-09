import { describe, it, expect, vi, beforeEach } from "vitest";

const aiFetch = vi.fn();
const platformCall = vi.fn();
const platformAvailable = vi.fn();
const identity = vi.hoisted(() => ({
  account: "org-1:user:u1" as string | null,
  mode: "local",
}));
vi.mock("../ai", () => ({ aiFetch }));
vi.mock("../api", () => ({ getCacheScope: () => identity.account }));
vi.mock("../supabase", () => ({ cloudConfigured: true }));
vi.mock("../integrations", () => ({ platformCall, platformAvailable }));
vi.mock("../agentStorage", () => ({
  AGENT_STORAGE_EVENT: "filey:agent-storage",
  agentStorageScope: () =>
    identity.account ? `${identity.mode}:${identity.account}` : null,
  requireAgentStorageScope: (expected?: string) => {
    const scope = identity.account ? `${identity.mode}:${identity.account}` : null;
    if (!scope) throw new Error("Sign in before publishing.");
    if (expected && expected !== scope) throw new Error("Your workspace changed.");
    return scope;
  },
}));

const {
  overLimit,
  PLATFORM_LIMITS,
  listAccounts,
  createPost,
  setZernioConfig,
  zernioReady,
  usingOwnZernioKey,
  getZernioConfig,
  deletePost,
  zernioKeySource,
} = await import("../zernio");

const jsonRes = (body: unknown) =>
  ({ text: async () => JSON.stringify(body) }) as Response;

beforeEach(() => {
  localStorage.clear();
  identity.account = "org-1:user:u1";
  identity.mode = "local";
  aiFetch.mockReset().mockResolvedValue(jsonRes({ accounts: [] }));
  platformCall
    .mockReset()
    .mockRejectedValue(new Error("Sign in to connect social publishing."));
  platformAvailable.mockReset().mockResolvedValue(false);
  setZernioConfig({ enabled: true, apiKey: "sk_test" });
});

describe("config", () => {
  it("uses the customer's OWN key only when both the switch and a key are set", () => {
    localStorage.clear();
    expect(usingOwnZernioKey()).toBe(false);
    setZernioConfig({ enabled: true });
    expect(usingOwnZernioKey()).toBe(false); // no key
    setZernioConfig({ apiKey: "sk_x" });
    expect(usingOwnZernioKey()).toBe(true);
  });

  it("still counts as ready with no key, because the plan's key covers it", () => {
    // zernioReady answers "can this install publish at all", and since the
    // platform proxy exists the answer is yes without any configuration. What
    // an unconfigured install must NOT do is call zernio.com directly.
    localStorage.clear();
    expect(zernioReady()).toBe(true);
    expect(usingOwnZernioKey()).toBe(false);
  });

  it("never calls the provider directly without the customer's own key", async () => {
    localStorage.clear();
    // No cloud session in tests, so the platform path refuses too — the point
    // here is that the key-bearing direct call is not attempted.
    await expect(listAccounts()).rejects.toThrow();
    expect(aiFetch).not.toHaveBeenCalled();
  });

  it("sends the key as a bearer token and never in the URL", async () => {
    await listAccounts();
    const [url, init] = aiFetch.mock.calls[0];
    expect(url).toBe("https://zernio.com/api/v1/accounts");
    expect(url).not.toContain("sk_test");
    expect(init.headers.authorization).toBe("Bearer sk_test");
  });

  it("does not persist the key anywhere but its own store", () => {
    setZernioConfig({ apiKey: "sk_secret" });
    expect(getZernioConfig().apiKey).toBe("sk_secret");
    const keys = Object.keys(localStorage);
    expect(keys).toEqual([
      `filey_zernio_config:${encodeURIComponent(identity.account!)}`,
    ]);
  });

  it("isolates credentials by account and company while preserving them across storage modes", () => {
    const original = getZernioConfig();
    setZernioConfig({ profileId: "profile-a" });
    identity.mode = "cloud";
    expect(getZernioConfig()).toMatchObject({
      apiKey: "sk_test",
      profileId: "profile-a",
    });
    identity.account = "org-2:user:u1";
    expect(getZernioConfig()).toEqual({ enabled: false, apiKey: "" });
    expect(usingOwnZernioKey(original)).toBe(false);
    setZernioConfig({ enabled: true, apiKey: "sk_other" });
    identity.account = "org-1:user:u2";
    expect(getZernioConfig().apiKey).toBe("");
    identity.account = "org-1:user:u1";
    expect(getZernioConfig()).toMatchObject({
      apiKey: "sk_test",
      profileId: "profile-a",
    });
  });

  it("leaves the unowned legacy key untouched and requires a scoped reconnect", () => {
    localStorage.clear();
    const legacy = JSON.stringify({
      enabled: true,
      apiKey: "legacy-secret",
      profileId: "old",
    });
    localStorage.setItem("filey_zernio_config", legacy);
    expect(getZernioConfig()).toEqual({ apiKey: "", enabled: false });
    expect(usingOwnZernioKey()).toBe(false);
    setZernioConfig({ apiKey: "new-account-secret", enabled: true });
    expect(localStorage.getItem("filey_zernio_config")).toBe(legacy);
    expect(getZernioConfig().apiKey).toBe("new-account-secret");
  });

  it("does not reveal or write credentials after sign-out", async () => {
    identity.account = null;
    expect(getZernioConfig()).toEqual({ apiKey: "", enabled: false });
    expect(zernioReady()).toBe(false);
    expect(() => setZernioConfig({ apiKey: "not-saved" })).toThrow("Sign in");
    expect(await zernioKeySource()).toBe("none");
    await expect(listAccounts()).rejects.toThrow("Sign in");
    expect(aiFetch).not.toHaveBeenCalled();
    expect(platformCall).not.toHaveBeenCalled();
  });
});

describe("listAccounts", () => {
  it("accepts both a bare array and a wrapped object", async () => {
    aiFetch.mockResolvedValueOnce(jsonRes([{ id: "1", platform: "x" }]));
    expect(await listAccounts()).toHaveLength(1);
    aiFetch.mockResolvedValueOnce(jsonRes({ accounts: [{ id: "2", platform: "ig" }] }));
    expect(await listAccounts()).toHaveLength(1);
  });

  it("rejects provider data and errors that arrive after the workspace changed", async () => {
    aiFetch.mockImplementationOnce(async () => {
      identity.account = "other-org:user:u1";
      return jsonRes({ accounts: [{ id: "private-old-account" }] });
    });
    await expect(listAccounts()).rejects.toThrow("workspace changed");
    identity.account = "org-1:user:u1";
    aiFetch.mockResolvedValueOnce({
      text: async () => {
        identity.mode = "cloud";
        return JSON.stringify({ accounts: [{ id: "private-old-account" }] });
      },
    });
    await expect(listAccounts()).rejects.toThrow("workspace changed");
    aiFetch.mockImplementationOnce(async () => {
      identity.account = null;
      throw new Error("Private provider detail");
    });
    await expect(listAccounts()).rejects.toThrow("Sign in");
  });

  it("passes the captured scope to the proxy and ignores stale availability", async () => {
    localStorage.clear();
    platformCall.mockResolvedValueOnce({ accounts: [] });
    await listAccounts();
    expect(platformCall).toHaveBeenCalledWith(
      "zernio",
      "accounts",
      {},
      "local:org-1:user:u1"
    );
    platformAvailable.mockImplementationOnce(async () => {
      identity.account = "other-org:user:u1";
      return true;
    });
    expect(await zernioKeySource()).toBe("none");
  });
});

describe("overLimit", () => {
  it("flags a caption too long for X but fine for LinkedIn", () => {
    const content = "a".repeat(500);
    const over = overLimit(content, [
      { id: "1", platform: "twitter" },
      { id: "2", platform: "linkedin" },
    ]);
    expect(over).toEqual([{ platform: "twitter", limit: 280, over: 220 }]);
  });

  it("reports each platform once even with several accounts on it", () => {
    const over = overLimit("a".repeat(400), [
      { id: "1", platform: "twitter" },
      { id: "2", platform: "Twitter" },
      { id: "3", platform: "TWITTER" },
    ]);
    expect(over).toHaveLength(1);
  });

  it("says nothing when everything fits, or the platform is unknown", () => {
    expect(overLimit("short", [{ id: "1", platform: "twitter" }])).toEqual([]);
    expect(
      overLimit("a".repeat(9999), [{ id: "1", platform: "carrier-pigeon" }])
    ).toEqual([]);
  });

  it("measures trimmed length, so trailing whitespace is not an error", () => {
    const content = "a".repeat(280) + "   \n";
    expect(overLimit(content, [{ id: "1", platform: "twitter" }])).toEqual([]);
  });

  it("has a limit for every platform Zernio supports", () => {
    for (const p of ["twitter", "instagram", "linkedin", "tiktok", "youtube", "threads"])
      expect(PLATFORM_LIMITS[p]).toBeGreaterThan(0);
  });
});

describe("createPost", () => {
  it("never automatically retries writes, while preserving safe read retries", async () => {
    await createPost({ accountIds: ["1"], content: "Reviewed post" });
    expect(aiFetch.mock.calls[0][2]).toEqual({ retries: 0 });
    await deletePost("p-1");
    expect(aiFetch.mock.calls[1][2]).toEqual({ retries: 0 });
    await listAccounts();
    expect(aiFetch.mock.calls[2][2]).toEqual({ retries: 3 });
  });
  it("refuses an empty post and a post with no accounts", async () => {
    await expect(createPost({ accountIds: [], content: "hi" })).rejects.toThrow(
      /at least one account/i
    );
    await expect(createPost({ accountIds: ["1"], content: "  " })).rejects.toThrow(
      /text or media/i
    );
  });

  it("allows a media-only post", async () => {
    aiFetch.mockResolvedValueOnce(jsonRes({ id: "p1", status: "scheduled" }));
    const post = await createPost({
      accountIds: ["1"],
      content: "",
      mediaUrls: ["https://example.com/a.jpg"],
    });
    expect(post.id).toBe("p1");
  });

  it("omits scheduledAt entirely when publishing now", async () => {
    aiFetch.mockResolvedValueOnce(jsonRes({ id: "p2", status: "published" }));
    await createPost({ accountIds: ["1"], content: "hello" });
    const body = JSON.parse(aiFetch.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("scheduledAt");
    expect(body.accountIds).toEqual(["1"]);
  });
});
