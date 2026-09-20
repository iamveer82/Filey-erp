import { describe, it, expect, vi } from "vitest";
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
  it("treats date-only documents as local calendar dates and preserves timestamp instants", () => {
    const format = vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (this: Date) {
      return `${this.getFullYear()}-${this.getMonth()+1}-${this.getDate()} ${this.getHours()}`;
    });
    try {
      expect(fmtDate("2026-09-01")).toBe("2026-9-1 12");
      const stamp = "2026-09-01T00:00:00Z";
      expect(fmtDate(stamp)).toBe(new Date(stamp).toLocaleDateString());
    } finally { format.mockRestore(); }
  });
});
