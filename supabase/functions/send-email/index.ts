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

    const RESEND = Deno.env.get("RESEND_API_KEY");
    const FROM = Deno.env.get("EMAIL_FROM") ?? "Filey <onboarding@resend.dev>";
    if (!RESEND) return json({ error: "RESEND_API_KEY not configured" }, 500);

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
