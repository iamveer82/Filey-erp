import { describe, it, expect } from "vitest";
import { aed, num, vatBreakdown, fmtDate, UAE_VAT_RATE } from "../format";

describe("format helpers", () => {
  it("UAE VAT rate is 5%", () => {
    expect(UAE_VAT_RATE).toBe(0.05);
  });

  it("formats AED currency", () => {
    expect(aed(1000)).toContain("1,000");
    expect(aed(0)).toContain("0");
  });

  it("formats plain numbers with grouping", () => {
    expect(num(1234567)).toBe("1,234,567");
    expect(num(0)).toBe("0");
  });

  it("vatBreakdown applies 5% and rounds to 2dp", () => {
    expect(vatBreakdown(100)).toEqual({ net: 100, vat: 5, gross: 105 });
    const b = vatBreakdown(99.99);
    expect(b.vat).toBe(5);
    expect(b.gross).toBe(104.99);
  });

  it("fmtDate handles empty / invalid input", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate(undefined)).toBe("—");
    expect(fmtDate("not-a-date")).toBe("not-a-date");
  });
});
