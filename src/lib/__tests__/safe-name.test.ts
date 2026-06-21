import { describe, it, expect } from "vitest";
import { safeName } from "../files";

describe("safeName — storage key sanitization", () => {
  it("removes path separators and traversal", () => {
    const out = safeName("../../etc/passwd");
    expect(out).not.toContain("/");
    expect(out).not.toContain("\\");
  });
  it("keeps a usable name + extension", () => {
    expect(safeName("INV-001.pdf")).toBe("INV-001.pdf");
  });
  it("collapses illegal chars to underscores (no traversal survives)", () => {
    expect(safeName("/// ")).toBe("____");
  });
  it("falls back to 'file' on empty input", () => {
    expect(safeName("")).toBe("file");
  });
});
