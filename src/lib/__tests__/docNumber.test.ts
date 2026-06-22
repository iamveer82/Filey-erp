import { describe, it, expect } from "vitest";
import {
  nextDocNumber,
  nextFromPattern,
  renderPattern,
  hasCounter,
} from "../docNumber";

describe("nextDocNumber", () => {
  it("starts at 0001 when no prior documents exist", () => {
    expect(nextDocNumber({ prefix: "INV", existing: [], year: 2026 })).toBe(
      "INV-2026-0001"
    );
  });

  it("continues from the highest existing sequence", () => {
    expect(
      nextDocNumber({
        prefix: "INV",
        existing: ["INV-2026-0001", "INV-2026-0007", "INV-2026-0003"],
        year: 2026,
      })
    ).toBe("INV-2026-0008");
  });

  it("ignores documents from other years", () => {
    expect(
      nextDocNumber({
        prefix: "INV",
        existing: ["INV-2025-0099", "INV-2026-0002"],
        year: 2026,
      })
    ).toBe("INV-2026-0003");
  });

  it("ignores other prefixes", () => {
    expect(
      nextDocNumber({
        prefix: "QT",
        existing: ["INV-2026-0050", "QT-2026-0004"],
        year: 2026,
      })
    ).toBe("QT-2026-0005");
  });

  it("tolerates legacy random (unpadded) numbers and never reissues", () => {
    expect(
      nextDocNumber({
        prefix: "SO",
        existing: ["SO-2026-4821", "SO-2026-1200"],
        year: 2026,
      })
    ).toBe("SO-2026-4822");
  });

  it("respects custom pad width", () => {
    expect(
      nextDocNumber({ prefix: "QT", existing: [], year: 2026, pad: 6 })
    ).toBe("QT-2026-000001");
  });
});

describe("nextFromPattern (user-defined formats)", () => {
  it("starts at the value baked into the counter token", () => {
    expect(
      nextFromPattern({ pattern: "INV-DLS-{001}-26", existing: [], year: 2026 })
    ).toBe("INV-DLS-001-26");
  });

  it("continues from the highest existing counter", () => {
    expect(
      nextFromPattern({
        pattern: "INV-DLS-{001}-26",
        existing: ["INV-DLS-001-26", "INV-DLS-002-26"],
        year: 2026,
      })
    ).toBe("INV-DLS-003-26");
  });

  it("honours a non-1 starting value when nothing issued yet", () => {
    expect(
      nextFromPattern({ pattern: "INV-{050}", existing: [], year: 2026 })
    ).toBe("INV-050");
  });

  it("pad width comes from the token length", () => {
    expect(
      nextFromPattern({ pattern: "A-{00001}", existing: ["A-00041"], year: 2026 })
    ).toBe("A-00042");
  });

  it("resolves {YY} and {YYYY} year tokens", () => {
    expect(
      nextFromPattern({ pattern: "INV-{YYYY}-{0001}", existing: [], year: 2026 })
    ).toBe("INV-2026-0001");
    expect(renderPattern("INV-{YY}-{001}", 7, 2026)).toBe("INV-26-007");
  });

  it("ignores numbers that don't match the fixed parts", () => {
    expect(
      nextFromPattern({
        pattern: "INV-DLS-{001}-26",
        existing: ["INV-ABC-005-26", "QT-DLS-009-26", "INV-DLS-002-26"],
        year: 2026,
      })
    ).toBe("INV-DLS-003-26");
  });

  it("hasCounter detects the auto-increment token", () => {
    expect(hasCounter("INV-DLS-{001}-26")).toBe(true);
    expect(hasCounter("INV-DLS-001-26")).toBe(false);
  });
});
