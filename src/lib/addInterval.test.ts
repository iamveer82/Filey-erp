import { describe, expect, it } from "vitest";
import { addInterval } from "./api";

describe("addInterval", () => {
  it("advances weekly", () => {
    expect(addInterval("2026-07-17", "weekly")).toBe("2026-07-24");
    expect(addInterval("2026-12-29", "weekly")).toBe("2027-01-05");
  });
  it("advances yearly with leap-day clamp", () => {
    expect(addInterval("2026-07-17", "yearly")).toBe("2027-07-17");
    expect(addInterval("2028-02-29", "yearly")).toBe("2029-02-28"); // leap → non-leap
  });
  it("advances monthly with month-length clamp", () => {
    expect(addInterval("2026-07-17", "monthly")).toBe("2026-08-17");
    expect(addInterval("2026-01-31", "monthly")).toBe("2026-02-28"); // no Mar-3 overflow
    expect(addInterval("2028-01-31", "monthly")).toBe("2028-02-29"); // leap
    expect(addInterval("2026-12-31", "monthly")).toBe("2027-01-31");
  });
});
