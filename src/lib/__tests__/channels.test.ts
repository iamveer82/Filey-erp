// Channel-layer tests: parsing, backend fallback, and the honest-failure
// contract. All network is stubbed — these pin the LOGIC, not the platforms.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  githubRepo,
  githubTree,
  githubFile,
  youtubeId,
  youtubeVideo,
  rssFeed,
  socialPage,
} from "../channels";
import { ReachError } from "../reach";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

/** Route httpFetch/readUrl calls to canned responses by URL pattern. */
function stubRoutes(routes: [RegExp, () => { status?: number; body: string; text?: string }][]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      for (const [re, make] of routes)
        if (re.test(url)) {
          const r = make();
          return {
            ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
            status: r.status ?? 200,
            body: r.body,
            json: async () => JSON.parse(r.body || "{}"),
            text: async () => (typeof r.text === "string" ? r.text : r.body),
            headers: new Headers(),
          };
        }
      throw new Error(`no route for ${url}`);
    })
  );
}

describe("github channel", () => {
  it("reads a repo: meta, README, tree, and flags agent instructions", async () => {
    stubRoutes([
      [/api\.github\.com\/repos\/acme\/widgets$/, () => ({
        body: JSON.stringify({
          full_name: "acme/widgets",
          description: "Does things",
          stargazers_count: 42,
          forks_count: 3,
          open_issues_count: 1,
          language: "TS",
          license: { spdx_id: "MIT" },
          pushed_at: "2026-08-01T00:00:00Z",
          topics: ["erp"],
        }),
      })],
      [/repos\/acme\/widgets\/readme/, () => ({
        body: JSON.stringify({ content: btoa("# Widgets\nUseful stuff.") }),
      })],
      [/repos\/acme\/widgets\/git\/trees/, () => ({
        body: JSON.stringify({
          tree: [
            { path: "SKILL.md", type: "blob" },
            { path: "src/index.ts", type: "blob" },
          ],
        }),
      })],
    ]);

    const r = await githubRepo("https://github.com/acme/widgets");
    expect(r.via).toBe("github");
    expect(r.content).toContain("★ 42");
    expect(r.content).toContain("src/index.ts");
    // The whole point of "use any repo": the agent is told the repo carries
    // installable instructions and what tool installs them.
    expect(r.content).toContain("import_skill");
    // Untrusted wrapping invariant.
    expect(r.content).toMatch(/^<web_content/);
    expect(r.content).toContain('source="github:acme/widgets"');
  });

  it("lists a tree and reads a file, refusing paths that escape it", async () => {
    stubRoutes([
      [/git\/trees/, () => ({
        body: JSON.stringify({ tree: [{ path: "docs/a.md", type: "blob" }] }),
      })],
      [/raw\.githubusercontent\.com\/acme\/widgets\/HEAD\/docs\/a\.md/, () => ({
        body: "# Doc A",
      })],
    ]);
    const t = await githubTree("acme/widgets");
    expect(t.files).toEqual(["docs/a.md"]);
    const f = await githubFile("acme/widgets", "/docs/a.md");
    expect(f.path).toBe("docs/a.md");
    expect(f.content).toContain("# Doc A");
    await expect(githubFile("acme/widgets", "../../etc/passwd")).rejects.toBeInstanceOf(ReachError);
  });

  it("prescribes the fix on a private repo and rate limit instead of failing blankly", async () => {
    stubRoutes([
      [/api\.github\.com\/repos\/acme\/private$/, () => ({ status: 404, body: "{}" })],
      [/api\.github\.com\/repos\/acme\/busy$/, () => ({ status: 403, body: "{}" })],
    ]);
    await expect(githubRepo("acme/private")).rejects.toThrow(/gh CLI|private/);
    await expect(githubRepo("acme/busy")).rejects.toThrow(/rate limit/i);
  });
});

describe("youtube channel", () => {
  it("extracts ids from URLs and bare ids", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("hello world")).toBeNull();
  });

  it("falls back through piped instances to jina when they fail", { timeout: 30_000 }, async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("pipedapi")) {
          calls++;
          throw new Error("instance down");
        }
        if (url.startsWith("https://r.jina.ai/")) {
          return {
            ok: true,
            status: 200,
            text: async () => "Title: Some Video\n\nTranscript-ish page text",
            body: "",
            headers: new Headers(),
          };
        }
        throw new Error(`no route ${url}`);
      })
    );
    const r = await youtubeVideo("dQw4w9WgXcQ");
    expect(calls).toBeGreaterThanOrEqual(2); // both piped instances probed
    expect(r.content).toContain("Some Video");
    expect(r.transcript).toBeUndefined(); // captions refused honestly
    expect(r.content).toContain("No transcript available");
  });
});

describe("rss channel", () => {
  it("parses items from a valid feed", async () => {
    stubRoutes([
      [/^https:\/\/example\.com\/feed\.xml/, () => ({
        body: `<?xml version="1.0"?><rss><channel><item><title>Post One</title><link>https://example.com/1</link><pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate><description>Hello</description></item></channel></rss>`,
      })],
    ]);
    const r = await rssFeed("https://example.com/feed.xml");
    expect(r.via).toBe("rss");
    expect(r.content).toContain("Post One");
    expect(r.content).toContain("https://example.com/1");
  });

  it("degrades to reader text when the response is not XML", async () => {
    stubRoutes([
      [/^https:\/\/direct-hit\//, () => ({ status: 200, body: "<html>not a feed</html>" })],
      [/r\.jina\.ai/, () => ({ status: 200, body: "", text: "Readable feed text" })],
    ]);
    const r = await rssFeed("https://direct-hit/feed.xml");
    expect(r.via).toBe("rss(jina)");
    expect(r.content).toContain("Readable feed text");
  });
});

describe("social channel", () => {
  it("says when a walled platform rendered thin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => "Title: x\n\nshort",
        headers: new Headers(),
      }))
    );
    const r = await socialPage("https://x.com/someone/status/1");
    expect(r.content).toContain("requires a login");
    expect(r.content).toMatch(/^<web_content/);
  });
});
