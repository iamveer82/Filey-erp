// Shared context for the Instagram automation endpoints.
// Authenticates the caller's Supabase JWT, resolves their org, and requires
// the marketing module (or an owner/admin role) — the same gate as the other
// marketing integrations. Returns a service-role client scoped to this call.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mfaAllowed, MFA_REQUIRED } from "./mfa.ts";
import { integrationAllowed } from "./integration-access.ts";

export interface MarketingContext {
  supa: SupabaseClient;
  userId: string;
  orgId: string;
  json: (body: unknown, status?: number) => Response;
}

export const marketingJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });

/** Returns either the context or a ready Response to send back. */
export async function requireMarketing(
  req: Request,
  provider = "instagram"
): Promise<MarketingContext | Response> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return marketingJson({ error: "Sign in to use the Instagram automation." }, 401);
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: auth, error: authError } = await supa.auth.getUser(jwt);
  if (authError || !auth.user) return marketingJson({ error: "Session expired. Sign in again." }, 401);
  if (!mfaAllowed(auth.user, jwt)) return marketingJson(MFA_REQUIRED, 403);
  const { data: profile } = await supa.from("profiles").select("org_id").eq("id", auth.user.id).maybeSingle();
  const orgId = (profile?.org_id as string | undefined)?.trim();
  if (!orgId) return marketingJson({ error: "Workspace access could not be verified." }, 403);
  const { data: member } = await supa
    .from("org_members")
    .select("role,modules")
    .eq("org_id", orgId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!integrationAllowed(member, provider))
    return marketingJson({ error: "Your role does not have access to the marketing automations." }, 403);
  return { supa, userId: auth.user.id, orgId, json: marketingJson };
}
