import { describe, it, expect } from "vitest";
import { isExistingAccount } from "../lib/auth";

describe("isExistingAccount", () => {
  it("flags the decoy user Supabase returns for an already-registered email", () => {
    expect(isExistingAccount({ identities: [] })).toBe(true);
  });

  it("passes a genuinely new signup through", () => {
    expect(isExistingAccount({ identities: [{ provider: "email" }] })).toBe(false);
  });

  it("does not flag a missing or absent identities field", () => {
    expect(isExistingAccount(null)).toBe(false);
    expect(isExistingAccount({})).toBe(false);
  });
});
