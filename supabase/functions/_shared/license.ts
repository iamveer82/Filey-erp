// Filey — desktop licence issuing, shared by the payment edge functions.
//
// The licence itself is a small JSON payload signed with a server-only ECDSA
// P-256 key; the desktop app verifies it against an embedded public key and
// never has to phone home again. Payment providers come and go (Stripe first,
// Dodo Payments now), so the signing and device-slot rules live here rather
// than inside whichever provider happens to be selling today.
//
// Env:  LICENSE_SIGNING_KEY — PKCS8 private key, base64. Server-only.

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Device slots on a Freedom licence. Two machines, same owner. */
export const LICENSE_DEVICE_SLOTS = 2;

export interface LicenseResult {
  body: Record<string, unknown>;
  status: number;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** Sign a licence payload with the server-only ECDSA P-256 key. */
export async function signLicense(payload: Record<string, unknown>): Promise<string> {
  const keyB64 = Deno.env.get("LICENSE_SIGNING_KEY") ?? "";
  if (!keyB64) throw new Error("LICENSE_SIGNING_KEY not configured");
  const pkcs8 = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, body);
  return `${b64url(body)}.${b64url(new Uint8Array(sig))}`;
}

/** Does this account own a licence? The app polls this after checkout so the
 *  plan flips on its own instead of asking the buyer to paste a code. */
export async function licenseStatus(supa: SupabaseClient, userId: string): Promise<LicenseResult> {
  const { data } = await supa
    .from("licenses")
    .select("id, product, created_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return { body: { licensed: !!data, product: data?.product ?? null }, status: 200 };
}

export async function licenseActivate(
  supa: SupabaseClient,
  user: { id: string; email?: string | null },
  fingerprint: string,
  deviceName: string
): Promise<LicenseResult> {
  if (!fingerprint) return { body: { error: "Missing device fingerprint" }, status: 400 };
  const { data: lic } = await supa
    .from("licenses")
    .select("id, product, status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!lic) return { body: { error: "No active license on this account" }, status: 404 };

  const { data: devices } = await supa
    .from("license_devices")
    .select("id, fingerprint, deactivated_at")
    .eq("license_id", lic.id);
  const active = (devices ?? []).filter((d) => !d.deactivated_at);
  const mine = (devices ?? []).find((d) => d.fingerprint === fingerprint);

  // SECURITY: the count check below races concurrent activations (TOCTOU).
  // After claiming a slot, recount; if we overflowed, release our claim.
  const claimedOverLimit = async (rowId: unknown): Promise<boolean> => {
    const { data: act } = await supa
      .from("license_devices")
      .select("id")
      .eq("license_id", lic.id)
      .is("deactivated_at", null);
    if ((act ?? []).length <= LICENSE_DEVICE_SLOTS) return false;
    await supa
      .from("license_devices")
      .update({ deactivated_at: new Date().toISOString() })
      .eq("id", rowId);
    return true;
  };
  const slotsFull: LicenseResult = {
    body: { error: `All ${LICENSE_DEVICE_SLOTS} device slots are in use. Deactivate another device first.` },
    status: 409,
  };

  if (mine?.deactivated_at) {
    // Re-activating a freed slot — only if a slot is open.
    if (active.length >= LICENSE_DEVICE_SLOTS) return slotsFull;
    await supa
      .from("license_devices")
      .update({ deactivated_at: null, activated_at: new Date().toISOString(), device_name: deviceName || null })
      .eq("id", mine.id);
    if (await claimedOverLimit(mine.id)) return slotsFull;
  } else if (!mine) {
    if (active.length >= LICENSE_DEVICE_SLOTS) return slotsFull;
    const { data: ins, error } = await supa
      .from("license_devices")
      .insert({ license_id: lic.id, fingerprint, device_name: deviceName || null })
      .select("id")
      .single();
    if (error) return { body: { error: error.message }, status: 500 };
    if (await claimedOverLimit(ins.id)) return slotsFull;
  }

  const token = await signLicense({
    email: user.email ?? "",
    product: lic.product,
    issued: new Date().toISOString().slice(0, 10),
    device_id: fingerprint,
    license_id: lic.id,
  });
  return { body: { token }, status: 200 };
}

export async function licenseDeactivate(
  supa: SupabaseClient,
  userId: string,
  fingerprint: string
): Promise<LicenseResult> {
  if (!fingerprint) return { body: { error: "Missing device fingerprint" }, status: 400 };
  const { data: lic } = await supa
    .from("licenses")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!lic) return { body: { error: "No active license on this account" }, status: 404 };
  await supa
    .from("license_devices")
    .update({ deactivated_at: new Date().toISOString() })
    .eq("license_id", lic.id)
    .eq("fingerprint", fingerprint);
  return { body: { ok: true }, status: 200 };
}

/** Record a paid licence. Idempotent on the provider's payment id, because a
 *  webhook that is delivered twice must not hand out a second licence. */
export async function grantLicense(
  supa: SupabaseClient,
  userId: string,
  paymentId: string
): Promise<"granted" | "duplicate" | "already-licensed"> {
  const { data: existingPayment } = await supa
    .from("licenses")
    .select("id")
    .eq("dodo_payment_id", paymentId)
    .limit(1)
    .maybeSingle();
  if (existingPayment) return "duplicate";

  const { data: existing } = await supa
    .from("licenses")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (existing) return "already-licensed";

  const { error } = await supa.from("licenses").insert({
    user_id: userId,
    product: "filey-desktop",
    status: "active",
    dodo_payment_id: paymentId,
  });
  if (error) throw new Error(error.message);
  return "granted";
}
