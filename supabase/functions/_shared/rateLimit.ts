// Filey ERP — Shared rate limiter for Supabase Edge Functions
//
// Uses audit_log table (already present in schema) as a counter.
// Each function defines its own limit + window. No extra tables needed.
//
// Usage:
//   import { rateLimit, json } from "../_shared/rateLimit.ts";
//   const allowed = await rateLimit(supa, userId, "stripe_checkout", 10, 3600);
//   if (!allowed) return json({ error: "Rate limit exceeded" }, 429);

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Check if a user is within their rate limit. Returns true if allowed, false if blocked. */
export async function rateLimit(
  supa: SupabaseClient,
  userId: string,
  action: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count } = await supa
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", action)
    .gte("created_at", since);
  return (count ?? 0) < limit;
}

/** Log an action to audit_log (for rate counting + audit trail).
 *  NOTE: audit_log has no `meta` column — the metadata rides along in
 *  `details` as JSON. This insert is what the count-based limiter counts, so
 *  a failure here must be LOUD: a silently failing counter means the limiter
 *  never trips at all. */
export async function logAction(
  supa: SupabaseClient,
  userId: string,
  action: string,
  meta?: Record<string, unknown>
): Promise<void> {
  const { error } = await supa.from("audit_log").insert({
    user_id: userId,
    actor: "edge",
    action,
    entity: action.slice(0, 120),
    details: meta && Object.keys(meta).length ? JSON.stringify(meta) : null,
  });
  if (error) console.error("logAction", action, error.message);
}

/** JSON response helper. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

/** CORS preflight response. */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Extract user ID from JWT (platform already verified the signature). */
export function extractUserId(req: Request): string {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  try {
    return JSON.parse(atob(jwt.split(".")[1])).sub ?? "";
  } catch {
    return "";
  }
}