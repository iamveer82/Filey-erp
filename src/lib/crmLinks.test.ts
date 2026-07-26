import { describe, expect, it } from "vitest";
import { matchCustomerId } from "./api";

const customers = [
  { id: 1, name: "Mahmoud Kassem", company: "Rennox International" },
  { id: 2, name: "BAPCO Fuel Trading", company: "BAPCO Fuel Trading L.L.C" },
  { id: 3, name: "Ali Hassan", company: "Globestar Energy" },
];

describe("matchCustomerId", () => {
  it("matches on the company name", () => {
    expect(matchCustomerId("Rennox International", customers)).toBe(1);
  });

  it("matches on the contact name", () => {
    expect(matchCustomerId("Ali Hassan", customers)).toBe(3);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(matchCustomerId("  bapco fuel trading l.l.c ", customers)).toBe(2);
  });

  it("returns null when nothing matches", () => {
    expect(matchCustomerId("Unknown Co", customers)).toBeNull();
  });

  it("returns null for empty or missing names", () => {
    expect(matchCustomerId("", customers)).toBeNull();
    expect(matchCustomerId(null, customers)).toBeNull();
    expect(matchCustomerId(undefined, customers)).toBeNull();
  });

  it("refuses to guess when two customers share the name", () => {
    const dupes = [
      { id: 1, name: "Acme", company: "Acme Trading" },
      { id: 2, name: "Someone", company: "Acme Trading" },
    ];
    expect(matchCustomerId("Acme Trading", dupes)).toBeNull();
  });

  it("does not match a blank company against a blank display name", () => {
    const blanks = [{ id: 1, name: "Solo Trader", company: "" }];
    expect(matchCustomerId("   ", blanks)).toBeNull();
  });

  it("matches a customer that has no company via its name", () => {
    const noCompany = [{ id: 7, name: "Solo Trader", company: undefined }];
    expect(matchCustomerId("Solo Trader", noCompany)).toBe(7);
  });
});
