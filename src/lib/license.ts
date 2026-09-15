// Desktop (Freedom) license: one-time purchase, verified OFFLINE forever.
//
// The dodo edge function signs a small JSON payload with a server-only
// ECDSA P-256 private key at activation time; this module verifies it with
// the embedded public key below on every launch — no network call. The
// cloud (Pro) tier is the opposite: a live org-plan check (subscription.ts).
//
// Dodo Payments sells the licence and its webhook records the entitlement, so
// buying is all the buyer does: claimPurchasedLicense() waits for the webhook
// to land and activates this device by itself.
//
// Licensing preserves paid benefits. Core local storage and local invoicing
// are free; hosted service quotas remain separately enforced.

import { invoke } from "@tauri-apps/api/core";
import { supabase, invokeFn } from "./supabase";
import { isLocalMode } from "./dataMode";
import { todayYmd } from "./format";
import { PUSH_TABLES } from "./syncTables";

/** Gates desktop features behind the four-tier plan model. Flipped on for the
 *  v2.3.0 licensing launch — the matching server-side cap (supabase/
 *  2026-07-18-free-invoice-cap.sql) is enabled separately via
 *  platform_config.licensing_enforced. */
export const ENFORCE_LICENSING = true;

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

/** Collections whose presence proves this device has been used offline. */
const LOCAL_DATA_KEYS = PUSH_TABLES.map(table => `localdb:${table}`);

/** True when this device already holds offline data. */
/** True when this device already holds offline records. Exported so the mode
 *  switch can warn before dropping someone into an empty local workspace. */
export async function hasLocalData(): Promise<boolean> {
  for (const k of LOCAL_DATA_KEYS) {
    const raw = await kvGet(k);
    if (raw && raw !== "[]" && raw !== "null") return true;
  }
  return false;
}

/** Core local ERP/CRM is free. Paid licenses still unlock paid entitlements. */
export async function canUseLocalMode(): Promise<boolean> {
  return true;
}

/** Activate this device against the signed-in account's license (one server
 *  call; offline forever after). Stores the signed token on success. */
export async function activateThisDevice(): Promise<LicenseState> {
  if (!supabase) throw new Error("Cloud isn't configured — sign in to activate.");
  const fingerprint = await deviceId();
  const device_name =
    (hasTauri ? "Desktop" : "Browser") +
    (typeof navigator !== "undefined" ? ` · ${navigator.platform}` : "");
  const { data, error } = (await invokeFn(supabase, "dodo", {
    body: { action: "license_activate", fingerprint, device_name },
  })) as { data: { token?: string; error?: string } | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  if (!data?.token) throw new Error("Activation failed — no token returned.");
  await kvSet(TOKEN_KEY, data.token as string);
  return verifyStoredLicense();
}

/** Redeem a promo voucher (one-time, online). The server caps total redemptions
 *  per code, grants this account a desktop license, then we activate THIS device
 *  through the normal path — offline forever after. Requires a cloud sign-in. */
export async function redeemVoucher(code: string): Promise<LicenseState> {
  if (!supabase) throw new Error("Cloud isn't configured — sign in to redeem a voucher.");
  const { data, error } = await supabase.rpc("redeem_voucher", { p_code: code.trim() });
  if (error) throw new Error(error.message);
  const res = (data ?? {}) as { ok?: boolean; reason?: string };
  if (!res.ok) {
    const msg: Record<string, string> = {
      not_signed_in: "Sign in first, then redeem your voucher.",
      invalid_code: "That voucher code isn't valid.",
      exhausted: "This voucher is fully claimed — all free seats are taken.",
      expired: "This coupon has expired — contact us for a fresh one.",
    };
    throw new Error(msg[res.reason ?? ""] ?? "Couldn't redeem this voucher.");
  }
  return activateThisDevice();
}

/** Free a device slot — any of the account's devices, by fingerprint. Used
 *  from a NEW device when both slots are taken ("log out the old laptop").
 *  The freed machine keeps working offline until it next re-activates. */
export async function deactivateDevice(fingerprint: string): Promise<void> {
  if (!supabase) throw new Error("Cloud isn't configured.");
  const { data, error } = (await invokeFn(supabase, "dodo", {
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

/** Buy the one-time Freedom licence (Dodo Payments hosted checkout — Dodo is
 *  the merchant of record, so it handles tax and invoicing).
 *
 *  On desktop the checkout opens in the system browser: sending the Tauri
 *  webview to Dodo would navigate the app itself away, and its return URL
 *  lands on the website, not back inside the app. The caller polls with
 *  claimPurchasedLicense() while the buyer pays in that browser window. */
export async function startFreedomCheckout(): Promise<"redirected" | "browser"> {
  if (!supabase) throw new Error("Cloud isn't configured.");
  const { data, error } = (await invokeFn(supabase, "dodo", {
    body: { action: "checkout" },
  })) as { data: { url?: string; error?: string } | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  if (!data?.url) throw new Error("Checkout failed — no URL returned.");
  if (hasTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(data.url);
    return "browser";
  }
  window.location.href = data.url;
  return "redirected";
}

/** Has the Dodo webhook recorded this account's purchase yet? */
export async function licensePurchased(): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = (await invokeFn(supabase, "dodo", {
    body: { action: "license_status" },
  })) as { data: { licensed?: boolean } | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  return !!data?.licensed;
}

/** Turn a completed payment into a working Freedom install, with no code to
 *  paste and no button to find. The buyer comes back from Dodo's checkout and
 *  this waits for the webhook — which usually lands first, but a card that
 *  needs a bank prompt can take a few seconds — then activates this device.
 *
 *  Returns null when the payment never showed up, so the caller can tell the
 *  buyer to reopen the page rather than silently leaving them on Free. */
export async function claimPurchasedLicense(
  attempts = 10,
  delayMs = 3000
): Promise<LicenseState | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await licensePurchased()) return activateThisDevice();
    if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

/* ---------------- tiers: free < lite (one-time) < pro (cloud) ---------------- */

export type Tier = "free" | "lite" | "pro";

/** Free tier caps. Volume + branding only — never compliance/correctness.
 *  Cloud is included on Free; the paid tier is about volume and owning it
 *  outright, not about where the data lives. Mirror any change in
 *  supabase/2026-07-29-free-invoice-cap-5.sql or the server cap disagrees. */
export const FREE_LIMITS = { invoicesPerMonth: 5 };

/** Desktop (Lite) license device slots. */
export const LITE_DEVICE_LIMIT = 2;

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
  if (!ENFORCE_LICENSING || isLocalMode()) return;
  if ((await entitlement()) !== "free") return;
  const used = await countThisMonth();
  if (used >= FREE_LIMITS.invoicesPerMonth)
    throw new Error(
      `Free plan limit reached (${FREE_LIMITS.invoicesPerMonth} invoices this month). ` +
        `Upgrade to Filey Freedom (one-time) or Pro in Settings → Billing.`
    );
}

/* ---------------- email daily cap (per tier) ---------------- */

/** Emails a user may send per day, by tier. Free is also enforced server-side
 *  in the send-email edge function (mirror these numbers there). Paid tiers are
 *  uncapped here — the edge function's PAID_DAILY_CEILING is the only guard
 *  they get, which is the point: a paid licence bought its way out of the cap. */
export const EMAIL_DAILY_LIMIT: Record<Tier, number> = {
  free: 10,
  lite: Infinity,
  pro: Infinity,
};

const EMAIL_COUNT_KEY = "filey:email_count";
const localDay = () => todayYmd();

async function emailCountToday(): Promise<number> {
  const raw = await kvGet(EMAIL_COUNT_KEY);
  if (!raw) return 0;
  try {
    const { date, n } = JSON.parse(raw) as { date: string; n: number };
    return date === localDay() ? n : 0; // stale day → counter resets
  } catch {
    return 0;
  }
}

/** Throws when today's sends have hit the current tier's daily email cap.
 *  No-op for unlimited (pro) tiers or while licensing is unenforced.
 *  ponytail: local per-device counter — honest-enough for lite (own SMTP);
 *  the cloud/free path is additionally capped server-side where it matters. */
export async function checkEmailDailyCap(): Promise<void> {
  if (!ENFORCE_LICENSING) return;
  const limit = EMAIL_DAILY_LIMIT[await entitlement()];
  if (!Number.isFinite(limit)) return;
  if ((await emailCountToday()) >= limit)
    throw new Error(
      `Daily email limit reached (${limit} today). ` +
        `Upgrade in Settings → Billing to send more.`
    );
}

/** Record one successful send against today's local counter. */
export async function bumpEmailCount(): Promise<void> {
  if (!ENFORCE_LICENSING) return;
  const n = (await emailCountToday()) + 1;
  await kvSet(EMAIL_COUNT_KEY, JSON.stringify({ date: localDay(), n }));
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
