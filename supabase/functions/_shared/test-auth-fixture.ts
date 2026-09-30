// Token-shaped test fixture only. Handler tests stub auth.getUser; this is
// intentionally not a signature that Supabase would accept in production.
export const fixtureJwt = (userId: string, aal = "aal1") =>
  `fixture.${btoa(JSON.stringify({ sub: userId, role: "authenticated", aal })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}.not-a-real-signature`;
