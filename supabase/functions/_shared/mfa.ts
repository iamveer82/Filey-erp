/** Call only with the user returned by auth.getUser for this exact JWT.
 *  Supabase Auth verifies the signature/session and eagerly loads factors.
 *  Never use getSession(), client metadata or an unverified decoded token as
 *  the authentication boundary. This adds no additional network request. */
export function mfaAllowed(
  user: { id: string; factors?: Array<{ status: string }> },
  verifiedJwt: string,
): boolean {
  try {
    const parts = verifiedJwt.split(".");
    if (parts.length !== 3) return false;
    const claims = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (claims.sub !== user.id || claims.role !== "authenticated") return false;
    if (user.factors !== undefined && !Array.isArray(user.factors)) return false;
    return claims.aal === "aal2" || !(user.factors ?? []).some(factor => factor.status === "verified");
  } catch {
    return false;
  }
}

export const MFA_REQUIRED = { error: "Complete two-step verification in Filey to continue.", code: "mfa_required" };
