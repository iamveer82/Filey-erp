// Desktop (Lite) license: one-time purchase, verified OFFLINE forever.
//
// The stripe edge function signs a small JSON payload with a server-only
// ECDSA P-256 private key at activation time; this module verifies it with
// the embedded public key below on every launch — no network call. The
// cloud (Pro) tier is the opposite: a live org-plan check (subscription.ts).
//
// Enforcement is OFF by default (ENFORCE_LICENSING) — the mechanism ships
// first, the paywall flips on at launch.

import { invoke } from "@tauri-apps/api/core";
import { supabase, invokeFn } from "./supabase";
import { isLocalMode } from "./dataMode";

/** Flip to true at launch to actually gate desktop features. */
export const ENFORCE_LICENSING = false;

/** ECDSA P-256 public key (SPKI, base64). Verify-only — useless for forging. */
const LICENSE_PUBLIC_KEY =
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAELy8OA4C9dxp92iDRhsc+Dum1Zs2uG6wXHavqaAs3acDKDc9PDrEJnceJphyuEuxDqMW3kHnaqvG1BllC7yVHcw==";

const DEVICE_KEY = "filey:device_id";
const TOKEN_KEY = "filey:license_token";

const hasTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function kvGet(key: string): Promise<string | null> {
  try {
    if (hasTauri) return (await invoke<string | null>("cache_get", { key })) ?? null;
  } catch {
    /* fall through to localStorage */
  }
  return localStorage.getItem(key);
}

async function kvSet(key: string, value: string): Promise<void> {
  try {
    if (hasTauri) {
      await invoke("cache_set", { key, value });
      return;
    }
  } catch {
    /* fall through to localStorage */
  }
  localStorage.setItem(key, value);
}

/** Stable per-install device id. Not hardware-derived — a persisted UUID in
 *  the app's SQLite store. ponytail: honest-enough binding for casual-sharing
 *  prevention (the plan's stated goal); swap for a hardware fingerprint via a
 *  Rust command if piracy ever becomes a real problem. */
export async function deviceId(): Promise<string> {
  let id = await kvGet(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    await kvSet(DEVICE_KEY, id);
  }
  return id;
}

export interface LicensePayload {
  email: string;
  product: string;
  issued: string;
  device_id: string;
  license_id: string;
}

export interface LicenseState {
  valid: boolean;
  payload?: LicensePayload;
  reason?: string;
}

const b64urlToBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

/** Verify the stored license token offline. Checks the ECDSA signature with
 *  the embedded public key, then that the token belongs to THIS device. */
export async function verifyStoredLicense(): Promise<LicenseState> {
  const token = await kvGet(TOKEN_KEY);
  if (!token) return { valid: false, reason: "not_activated" };
  const [body, sig] = token.split(".");
  if (!body || !sig) return { valid: false, reason: "malformed" };
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      b64urlToBytes(LICENSE_PUBLIC_KEY),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      b64urlToBytes(sig),
      b64urlToBytes(body)
    );
    if (!ok) return { valid: false, reason: "bad_signature" };
    const payload = JSON.parse(
      new TextDecoder().decode(b64urlToBytes(body))
    ) as LicensePayload;
    if (payload.product !== "filey-desktop")
      return { valid: false, reason: "wrong_product" };
    if (payload.device_id !== (await deviceId()))
      return { valid: false, reason: "wrong_device" };
    return { valid: true, payload };
  } catch (e) {
    return { valid: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Activate this device against the signed-in account's license (one server
 *  call; offline forever after). Stores the signed token on success. */
export async function activateThisDevice(): Promise<LicenseState> {
  if (!supabase) throw new Error("Cloud isn't configured — sign in to activate.");
  const fingerprint = await deviceId();
  const device_name =
    (hasTauri ? "Desktop" : "Browser") +
    (typeof navigator !== "undefined" ? ` · ${navigator.platform}` : "");
  const { data, error } = (await invokeFn(supabase, "stripe", {
    body: { action: "license_activate", fingerprint, device_name },
  })) as { data: { token?: string; error?: string } | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  if (!data?.token) throw new Error("Activation failed — no token returned.");
  await kvSet(TOKEN_KEY, data.token as string);
  return verifyStoredLicense();
}

/** Free a device slot — any of the account's devices, by fingerprint. Used
 *  from a NEW device when both slots are taken ("log out the old laptop").
 *  The freed machine keeps working offline until it next re-activates. */
export async function deactivateDevice(fingerprint: string): Promise<void> {
  if (!supabase) throw new Error("Cloud isn't configured.");
  const { data, error } = (await invokeFn(supabase, "stripe", {
    body: { action: "license_deactivate", fingerprint },
  })) as { data: { error?: string } | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  if (fingerprint === (await deviceId())) await kvSet(TOKEN_KEY, "");
}

/** Free this device's slot (e.g. before moving to a new machine). */
export async function deactivateThisDevice(): Promise<void> {
  await deactivateDevice(await deviceId());
}

/* ---------------- cloud (Pro) device registry: 5 per org ---------------- */

export const CLOUD_DEVICE_LIMIT = 5;

export interface OrgDevice {
  id: string;
  user_id: string;
  fingerprint: string;
  device_name?: string | null;
  last_seen: string;
  created_at: string;
}

export type RegisterResult =
  | { ok: true; existing?: boolean }
  | { ok: false; reason: "limit" | "unauthenticated" | "missing_fingerprint" | string };

/** Register this device against the org (called on cloud session start).
 *  Refused with reason "limit" when the org already has 5 other devices. */
export async function registerCloudDevice(): Promise<RegisterResult> {
  if (!supabase) return { ok: false, reason: "not_configured" };
  const name =
    (hasTauri ? "Desktop" : "Browser") +
    (typeof navigator !== "undefined" ? ` · ${navigator.platform}` : "");
  const { data, error } = await supabase.rpc("register_device", {
    p_fingerprint: await deviceId(),
    p_name: name,
  });
  if (error) return { ok: false, reason: error.message };
  return (data ?? { ok: false, reason: "no_response" }) as RegisterResult;
}

/** The org's registered devices (RLS-scoped to the member's org). */
export async function listOrgDevices(): Promise<OrgDevice[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("org_devices")
    .select("*")
    .order("last_seen", { ascending: false });
  return (data ?? []) as OrgDevice[];
}

/** Release an org device slot (own device, or any if org admin — RLS). */
export async function releaseOrgDevice(id: string): Promise<void> {
  if (!supabase) throw new Error("Cloud isn't configured.");
  const { error } = await supabase.from("org_devices").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Buy the one-time Lite license (Stripe Checkout; invoice emailed). */
export async function startLiteCheckout(): Promise<void> {
  if (!supabase) throw new Error("Cloud isn't configured.");
  const { data, error } = (await invokeFn(supabase, "stripe", {
    body: { action: "checkout_lite" },
  })) as { data: { url?: string; error?: string } | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  if (!data?.url) throw new Error("Checkout failed — no URL returned.");
  window.location.href = data.url;
}

/* ---------------- tiers: free < lite (one-time) < pro (cloud) ---------------- */

export type Tier = "free" | "lite" | "pro";

/** Free tier caps. Volume + branding only — never compliance/correctness. */
export const FREE_LIMITS = { invoicesPerMonth: 25 };

/** Pure tier resolution — pro needs a live plan (past_due = grace period),
 *  lite needs a valid offline license, everything else is free. */
export function resolveTier(
  licenseValid: boolean,
  plan?: string | null,
  planStatus?: string | null
): Tier {
  if (
    plan &&
    plan !== "free" &&
    (planStatus === "active" || planStatus === "trialing" || planStatus === "past_due")
  )
    return "pro";
  return licenseValid ? "lite" : "free";
}

let cachedTier: Tier | null = null;

/** Resolve (and cache) the current tier. Offline license check is local;
 *  the pro check reads the org's plan when in cloud mode. */
export async function entitlement(force = false): Promise<Tier> {
  if (cachedTier && !force) return cachedTier;
  const lic = await verifyStoredLicense();
  let plan: string | null = null;
  let status: string | null = null;
  if (!isLocalMode() && supabase) {
    try {
      const { data } = await supabase
        .from("organizations")
        .select("plan, plan_status")
        .limit(1)
        .maybeSingle();
      plan = (data?.plan as string) ?? null;
      status = (data?.plan_status as string) ?? null;
    } catch {
      /* offline / not signed in → fall through */
    }
  }
  cachedTier = resolveTier(lic.valid, plan, status);
  return cachedTier;
}

/** Last resolved tier, synchronously (for render paths). Defaults to "free"
 *  until entitlement() has run — callers gate on ENFORCE_LICENSING anyway. */
export function currentTier(): Tier {
  return cachedTier ?? "free";
}

/** Free-tier invoice cap: throws a friendly error when a NEW invoice would
 *  exceed this month's allowance. No-op unless licensing is enforced. */
export async function checkFreeInvoiceCap(
  countThisMonth: () => Promise<number>
): Promise<void> {
  if (!ENFORCE_LICENSING) return;
  if ((await entitlement()) !== "free") return;
  const used = await countThisMonth();
  if (used >= FREE_LIMITS.invoicesPerMonth)
    throw new Error(
      `Free plan limit reached (${FREE_LIMITS.invoicesPerMonth} invoices this month). ` +
        `Upgrade to Filey Lite (one-time) or Pro in Settings → Desktop License.`
    );
}

/** The account's license + device slots (RLS-scoped reads, for the panel). */
export async function licenseOverview() {
  if (!supabase) return null;
  const { data: lic } = await supabase
    .from("licenses")
    .select("id, product, status, created_at")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!lic) return null;
  const { data: devices } = await supabase
    .from("license_devices")
    .select("fingerprint, device_name, activated_at, deactivated_at")
    .eq("license_id", lic.id)
    .order("activated_at", { ascending: true });
  return { license: lic, devices: devices ?? [] };
}
