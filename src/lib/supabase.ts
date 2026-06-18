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

// Loud, early signal in production builds that shipped without config — otherwise
// every user silently lands on the SetupNotice screen with no clue why.
if (import.meta.env.PROD && !isConfigured) {
  console.error(
    "[Filey] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in this build — " +
      "set them in your host environment and rebuild, or users will see the setup screen."
  );
}
