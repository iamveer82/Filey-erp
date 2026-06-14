import { describe, it, expect } from "vitest";
import { nextDocNumber } from "../docNumber";

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
