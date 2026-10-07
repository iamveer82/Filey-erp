// Filey — overdue invoice email reminders (Deno edge function).
//
// Run on a schedule (Supabase pg_cron, or any external cron hitting this URL)
// to email customers whose issued invoices are past due, using Resend to send.
//
// SCOPE: one org — the OWNER_USER_ID org, the same pin agent-jobs uses. The
// service role can read every tenant's invoices, and an unscoped query here
// would mail another business's customers from this deployment's FROM address,
// signed by us. Per-tenant reminders need each org to opt in with its own
// sender identity; until that exists, this stays pinned to the operator.
//
// Secrets to set:  RESEND_API_KEY,  REMINDER_FROM (e.g. "Filey <billing@yourdomain>"),
//                  SITE_URL (for the portal link),  OWNER_USER_ID (REQUIRED),
//                  AGENT_JOBS_SECRET (REQUIRED — fail-closed; same secret the
//                  agent-jobs function uses, sent as x-agent-secret header).
// Deploy:  supabase functions deploy overdue-reminders --no-verify-jwt
// Schedule (SQL, runs daily 08:00 UTC):
//   select cron.schedule('filey-overdue','0 8 * * *', $$
//     select net.http_post('https://<ref>.functions.supabase.co/overdue-reminders',
//       '{}'::jsonb, headers:='{"Content-Type":"application/json","x-agent-secret":"<AGENT_JOBS_SECRET>"}'::jsonb); $$);

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adminWorkspace } from "../_shared/admin-workspace.ts";
import { secretMatches } from "../_shared/secret-compare.ts";
import { runReminders } from "../_shared/overdue-reminders.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("REMINDER_FROM") ?? "Filey <reminders@filey.app>";
const SITE_URL = Deno.env.get("SITE_URL") ?? "";
const SECRET = Deno.env.get("AGENT_JOBS_SECRET") ?? "";
const OWNER = Deno.env.get("OWNER_USER_ID") ?? "";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  // SECURITY: fail-closed cron auth. Deployed with --no-verify-jwt, so
  // without this check anyone with the URL could trigger a mass email
  // blast to every customer.
  if (!(await secretMatches(req.headers.get("x-agent-secret"), SECRET))) {
    return new Response("forbidden", { status: 403 });
  }
  if (!RESEND_API_KEY) {
    return Response.json({ error: "RESEND_API_KEY not set" }, { status: 400 });
  }
  if (!OWNER) {
    return Response.json({ error: "OWNER_USER_ID not set" }, { status: 400 });
  }
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Which org this deployment speaks for. No org, no mail — never fall back to
  // "every org", which is exactly the blast this function must not send.
  const org = await adminWorkspace(supa, OWNER);
  if (!org)
    return Response.json(
      { error: "Owner workspace access is unavailable." },
      { status: 403 }
    );

  try {
    const results = await runReminders(supa, org, {
      owner: OWNER,
      key: RESEND_API_KEY,
      from: FROM,
      siteUrl: SITE_URL,
    });
    return Response.json(
      { ok: results.failed === 0, ...results },
      { status: results.failed ? 502 : 200 }
    );
  } catch {
    return Response.json(
      { ok: false, error: "Reminder data unavailable. Retry the scheduled job." },
      { status: 503 }
    );
  }
});
