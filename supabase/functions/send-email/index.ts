// Supabase Edge Function: send transactional email (invoices, quotes)
// from the web app via Resend. SMTP credentials never touch the client.
//
// Deploy:
//   supabase functions deploy send-email
//   supabase secrets set RESEND_API_KEY=re_xxx EMAIL_FROM="Filey <invoices@yourdomain.com>"
//
// The function verifies the session with auth.getUser (including new signing keys), so
// only signed-in users can send. Password recovery is handled by Supabase
// Auth with Resend SMTP, including Auth's native rate limits.
// Body: { to, subject, html }.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimit } from "../_shared/rateLimit.ts";

// SECURITY: per-user DAILY cap so a compromised account can't mass-mail from
// our domain. Reserve each attempt before contacting Resend; a failed or
// uncertain provider response still consumes the attempt. Tiered limits:
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
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let body;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON payload" }, 400); }
    if (!body || typeof body !== "object") return json({ error: "Invalid payload" }, 400);
    const RESEND = Deno.env.get("RESEND_API_KEY");
    const FROM = Deno.env.get("EMAIL_FROM") ?? "";
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Sign in to use email." }, 401);
    const { data: auth, error: authError } = await supa.auth.getUser(jwt);
    if (authError || !auth.user) return json({ error: "Session expired. Sign in again." }, 401);
    const userId = auth.user.id;
    if (body.action === "status") return json({ configured: !!RESEND && !!FROM, from: FROM || null });
    const { to, subject, html, attachments, requestId } = body;
    if (requestId !== undefined && (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)))
      return json({ error: "Invalid request ID" }, 400);
    if (!to || !subject || !html) {
      return json({ error: "to, subject and html are required" }, 400);
    }
    // SECURITY: transactional sender, not a relay — one recipient per call
    // (an array here would let any signed-in user mass-mail from our domain).
    if (typeof to !== "string" || to.length > 320 ||
        typeof subject !== "string" || typeof html !== "string" ||
        !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to.trim()) ||
        subject.length > 500 || html.length > 500_000) {
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

    if (!RESEND || !FROM) return json({ error: "Email is not configured. Ask the administrator to set the Resend API key and sender address." }, 503);

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

    if (!await rateLimit(supa, userId, "email_send", limit, 86400)) {
      return json(
        { error: `Daily email attempt limit reached (${limit}/day). Try again tomorrow or upgrade your plan.` },
        429
      );
    }

    const res = await fetch("https://api.resend.com/emails", {
      signal: AbortSignal.timeout(20000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND}`,
        "Content-Type": "application/json",
        ...(requestId ? { "Idempotency-Key": `filey/${userId}/${requestId}` } : {}),
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
    if (!res.ok) return json({ error: data?.message ?? "Send failed" }, res.status === 429 ? 429 : 422);

    // Record accepted sends separately from the service's attempt budget.
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
