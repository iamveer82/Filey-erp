// {{secret:NAME}} substitution — see fillSecrets in secretStore.ts.
//
// The property that matters: a credential reaches the wire without ever being
// in the model's context, the approval prompt, or the returned result.
import { describe, it, expect, beforeEach } from "vitest";
import {
  fillSecrets,
  hasSecretRef,
  saveSecret,
  recallSecret,
  deleteSecret,
  listSecrets,
} from "../secretStore";

const store: Record<string, string> = {
  stripe_key: "sk_live_abc123",
  "acme.token": "tok-999",
  weird_name: "v",
};
const lookup = (n: string) => (n in store ? store[n] : null);

beforeEach(() => localStorage.clear());

describe("fillSecrets", () => {
  it("substitutes a reference and reports the name, not the value", () => {
    const r = fillSecrets("Bearer {{secret:stripe_key}}", lookup);
    expect(r.text).toBe("Bearer sk_live_abc123");
    expect(r.used).toEqual(["stripe_key"]);
    expect(r.missing).toEqual([]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(fillSecrets("{{ secret: stripe_key }}", lookup).text).toBe("sk_live_abc123");
  });

  it("handles dots and hyphens in names", () => {
    expect(fillSecrets("{{secret:acme.token}}", lookup).text).toBe("tok-999");
  });

  it("substitutes several references, deduping the report", () => {
    const r = fillSecrets("{{secret:stripe_key}} and {{secret:stripe_key}}", lookup);
    expect(r.text).toBe("sk_live_abc123 and sk_live_abc123");
    expect(r.used).toEqual(["stripe_key"]);
  });

  it("leaves an unknown reference intact and names it as missing", () => {
    // Substituting "null" would send a broken request that looks authenticated.
    const r = fillSecrets("Bearer {{secret:nope}}", lookup);
    expect(r.text).toBe("Bearer {{secret:nope}}");
    expect(r.missing).toEqual(["nope"]);
    expect(r.used).toEqual([]);
  });

  it("leaves text with no references alone", () => {
    const r = fillSecrets("https://api.example.com/v1/charges", lookup);
    expect(r.text).toBe("https://api.example.com/v1/charges");
    expect(r.used).toEqual([]);
  });

  it("is safe on empty input", () => {
    expect(fillSecrets("", lookup).text).toBe("");
  });

  it("does not treat a value that looks like a reference as one to expand again", () => {
    // A stored value containing a reference must not recurse.
    const r = fillSecrets("{{secret:selfref}}", (n) =>
      n === "selfref" ? "{{secret:stripe_key}}" : null
    );
    expect(r.text).toBe("{{secret:stripe_key}}");
  });
});

describe("hasSecretRef", () => {
  it("detects a reference, repeatedly", () => {
    // The underlying regex is global; a persisted lastIndex would make the
    // second call answer wrongly.
    expect(hasSecretRef("a {{secret:x}} b")).toBe(true);
    expect(hasSecretRef("a {{secret:x}} b")).toBe(true);
  });

  it("is false for plain text", () => {
    expect(hasSecretRef("no refs here")).toBe(false);
    expect(hasSecretRef("")).toBe(false);
  });
});

describe("the store itself", () => {
  it("saves, recalls, lists and deletes by name", () => {
    saveSecret("k1", "v1");
    saveSecret("k2", "v2");
    expect(recallSecret("k1")).toBe("v1");
    expect(listSecrets().sort()).toEqual(["k1", "k2"]);
    deleteSecret("k1");
    expect(recallSecret("k1")).toBeNull();
    expect(listSecrets()).toEqual(["k2"]);
  });

  it("defaults fillSecrets to the real store", () => {
    saveSecret("live_one", "zzz");
    expect(fillSecrets("x={{secret:live_one}}").text).toBe("x=zzz");
  });
});
