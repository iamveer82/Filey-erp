import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { isLocalMode } from "./dataMode";
import { localClient } from "./localdb";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const cloudConfigured =
  !!url &&
  !!anonKey &&
  !url.includes("your-project") &&
  !anonKey.includes("your-anon-key");

// Local mode is always "configured" — the offline data layer is the storage.
// Read once at load; switching mode requires a reload (the setup screen does it).
export const isConfigured = isLocalMode() || cloudConfigured;

export const supabase: SupabaseClient | null = cloudConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;

/** Returns the active client (local shim or cloud), or throws a clear error. */
export function sb(): SupabaseClient {
  if (isLocalMode()) return localClient as unknown as SupabaseClient;
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY " +
        "(in .env locally, or your host's environment variables in production)."
    );
  }
  return supabase;
}

// Edge functions on a free-tier project cold-start: after idle the runtime
// evicts the code blob, and the first hit misses (404 NOT_FOUND_FUNCTION_BLOB
// or a 5xx boot error) even though the function is deployed. Retry the
// transient ones — real function errors (business 4xx, or a 200 body with
// {error}) are not retried. Route every functions.invoke through this.
function transientStatus(error: unknown): boolean {
  if (!error) return false;
  const e = error as { context?: { status?: number }; message?: string };
  const status = e.context?.status;
  // No status = network/fetch failure; these platform codes = cold-start.
  if (status === undefined) return /fetch|network|timeout/i.test(e.message ?? "");
  return [404, 408, 500, 502, 503, 504].includes(status);
}

export async function invokeFn(
  client: SupabaseClient,
  name: string,
  options?: { body?: unknown },
  retries = 2
): Promise<{ data: unknown; error: unknown }> {
  let last: { data: unknown; error: unknown } = { data: null, error: null };
  for (let attempt = 0; attempt <= retries; attempt++) {
    // deno-lint-ignore no-explicit-any
    last = await client.functions.invoke(name, options as any);
    if (!last.error || attempt === retries || !transientStatus(last.error))
      return last;
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  return last;
}

// Loud, early signal in production builds that shipped without config — otherwise
// every user silently lands on the SetupNotice screen with no clue why.
if (import.meta.env.PROD && !isConfigured) {
  console.error(
    "[Filey] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in this build — " +
      "set them in your host environment and rebuild, or users will see the setup screen."
  );
}
