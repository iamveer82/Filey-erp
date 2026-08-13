import { describe, it, expect } from "vitest";
import { presetTemplate } from "../docPresets";

describe("presetTemplate", () => {
  it("prefers the section's own preset", () => {
    expect(presetTemplate({ invoice: "corporate" }, "invoice", "modern", "minimal")).toBe(
      "corporate"
    );
  });

  it("falls back to the company default when it fits the document type", () => {
    expect(presetTemplate({}, "quote", "modern", "minimal")).toBe("modern");
  });

  it("ignores a company default the document type has no template for", () => {
    // "tech" is invoice/quote only — a receipt must not inherit it.
    expect(presetTemplate({}, "receipt", "tech", "receipt")).toBe("receipt");
  });

  it("uses the caller's fallback when nothing is set", () => {
    expect(presetTemplate({}, "po", undefined, "minimal")).toBe("minimal");
  });
});
