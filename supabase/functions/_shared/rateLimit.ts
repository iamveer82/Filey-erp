// Filey ERP — Shared rate limiter for Supabase Edge Functions
//
// Atomically reserves an attempt in a service-only database counter.
// Each function defines its own fixed window starting at the first attempt.
//
// Usage:
//   import { rateLimit, json } from "../_shared/rateLimit.ts";
//   const allowed = await rateLimit(supa, userId, "stripe_checkout", 10, 3600);
//   if (!allowed) return json({ error: "Rate limit exceeded" }, 429);

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Reserve an attempt before calling a provider. Database failures fail closed. */
export async function rateLimit(
  supa: SupabaseClient,
  userId: string,
  action: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const { data, error } = await supa.rpc("filey_take_rate_limit", {
    p_subject: userId, p_action: action, p_limit: limit, p_window_seconds: windowSeconds,
  });
  if (error || typeof data !== "boolean") throw new Error("Usage limits are temporarily unavailable. Please retry later.");
  return data;
}

/** Best-effort account audit trail; rate reservations do not depend on it. */
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
