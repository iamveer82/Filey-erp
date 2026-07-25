import { beforeEach, describe, expect, it } from "vitest";
import { addMemory, clearMemories, searchMemories } from "./aiMemory";

describe("searchMemories", () => {
  beforeEach(() => {
    clearMemories();
  });

  it("returns the most recent memories when no query is given", () => {
    addMemory("oldest");
    addMemory("middle");
    addMemory("newest");
    expect(searchMemories().map((m) => m.text)).toEqual(["newest", "middle", "oldest"]);
  });

  it("finds a memory by a term it contains, not just an exact substring", () => {
    addMemory("Bapco gets 5% off list price", "customer");
    addMemory("Office rent is due on the 1st");
    const hits = searchMemories("what discount does Bapco get?");
    expect(hits[0].text).toBe("Bapco gets 5% off list price");
  });

  it("matches across word forms (pricing ~ price)", () => {
    addMemory("Our pricing excludes VAT");
    expect(searchMemories("price").map((m) => m.text)).toEqual(["Our pricing excludes VAT"]);
  });

  it("ranks an exact phrase above a loose term overlap", () => {
    addMemory("VAT is 5% on standard-rated supplies");
    addMemory("VAT returns are filed quarterly");
    const hits = searchMemories("VAT is 5%");
    expect(hits[0].text).toBe("VAT is 5% on standard-rated supplies");
  });

  it("weights a tag hit above a body hit", () => {
    addMemory("Send statements every Monday", "supplier");
    addMemory("A supplier called once about statements", "note");
    expect(searchMemories("supplier")[0].text).toBe("Send statements every Monday");
  });

  it("drops memories with nothing in common with the query", () => {
    addMemory("Office rent is due on the 1st");
    expect(searchMemories("stock levels")).toEqual([]);
  });

  it("ignores stopwords so a wordy question still matches", () => {
    addMemory("Always CC accounts@acme.com on invoices", "preference");
    const hits = searchMemories("who should we CC on the invoices?");
    expect(hits).toHaveLength(1);
  });

  it("respects the limit", () => {
    for (let i = 0; i < 10; i++) addMemory(`invoice note ${i}`);
    expect(searchMemories("invoice", 3)).toHaveLength(3);
  });
});
