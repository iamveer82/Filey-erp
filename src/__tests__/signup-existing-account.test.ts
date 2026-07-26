import { describe, it, expect } from "vitest";
import { isExistingAccount, isProfileStub } from "../lib/auth";

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

describe("isProfileStub", () => {
  it("flags the row the signup trigger leaves behind", () => {
    expect(isProfileStub({ name: "User", company: "" })).toBe(true);
    expect(isProfileStub({ name: "", company: "" })).toBe(true);
    expect(isProfileStub({ name: "   ", company: "  " })).toBe(true);
  });

  it("leaves a filled-in profile alone", () => {
    expect(isProfileStub({ name: "Virendra", company: "" })).toBe(false);
    expect(isProfileStub({ name: "User", company: "Acme LLC" })).toBe(false);
    expect(isProfileStub({ name: "You", company: "" })).toBe(false);
  });

  it("does not send a signed-out user to setup", () => {
    expect(isProfileStub(null)).toBe(false);
  });
});
