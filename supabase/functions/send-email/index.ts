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

// SECURITY: per-user hourly cap so a compromised account can't mass-mail
// from our domain. Counted in audit_log (action='email_send') via the
// service-role client — no extra table.
const HOURLY_LIMIT = 30;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { to, subject, html } = await req.json();
    if (!to || !subject || !html) {
      return json({ error: "to, subject and html are required" }, 400);
    }
    // SECURITY: transactional sender, not a relay — one recipient per call
    // (an array here would let any signed-in user mass-mail from our domain).
    if (typeof to !== "string" || to.length > 320 ||
        String(subject).length > 500 || String(html).length > 500_000) {
      return json({ error: "invalid payload" }, 400);
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
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await supa
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", "email_send")
      .gte("created_at", hourAgo);
    if ((count ?? 0) >= HOURLY_LIMIT) {
      return json({ error: "Email rate limit reached — try again later." }, 429);
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to, subject, html }),
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
