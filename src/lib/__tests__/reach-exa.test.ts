import { expect, it } from "vitest";
import { parseExaHits } from "../reach";

// Web search without a Jina key goes to Exa's free hosted search (one server-sent event back).
const sse = (text: string, meta: Record<string, unknown> = {}) =>
  `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { _meta: meta, content: [{ type: "text", text }] } })}\n\n`;

it("reads JSON results and Title/URL text blocks", () => {
  const json = JSON.stringify({ results: [{ title: "Lube distributors UAE", url: "https://a.example/x", text: "Oils   and greases" }, { title: "no url" }] });
  expect(parseExaHits(sse(json))).toEqual([{ title: "Lube distributors UAE", url: "https://a.example/x", snippet: "Oils and greases" }]);
  const blocks = "Title: First\nURL: https://one.example\nPublished Date: 2026-10-01\nText: Alpha beta\n\nTitle: Second\nURL: https://two.example\nText: Gamma";
  expect(parseExaHits(sse(blocks))).toEqual([
    { title: "First", url: "https://one.example", snippet: "Alpha beta" },
    { title: "Second", url: "https://two.example", snippet: "Gamma" },
  ]);
});

it("says how to get unlimited search when the free allowance is used up", () => {
  expect(() => parseExaHits(sse("You've hit Exa's free MCP rate limit.", { "ai.exa/rateLimited": true }))).toThrow(/Jina API key/);
  expect(() => parseExaHits("<html>")).toThrow(/unreadable/);
});
