// The policy that guards every place a password is set. Signup used to accept
// "12345678" and "password", and the three screens that set passwords each
// enforced something different.
import { describe, it, expect } from "vitest";
import { checkPassword, strengthLabel, MIN_LENGTH, MAX_BYTES } from "./password";

const ok = (pw: string, email?: string) => checkPassword(pw, email).ok;

describe("password policy", () => {
  it("requires a real length", () => {
    expect(ok("")).toBe(false);
    expect(ok("Ab3$x")).toBe(false);
    expect(checkPassword("short").problem).toMatch(/at least 8/);
    expect("a".repeat(MIN_LENGTH).length).toBe(8);
  });

  it("rejects the passwords attackers try first", () => {
    for (const pw of ["password", "12345678", "qwertyui", "iloveyou", "letmein"])
      expect(ok(pw)).toBe(false);
    expect(checkPassword("password").problem).toMatch(/commonly used/i);
  });

  it("sees through the decoration that beats composition rules", () => {
    // Exactly what "must contain upper, lower and a digit" produces.
    expect(ok("P@ssw0rd")).toBe(false);
    expect(ok("Password1")).toBe(false);
    expect(ok("Passw0rd123")).toBe(false);
  });

  it("rejects straight runs that are long enough to pass a length check", () => {
    expect(ok("aaaaaaaa")).toBe(false);
    expect(ok("abcdefgh")).toBe(false);
    expect(ok("87654321")).toBe(false);
  });

  it("rejects a password built from the address it protects", () => {
    expect(ok("veerandsons", "veerandsons@gofiley.com")).toBe(false);
    expect(ok("myveerandsons99", "veerandsons@gofiley.com")).toBe(false);
    // A short local part is not distinctive enough to ban on.
    expect(ok("correcthorsebattery", "ab@x.com")).toBe(true);
  });

  it("accepts a long passphrase, which composition rules used to forbid", () => {
    expect(ok("correct horse battery staple")).toBe(true);
    expect(ok("thequickbrownfoxjumped")).toBe(true);
  });

  it("caps at the length bcrypt actually hashes", () => {
    expect(ok("a1B$" + "x".repeat(MAX_BYTES - 4))).toBe(true);
    const tooLong = "a1B$" + "x".repeat(MAX_BYTES);
    expect(ok(tooLong)).toBe(false);
    expect(checkPassword(tooLong).problem).toMatch(/72 characters or fewer/);
  });

  it("scores longer passwords higher, and never blocks on score", () => {
    const short = checkPassword("Tr4ffic!");
    const long = checkPassword("correct horse battery staple 9");
    expect(short.ok).toBe(true);
    expect(long.ok).toBe(true);
    expect(long.score).toBeGreaterThan(short.score);
    expect(strengthLabel(long.score)).toBe("Strong");
  });

  it("says what to fix rather than just refusing", () => {
    for (const pw of ["", "abc", "password", "aaaaaaaa"]) {
      const v = checkPassword(pw);
      expect(v.ok).toBe(false);
      expect(v.problem).toBeTruthy();
    }
  });
});
