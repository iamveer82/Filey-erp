import { describe, it, expect } from "vitest";
import { numberToWords, amountInWords } from "./words";

describe("numberToWords", () => {
  it("handles the awkward cases", () => {
    expect(numberToWords(0)).toBe("Zero");
    expect(numberToWords(15)).toBe("Fifteen");
    expect(numberToWords(40)).toBe("Forty");
    expect(numberToWords(105)).toBe("One Hundred Five");
    expect(numberToWords(3320)).toBe("Three Thousand Three Hundred Twenty");
    expect(numberToWords(1000000)).toBe("One Million");
    expect(numberToWords(1000001)).toBe("One Million One");
  });
});

describe("amountInWords", () => {
  it("formats AED with fils", () => {
    expect(amountInWords(3320)).toBe("UAE Dirhams Three Thousand Three Hundred Twenty Only");
    expect(amountInWords(3320.1)).toBe(
      "UAE Dirhams Three Thousand Three Hundred Twenty and Fils Ten Only"
    );
  });
  it("falls back to the currency code for unknown currencies", () => {
    expect(amountInWords(5, "XYZ")).toBe("XYZ Five Only");
  });
});
