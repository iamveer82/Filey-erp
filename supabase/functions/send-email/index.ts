// Supabase Edge Function: send transactional email (invoices, quotes)
// from the web app via Resend. SMTP credentials never touch the client.
//
// Deploy:
//   supabase functions deploy send-email
//   supabase secrets set RESEND_API_KEY=re_xxx EMAIL_FROM="Filey <invoices@yourdomain.com>"
//
// The function requires a valid Supabase JWT (verified by default), so
// only signed-in users can send. Body: { to, subject, html }.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// SECURITY: per-user DAILY cap so a compromised account can't mass-mail from
// our domain. Counted in audit_log (action='email_send') via the service-role
// client — no extra table. Tiered to mirror src/lib/license.ts:
//   free  → 10/day (must match EMAIL_DAILY_LIMIT.free)
//   paid  → cloud plan OR an active one-time desktop licence; effectively
//           unlimited, but a high safety ceiling still guards our Resend
//           quota if a paid account is compromised.
const FREE_DAILY_LIMIT = 10;
const PAID_DAILY_CEILING = 5000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { to, subject, html, attachments } = await req.json();
    if (!to || !subject || !html) {
      return json({ error: "to, subject and html are required" }, 400);
    }
    // SECURITY: transactional sender, not a relay — one recipient per call
    // (an array here would let any signed-in user mass-mail from our domain).
    if (typeof to !== "string" || to.length > 320 ||
        String(subject).length > 500 || String(html).length > 500_000) {
      return json({ error: "invalid payload" }, 400);
    }
    // Optional file attachments (e.g. the invoice PDF). Base64 content, capped
    // so a signed-in user can't push huge payloads through our Resend quota.
    if (attachments !== undefined) {
      if (!Array.isArray(attachments) || attachments.length > 5) {
        return json({ error: "invalid attachments" }, 400);
      }
      let totalB64 = 0;
      for (const a of attachments) {
        if (!a || typeof a.filename !== "string" || a.filename.length > 200 ||
            typeof a.content !== "string") {
          return json({ error: "invalid attachment" }, 400);
        }
        totalB64 += a.content.length;
      }
      if (totalB64 > 15_000_000) { // ~11 MB of files once decoded
        return json({ error: "attachments too large" }, 400);
      }
    }

    const RESEND = Deno.env.get("RESEND_API_KEY");
    const FROM = Deno.env.get("EMAIL_FROM") ?? "Filey <onboarding@resend.dev>";
    if (!RESEND) return json({ error: "RESEND_API_KEY not configured" }, 500);

    // The platform already verified the JWT (verify_jwt=true), so the sub
    // claim is trustworthy — decode it for the rate-limit key.
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    let userId = "";
    try {
      userId = JSON.parse(atob(jwt.split(".")[1])).sub ?? "";
    } catch { /* fall through to reject below */ }
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve the user's tier from their org's plan (service role bypasses
    // RLS). Mirrors resolveTier() in src/lib/license.ts.
    let paid = false;
    const { data: prof } = await supa
      .from("profiles")
      .select("org_id")
      .eq("id", userId)
      .maybeSingle();
    const orgId = prof?.org_id as string | undefined;
    if (orgId && orgId !== "default") {
      const { data: org } = await supa
        .from("organizations")
        .select("plan, plan_status")
        .eq("id", orgId)
        .maybeSingle();
      const plan = org?.plan as string | undefined;
      const status = org?.plan_status as string | undefined;
      paid =
        !!plan &&
        plan !== "free" &&
        (status === "active" || status === "trialing" || status === "past_due");
    }
    // A one-time desktop (Lite) licence counts as paid. Offline users send
    // through this same function but their org is usually 'default'/free, so
    // without this they sat on the 10/day free-cloud cap they already paid to
    // be out of.
    if (!paid) {
      const { data: lic } = await supa
        .from("licenses")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      paid = !!lic;
    }
    const limit = paid ? PAID_DAILY_CEILING : FREE_DAILY_LIMIT;

    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await supa
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", "email_send")
      .gte("created_at", dayAgo);
    if ((count ?? 0) >= limit) {
      return json(
        { error: `Daily email limit reached (${limit}/day). Try again tomorrow or upgrade your plan.` },
        429
      );
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to,
        subject,
        html,
        ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
      }),
    });

    const data = await res.json();
    if (!res.ok) return json({ error: data?.message ?? "Send failed" }, 502);

    // Count the send (this row is what the rate limit reads).
    const ins = await supa.from("audit_log").insert({
      user_id: userId,
      actor: "user",
      action: "email_send",
      entity: "email",
      details: to,
    });
    if (ins.error) console.error("email_send audit insert failed", ins.error);

    return json({ id: data?.id ?? null });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
