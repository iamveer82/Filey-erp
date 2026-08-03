import { describe, it, expect, vi, beforeEach } from "vitest";

const aiFetch = vi.fn();
vi.mock("../ai", () => ({ aiFetch }));

const {
  overLimit,
  PLATFORM_LIMITS,
  listAccounts,
  createPost,
  setZernioConfig,
  zernioReady,
  getZernioConfig,
} = await import("../zernio");

const jsonRes = (body: unknown) =>
  ({ text: async () => JSON.stringify(body) }) as Response;

beforeEach(() => {
  localStorage.clear();
  aiFetch.mockReset().mockResolvedValue(jsonRes({ accounts: [] }));
  setZernioConfig({ enabled: true, apiKey: "sk_test" });
});

describe("config", () => {
  it("is off until both the switch and a key are present", () => {
    localStorage.clear();
    expect(zernioReady()).toBe(false);
    setZernioConfig({ enabled: true });
    expect(zernioReady()).toBe(false); // no key
    setZernioConfig({ apiKey: "sk_x" });
    expect(zernioReady()).toBe(true);
  });

  it("refuses to call the API before it is configured", async () => {
    localStorage.clear();
    await expect(listAccounts()).rejects.toThrow(/Integrations/i);
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
    expect(keys).toEqual(["filey_zernio_config"]);
  });
});

describe("listAccounts", () => {
  it("accepts both a bare array and a wrapped object", async () => {
    aiFetch.mockResolvedValueOnce(jsonRes([{ id: "1", platform: "x" }]));
    expect(await listAccounts()).toHaveLength(1);
    aiFetch.mockResolvedValueOnce(jsonRes({ accounts: [{ id: "2", platform: "ig" }] }));
    expect(await listAccounts()).toHaveLength(1);
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
