// One door to the integration providers, and one decision: whose key pays.
//
// PLATFORM (default) — Filey's own Composio/Zernio keys, held as Supabase
// secrets and reached through the `integrations` edge function on the user's
// session. Nothing is configured by the customer and nothing is extractable
// from the app, because the key is never in the app. This is the path that can
// be charged for: the edge function resolves the caller's plan and applies a
// daily ceiling.
//
// OWN KEY — the customer supplies their own and calls the provider directly
// (Composio through the Rust encrypted store, Zernio from device storage).
// Kept for offline installs, self-hosters, and anyone who would rather not have
// their automation metered by us.

import { supabase, invokeFn } from "./supabase";

export type KeySource = "platform" | "own" | "none";

export class IntegrationError extends Error {}

/** Call the platform proxy. Throws IntegrationError with the server's own
 *  wording — quota messages in particular are written for the user to read. */
export async function platformCall<T>(
  provider: "composio" | "zernio",
  action: string,
  payload: Record<string, unknown> = {}
): Promise<T> {
  if (!supabase)
    throw new IntegrationError("Cloud isn't configured in this build.");
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session)
    throw new IntegrationError(
      "Sign in to use the built-in integrations, or add your own key on the Integrations page."
    );
  const { data, error } = await invokeFn(supabase, "integrations", {
    body: { provider, action, payload },
  });
  if (error) {
    // A non-2xx from the function arrives as a FunctionsHttpError whose real
    // message is in the response body — surface that, not "Edge Function
    // returned a non-2xx status code".
    const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
    let msg = error instanceof Error ? error.message : String(error);
    try {
      const body = (await ctx?.json?.()) as { error?: string } | undefined;
      if (body?.error) msg = body.error;
    } catch {
      /* keep the transport message */
    }
    throw new IntegrationError(msg);
  }
  const body = data as { error?: string } | null;
  if (body?.error) throw new IntegrationError(body.error);
  return data as T;
}

/** Whether the platform path is even available (cloud build + signed in). */
export async function platformAvailable(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}

/* ---------------- bring-your-own key, for cloud users ----------------
 *
 * The desktop keeps a customer's own key in Rust's encrypted store and calls
 * the provider directly. A browser has nowhere safe for a secret, so the key
 * goes to `integration_keys` instead, where `authenticated` may write it and
 * see that it exists but has no SELECT grant on the column itself — only the
 * service role behind the `integrations` function can read it back. Calls keep
 * going through that function; it just spends the customer's key instead of
 * ours, and skips the platform's daily ceiling because it isn't our bill. */

export type KeyProvider = "composio" | "zernio";

async function uid(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/** True when this signed-in user has stored their own key for `provider`.
 *  Reads the non-secret columns — the key itself is not selectable. */
export async function hasCloudKey(provider: KeyProvider): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("integration_keys")
    .select("provider")
    .eq("provider", provider)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

export async function saveCloudKey(
  provider: KeyProvider,
  apiKey: string
): Promise<void> {
  if (!supabase) throw new IntegrationError("Cloud isn't configured in this build.");
  const user_id = await uid();
  if (!user_id) throw new IntegrationError("Sign in to save your own key.");
  const { error } = await supabase
    .from("integration_keys")
    .upsert(
      { user_id, provider, api_key: apiKey.trim(), updated_at: new Date().toISOString() },
      { onConflict: "user_id,provider" }
    );
  if (error) throw new IntegrationError(error.message);
}

export async function clearCloudKey(provider: KeyProvider): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("integration_keys")
    .delete()
    .eq("provider", provider);
  if (error) throw new IntegrationError(error.message);
}
