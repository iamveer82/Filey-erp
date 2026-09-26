// CSV exports carry text the user typed into the app — customer names, product
// descriptions, notes. Excel and Google Sheets execute a cell that opens with
// = + - @ or a control character, so those have to leave as literal text. The
// catch is that this is an accounting export: -500 must stay a number.
import { describe, it, expect } from "vitest";
import { toCsv, parseCsvObjects } from "../csv";

const cell = (v: unknown): string => toCsv([{ a: v }]).split("\n")[1];

describe("toCsv formula injection", () => {
  it("neutralises a formula hidden in a customer name", () => {
    expect(cell('=HYPERLINK("http://evil","Click")')).toBe(
      `"'=HYPERLINK(""http://evil"",""Click"")"`
    );
    expect(cell("=1+1")).toBe("'=1+1");
    expect(cell("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
    expect(cell("+1234567890")).toBe("'+1234567890"); // phone-shaped, still a formula to Excel
  });

  it("leaves plain numbers alone, negatives included", () => {
    expect(cell(-500)).toBe("-500");
    expect(cell("-500")).toBe("-500");
    expect(cell(-1234.56)).toBe("-1234.56");
    expect(cell(0)).toBe("0");
  });

  it("escapes a formula that also needs quoting, in the right order", () => {
    // The apostrophe goes on first, then the whole thing is quoted.
    expect(cell("=a,b")).toBe(`"'=a,b"`);
  });

  it("still quotes ordinary cells that contain a comma or quote", () => {
    expect(cell("Smith, John")).toBe('"Smith, John"');
    expect(cell('He said "hi"')).toBe('"He said ""hi"""');
    expect(cell("plain")).toBe("plain");
  });
});

describe("parseCsvObjects", () => {
  it("reads back a file this app exported, byte-order mark and all", () => {
    const csv = "﻿" + toCsv([{ name: "Acme", total: -500 }]);
    const { headers, rows } = parseCsvObjects(csv);
    expect(headers).toEqual(["name", "total"]);
    expect(rows[0]).toEqual({ name: "Acme", total: "-500" });
  });

  it("keeps embedded newlines inside a quoted field", () => {
    const { rows } = parseCsvObjects('note\n"line one\nline two"\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe("line one\nline two");
  });
});
