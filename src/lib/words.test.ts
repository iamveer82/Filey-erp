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
  it("spells amounts beyond a trillion instead of truncating them", () => {
    expect(numberToWords(1_000_000_000_000)).toBe("One Trillion");
    expect(numberToWords(2_500_000_000_001)).toBe(
      "Two Trillion Five Hundred Billion One"
    );
  });
});

describe("amountInWords", () => {
  it("formats AED with fils", () => {
    expect(amountInWords(3320)).toBe("UAE Dirhams Three Thousand Three Hundred Twenty Only");
    expect(amountInWords(3320.1)).toBe(
      "UAE Dirhams Three Thousand Three Hundred Twenty and Fils Ten Only"
    );
  });
  it("carries sub-unit rounding into the whole amount", () => {
    expect(amountInWords(9.996)).toBe("UAE Dirhams Ten Only");
    expect(amountInWords(1.995)).toBe("UAE Dirhams Two Only");
    expect(amountInWords(0.5)).toBe("UAE Dirhams Zero and Fils Fifty Only");
  });
  it("uses each picker currency's own minor unit and precision", () => {
    expect(amountInWords(12.5, "QAR")).toBe("Qatari Riyals Twelve and Dirhams Fifty Only");
    expect(amountInWords(1.25, "KWD")).toBe("Kuwaiti Dinars One and Fils Two Hundred Fifty Only");
    expect(amountInWords(0.005, "OMR")).toBe("Omani Rials Zero and Baisa Five Only");
    expect(amountInWords(1234.4, "JPY")).toBe("Japanese Yen One Thousand Two Hundred Thirty Four Only");
    expect(amountInWords(99.99, "CHF")).toBe("Swiss Francs Ninety Nine and Rappen Ninety Nine Only");
  });
  it("falls back to the currency code for unknown currencies without dropping the fraction", () => {
    expect(amountInWords(5, "XYZ")).toBe("XYZ Five Only");
    expect(amountInWords(5.5, "XYZ")).toBe("XYZ Five and 50/100 Only");
  });
});
