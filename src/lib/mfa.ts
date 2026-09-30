// Two-factor auth (TOTP) on top of Supabase's built-in MFA. Enrolment, the
// shared secret and the code check are all Supabase's — this module is the
// thin app-side wrapper plus the one decision Supabase leaves to the caller:
// whether a session that just signed in still owes us a code.
//
// Supabase hands back a REAL session after a correct password even when the
// account has a verified factor; that session simply sits at assurance level
// aal1 instead of aal2. So "is 2FA satisfied?" is a question the app has to
// ask (mfaRequired) and act on (Login signs the session out if the user backs
// out of the prompt).
//
// The UI gate complements the server's assurance checks; it is not an API
// authorization boundary. Cloud data and endpoints independently require aal2
// when the account has a verified factor.
//
// Device-local access remains separate: AuthProvider authenticates the device
// owner with localAuth.ts and does not run this cloud gate in local mode.
// Connecting that workspace to cloud sync does not waive cloud verification.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export interface MfaFactor {
  id: string;
  friendlyName: string;
}

/** What enrolment needs to show the user: the QR to scan and the same secret
 *  as text, for authenticator apps that can't use a camera. */
export interface MfaEnrolment {
  factorId: string;
  /** An SVG data: URI straight from Supabase — render it in an <img>. */
  qr: string;
  secret: string;
}

const client = (c?: SupabaseClient | null): SupabaseClient | null => c === undefined ? supabase : c;

/** The account's verified TOTP factor, or null when 2FA is off. */
export async function mfaFactor(c?: SupabaseClient | null): Promise<MfaFactor | null> {
  const supa = client(c);
  if (!supa) return null;
  const { data, error } = await supa.auth.mfa.listFactors();
  if (error) throw error;
  const f = (data?.totp ?? []).find((x: any) => x.status === "verified");
  return f ? { id: f.id, friendlyName: f.friendly_name || "Authenticator app" } : null;
}

/** Start enrolment: returns the QR + secret to show, and the factor id the
 *  confirmation step needs. Nothing is active until mfaConfirm succeeds. */
export async function mfaEnroll(c?: SupabaseClient | null): Promise<MfaEnrolment> {
  const supa = client(c);
  if (!supa) throw new Error("Two-factor authentication needs a cloud account.");

  // An abandoned enrolment leaves an unverified factor behind, and Supabase
  // refuses a second one with the same friendly name. Clear those first so
  // "cancel, then try again" works instead of erroring forever.
  const { data: existing } = await supa.auth.mfa.listFactors();
  for (const f of (existing?.totp ?? []) as any[]) {
    if (f.status !== "verified") await supa.auth.mfa.unenroll({ factorId: f.id });
  }

  const { data, error } = await supa.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Authenticator app",
  } as any);
  if (error) throw error;
  return {
    factorId: data.id,
    qr: (data as any).totp?.qr_code ?? "",
    secret: (data as any).totp?.secret ?? "",
  };
}

/** Finish enrolment (or satisfy a sign-in) by proving the user can produce a
 *  current code. Supabase wants a fresh challenge per attempt, so a wrong
 *  code is retried from here, not by reusing a stale challenge id. */
export async function mfaVerify(
  factorId: string,
  code: string,
  c?: SupabaseClient | null
): Promise<void> {
  const supa = client(c);
  if (!supa) throw new Error("Two-factor authentication needs a cloud account.");
  const { data, error } = await supa.auth.mfa.challenge({ factorId });
  if (error) throw error;
  const { error: vErr } = await supa.auth.mfa.verify({
    factorId,
    challengeId: data.id,
    code: code.trim(),
  });
  if (vErr) throw vErr;
}

/** Turn 2FA off. Supabase requires the caller to already be at aal2, so this
 *  can only be done from a session that passed a code — a stolen aal1 session
 *  cannot switch it off. */
export async function mfaDisable(
  factorId: string,
  c?: SupabaseClient | null
): Promise<void> {
  const supa = client(c);
  if (!supa) return;
  const { error } = await supa.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

/** Unknown cloud assurance is not evidence that two-factor verification is off.
 * Offline device authentication has its own boundary and needs no cloud call. */
export async function mfaRequired(c?: SupabaseClient | null): Promise<boolean> {
  const supa = client(c);
  if (!supa) return false;
  const { data, error } = await supa.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data || !["aal1", "aal2"].includes(data.currentLevel ?? "") || !["aal1", "aal2"].includes(data.nextLevel ?? ""))
    throw new Error("Could not verify sign-in security. Please try again.");
  return data.currentLevel === "aal1" && data.nextLevel === "aal2";
}
