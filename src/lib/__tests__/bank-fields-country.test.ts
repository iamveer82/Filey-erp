import { expect, it } from "vitest";
import { bankFieldError, bankFieldsFor } from "../bankFields";
import { EMPTY_BANK, hasBankInfo } from "../../components/BankDetails";

/* An IFSC is meaningless to Emirates NBD and an IBAN is meaningless to HDFC, so
 * asking a business for the wrong one is the confusion this exists to remove —
 * and the user's friend hit exactly that. Values are never deleted when the
 * country changes, only hidden, so nothing already saved can be lost. */

const keys = (country?: string | null) => bankFieldsFor(country).map((f) => f.key);

it("asks an Indian business for an IFSC and never an IBAN", () => {
  const fields = bankFieldsFor("IN");
  expect(fields.map((f) => f.key)).toContain("ifsc");
  expect(fields.map((f) => f.key)).not.toContain("iban");
  expect(fields.find((f) => f.key === "ifsc")?.label).toMatch(/IFSC/);
});

it("keeps the IBAN for the UAE and the Gulf", () => {
  for (const cc of ["AE", "GB", "SA", "QA", "KW", "BH", "OM", "DE", "FR"]) {
    expect(keys(cc)).toContain("iban");
    expect(keys(cc)).not.toContain("ifsc");
  }
});

it("uses each country's own sort code instead of an IBAN", () => {
  expect(keys("US").join()).toMatch(/routing_code/);
  expect(keys("US")).not.toContain("iban");
  expect(bankFieldsFor("US").find((f) => f.key === "routing_code")?.label).toMatch(/ABA/);
  expect(bankFieldsFor("AU").find((f) => f.key === "routing_code")?.label).toMatch(/BSB/);
  expect(bankFieldsFor("CA").find((f) => f.key === "routing_code")?.label).toMatch(/Transit/);
});

it("falls back to a SWIFT code for countries with neither", () => {
  for (const cc of ["SG", "JP", "ZA"]) {
    expect(keys(cc)).toContain("swift");
    expect(keys(cc)).not.toContain("iban");
    expect(keys(cc)).not.toContain("ifsc");
  }
});

it("shows everything when the country is unknown, so nothing saved is hidden", () => {
  const all = keys(null);
  expect(all).toContain("iban");
  expect(all).toContain("ifsc");
  expect(all).toContain("routing_code");
  expect(all).toContain("swift");
  // The always-on fields are common to every country.
  for (const cc of ["IN", "AE", "US", "JP", null]) {
    expect(keys(cc)).toEqual(expect.arrayContaining(["bank_name", "account_number"]));
  }
});

it("catches a mistyped IFSC and IBAN before it reaches an invoice", () => {
  expect(bankFieldError("ifsc", "HDFC0001234", "IN")).toBe("");
  expect(bankFieldError("ifsc", "hdfc000123", "IN")).toMatch(/11 characters/);
  expect(bankFieldError("ifsc", "", "IN")).toBe(""); // optional
  expect(bankFieldError("iban", "AE070331234567890123456", "AE")).toBe("");
  expect(bankFieldError("iban", "12345", "AE")).toMatch(/country code/);
  expect(bankFieldError("routing_code", "abc", "US")).toMatch(/9 digits/);
});

it("never validates an identifier the country does not use", () => {
  // A UAE-shaped IBAN left over from a previous country must not block an
  // Indian business from saving.
  expect(bankFieldError("iban", "not-an-iban", "IN")).toBe("");
  expect(bankFieldError("ifsc", "nonsense", "AE")).toBe("");
});

it("keeps values the country no longer shows, and can print them again", () => {
  const saved = { ...EMPTY_BANK, iban: "AE070331234567890123456", ifsc: "HDFC0001234" };
  expect(hasBankInfo(saved)).toBe(true);
  // Hiding is presentation only — the record still holds both.
  expect(saved.iban).toBe("AE070331234567890123456");
  // …and an unknown country still prints both rather than silently dropping one.
  expect(keys(null)).toEqual(expect.arrayContaining(["iban", "ifsc"]));
});
