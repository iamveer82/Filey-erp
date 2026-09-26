import { setCacheOrg } from "./api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addMemory, clearMemories, searchMemories, listMemories, memoryDigest } from "./aiMemory";

describe("searchMemories", () => {
  beforeEach(() => {
    localStorage.setItem("filey_data_mode", "local"); setCacheOrg("test-org", "test-user");
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

  it("replaces a corrected fact without losing its identity", () => {
    const old = addMemory("Bapco gets 5% discount", "customer");
    const corrected = addMemory("Bapco gets 8% discount", "customer", old.id);
    expect(corrected.id).toBe(old.id);
    expect(listMemories().map((m) => m.text)).toEqual(["Bapco gets 8% discount"]);
    expect(() => addMemory("new fact", undefined, "missing")).toThrow(/no longer exists/);
  });

  it("refreshes duplicate facts to the front and recalls Arabic terms", () => {
    addMemory("Bapco gets 5% discount");
    addMemory("unrelated");
    addMemory("Bapco gets 5% discount");
    expect(listMemories()[0].text).toContain("Bapco");
    addMemory("يرجى إرسال الفواتير كل أسبوع");
    expect(searchMemories("الفواتير أسبوع")).toHaveLength(1);
  });

  it("surfaces older relevant facts ahead of recent unrelated facts", () => {
    addMemory("Bapco gets 5% discount");
    for (let i = 0; i < 15; i++) addMemory(`unrelated note ${i}`);
    expect(memoryDigest(3, "Bapco discount")).toContain("Bapco gets 5%");
  });

  it("never reports a successful save when storage refuses it", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    try { expect(() => addMemory("a fact")).toThrow(/could not be saved/); }
    finally { spy.mockRestore(); }
  });
});
