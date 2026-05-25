// Filey — overdue invoice email reminders (Deno edge function).
//
// Run on a schedule (Supabase pg_cron, or any external cron hitting this URL)
// to email customers whose issued invoices are past due. Uses the service
// role to read across orgs, and Resend to send.
//
// Secrets to set:  RESEND_API_KEY,  REMINDER_FROM (e.g. "Filey <billing@yourdomain>"),
//                  SITE_URL (for the portal link).
// Deploy:  supabase functions deploy overdue-reminders --no-verify-jwt
// Schedule (SQL, runs daily 08:00 UTC):
//   select cron.schedule('filey-overdue','0 8 * * *', $$
//     select net.http_post('https://<ref>.functions.supabase.co/overdue-reminders',
//       '{}'::jsonb, headers:='{"Content-Type":"application/json"}'::jsonb); $$);

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("REMINDER_FROM") ?? "Filey <reminders@filey.app>";
const SITE_URL = Deno.env.get("SITE_URL") ?? "";

Deno.serve(async () => {
  if (!RESEND_API_KEY) {
    return Response.json({ error: "RESEND_API_KEY not set" }, { status: 400 });
  }
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const today = new Date().toISOString().slice(0, 10);

  // Issued (non-draft, unpaid) invoices past their due date, with an email.
  const { data, error } = await supa
    .from("invoice_docs")
    .select("id, number, customer_name, customer_email, due_date, currency, share_token, status")
    .lt("due_date", today)
    .neq("status", "paid")
    .neq("status", "draft");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let sent = 0;
  for (const inv of data ?? []) {
    if (!inv.customer_email) continue;
    const link = inv.share_token ? `${SITE_URL}/#/portal/${inv.share_token}` : "";
    const html = `
      <p>Dear ${inv.customer_name ?? "customer"},</p>
      <p>This is a friendly reminder that invoice <b>${inv.number}</b> was due on
         ${inv.due_date} and is currently outstanding.</p>
      ${link ? `<p><a href="${link}" style="background:#FFD600;color:#0A0A0A;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">View &amp; pay online</a></p>` : ""}
      <p>Thank you.</p>`;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM,
          to: inv.customer_email,
          subject: `Reminder: invoice ${inv.number} is overdue`,
          html,
        }),
      });
      if (res.ok) sent++;
    } catch {
      /* skip failures, continue */
    }
  }
  return Response.json({ ok: true, considered: data?.length ?? 0, sent });
});
