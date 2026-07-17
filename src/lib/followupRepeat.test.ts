import { describe, expect, it } from "vitest";
import { nextFollowUpDate } from "./api";

describe("nextFollowUpDate", () => {
  it("advances daily", () => {
    expect(nextFollowUpDate("2026-07-17", "daily")).toBe("2026-07-18");
    expect(nextFollowUpDate("2026-12-31", "daily")).toBe("2027-01-01");
  });
  it("advances weekly", () => {
    expect(nextFollowUpDate("2026-07-17", "weekly")).toBe("2026-07-24");
    expect(nextFollowUpDate("2026-02-26", "weekly")).toBe("2026-03-05");
  });
  it("advances monthly with month-length clamp", () => {
    expect(nextFollowUpDate("2026-07-17", "monthly")).toBe("2026-08-17");
    expect(nextFollowUpDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextFollowUpDate("2028-01-31", "monthly")).toBe("2028-02-29"); // leap
    expect(nextFollowUpDate("2026-12-15", "monthly")).toBe("2027-01-15");
  });
});
