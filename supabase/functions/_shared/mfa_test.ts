import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mfaAllowed } from "./mfa.ts";

const jwt = (claims: unknown) => `header.${btoa(JSON.stringify(claims)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}.verified-by-getUser`;
const claims = { sub: "USER", role: "authenticated", aal: "aal1" };

Deno.test("verified MFA factor requires the same authenticated token to be aal2", () => {
  const user = { id: "USER", factors: [{ status: "verified" }] };
  assertEquals(mfaAllowed(user, jwt(claims)), false);
  assertEquals(mfaAllowed(user, jwt({ ...claims, aal: "aal2" })), true);
  assertEquals(mfaAllowed(user, jwt({ ...claims, aal: undefined })), false);
});

Deno.test("no-factor and unverified enrollment accounts can continue normally", () => {
  for (const user of [{ id: "USER" }, { id: "USER", factors: [] }, { id: "USER", factors: [{ status: "unverified" }] }])
    assertEquals(mfaAllowed(user, jwt(claims)), true);
});

Deno.test("another subject, role, malformed claims or factor data never bypass MFA", () => {
  const user = { id: "USER", factors: [{ status: "verified" }] };
  for (const token of ["", "invalid", "header.bad-json.sig", jwt({ ...claims, aal: "aal2", sub: "OTHER" }), jwt({ ...claims, aal: "aal2", role: "service_role" })])
    assertEquals(mfaAllowed(user, token), false);
  assertEquals(mfaAllowed({ id: "USER", factors: null } as unknown as typeof user, jwt({ ...claims, aal: "aal2" })), false);
  // User-editable metadata is deliberately not consulted.
  const metadataSpoof = { ...user, user_metadata: { aal: "aal2", factors: [] } };
  assertEquals(mfaAllowed(metadataSpoof, jwt(claims)), false);
});
