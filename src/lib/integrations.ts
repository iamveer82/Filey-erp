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
      "Sign in to use the built-in integrations, or add your own key in Settings → Integrations."
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
