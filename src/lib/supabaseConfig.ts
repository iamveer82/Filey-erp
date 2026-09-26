// Which Supabase project this build talks to, and whether cloud is usable at
// all. A leaf module on purpose: dataMode.ts needs this to resolve the mode a
// build actually uses (the hosted web app never shows the storage picker, so
// nothing writes filey_data_mode there), and it must be able to read it without
// importing supabase.ts — that would be a cycle, because supabase.ts asks
// dataMode.ts whether it is in local mode.
//
// Filey's hosted cloud is baked in so every packaged build is cloud-ready out of
// the box (accounts, team sharing, auto-sync all point here). Env vars still
// override for dev/self-hosting against another project. The publishable key is
// a client-side key by design; RLS guards the data.

export const DEFAULT_SUPABASE_URL = "https://voyrjqgaypiylwskkwpr.supabase.co";
export const DEFAULT_SUPABASE_ANON_KEY =
  "sb_publishable_seG6PypmkIEN9FYKY9Of6w_UGNTGAgv";

export const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_SUPABASE_URL;

export const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || DEFAULT_SUPABASE_ANON_KEY;

/** False only for a build that was never pointed at a project. */
export const cloudConfigured =
  !!supabaseUrl &&
  !!supabaseAnonKey &&
  !supabaseUrl.includes("your-project") &&
  !supabaseAnonKey.includes("your-anon-key");
