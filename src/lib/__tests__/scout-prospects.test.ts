import { describe, it, expect, vi, beforeEach } from "vitest";

/* Prospecting: search for companies, then read what each publishes on its own
 * site. The value is in what it REFUSES to return — a lead list full of
 * directory pages and sites with no phone number is worse than a short one. */

const { searchWeb, readUrl } = vi.hoisted(() => ({
  searchWeb: vi.fn(),
  readUrl: vi.fn(),
}));

vi.mock("../reach", () => ({
  searchWeb,
  readUrl,
  ReachError: class extends Error {},
}));

import { findProspects } from "../scout";

const page = (url: string, text: string) => ({
  url,
  title: url,
  text,
  truncated: false,
});

beforeEach(() => {
  searchWeb.mockReset();
  readUrl.mockReset();
});

describe("findProspects", () => {
  it("returns companies with the contact details their own site publishes", async () => {
    searchWeb.mockResolvedValue({
      hits: [{ title: "Acme Lubricants", url: "https://acme-lub.ae/", snippet: "Distributor" }],
      text: "",
    });
    readUrl.mockResolvedValue(
      page(
        "https://acme-lub.ae/",
        "Acme Lubricants LLC. Call +971 4 555 1234 or email sales@acme-lub.ae. TRN 100123456700003",
      )
    );

    const { prospects } = await findProspects("lubricant distributors in Sharjah");
    expect(prospects).toHaveLength(1);
    expect(prospects[0].phones[0]).toContain("555");
    expect(prospects[0].emails).toContain("sales@acme-lub.ae");
    expect(prospects[0].site).toBe("https://acme-lub.ae/");
  });

  it("skips directories and social platforms rather than listing them as companies", async () => {
    searchWeb.mockResolvedValue({
      hits: [
        { title: "Lubricants — Yellow Pages", url: "https://yellowpages.ae/x", snippet: "" },
        { title: "Acme on LinkedIn", url: "https://linkedin.com/company/acme", snippet: "" },
        { title: "Acme", url: "https://acme-lub.ae/", snippet: "" },
      ],
      text: "",
    });
    readUrl.mockResolvedValue(page("https://acme-lub.ae/", "Call +971 4 555 1234"));

    const { prospects, skipped } = await findProspects("lubricants");
    expect(prospects.map((p) => p.site)).toEqual(["https://acme-lub.ae/"]);
    expect(skipped.join(" ")).toMatch(/yellowpages|linkedin/);
    // The directory pages were never fetched at all.
    expect(readUrl).toHaveBeenCalledTimes(1);
  });

  it("drops a company with no way to contact it", async () => {
    searchWeb.mockResolvedValue({
      hits: [{ title: "Ghost Co", url: "https://ghost.example/", snippet: "" }],
      text: "",
    });
    readUrl.mockResolvedValue(page("https://ghost.example/", "We sell things. No contact here."));

    const { prospects, skipped } = await findProspects("things");
    expect(prospects).toHaveLength(0);
    expect(skipped[0]).toMatch(/no contact details/i);
  });

  it("counts one company once, however many pages it ranks for", async () => {
    searchWeb.mockResolvedValue({
      hits: [
        { title: "Acme", url: "https://acme-lub.ae/", snippet: "" },
        { title: "Acme contact", url: "https://acme-lub.ae/contact", snippet: "" },
      ],
      text: "",
    });
    readUrl.mockResolvedValue(page("https://acme-lub.ae/", "+971 4 555 1234"));

    const { prospects } = await findProspects("lubricants");
    expect(prospects).toHaveLength(1);
  });

  it("keeps one failed site from killing the whole search", async () => {
    searchWeb.mockResolvedValue({
      hits: [
        { title: "Down", url: "https://down.example/", snippet: "" },
        { title: "Acme", url: "https://acme-lub.ae/", snippet: "" },
      ],
      text: "",
    });
    readUrl
      .mockRejectedValueOnce(new Error("502 from reader"))
      .mockResolvedValueOnce(page("https://acme-lub.ae/", "+971 4 555 1234"));

    const { prospects, skipped } = await findProspects("lubricants");
    expect(prospects).toHaveLength(1);
    expect(skipped[0]).toMatch(/502/);
  });
});
