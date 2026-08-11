import { describe, it, expect, afterEach } from "vitest";
import { aed, setDisplayCurrency, getDisplayCurrency } from "../format";

// aed() formats an AED-denominated aggregate in whatever currency the topbar
// switcher is pointing at. Relabelling without dividing is the bug this
// guards: AED figures printed under a "$".
afterEach(() => setDisplayCurrency("AED", 1));

describe("display currency", () => {
  it("passes AED through untouched", () => {
    setDisplayCurrency("AED", 1);
    expect(aed(1000)).toContain("1,000");
    expect(getDisplayCurrency()).toBe("AED");
  });

  it("converts an AED aggregate into the display currency", () => {
    setDisplayCurrency("USD", 3.6725); // 1 USD = 3.6725 AED
    const out = aed(3672.5);
    expect(out).toContain("1,000");
    expect(out).not.toContain("3,672");
  });

  it("falls back to 1:1 rather than dividing by a missing rate", () => {
    setDisplayCurrency("XYZ", 0);
    expect(aed(500)).toContain("500");
  });

  it("treats a blank currency as AED", () => {
    setDisplayCurrency("", 1);
    expect(getDisplayCurrency()).toBe("AED");
  });
});
