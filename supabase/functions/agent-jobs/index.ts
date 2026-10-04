// Filey — scheduled agent jobs (Deno edge function). Phase 2 of the autonomy
// plan: the agent works without being asked.
//
//   • digest      — morning briefing to the owner's Telegram: cash position,
//                   due/overdue invoices, low stock.
//   • lowstock_po — draft purchase orders for products at/below reorder level,
//                   grouped by supplier (drafts only — owner reviews in Filey).
//
// Deploy:  supabase functions deploy agent-jobs --no-verify-jwt
// Secrets: AGENT_JOBS_SECRET (any long random string — REQUIRED, fail-closed),
//          TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_CHAT_ID, OWNER_USER_ID
//          (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY auto-provided.)
// Schedule (SQL, daily 08:00 Dubai = 04:00 UTC):
//   select cron.schedule('filey-agent-digest','0 4 * * *', $$
//     select net.http_post(
//       'https://<ref>.functions.supabase.co/agent-jobs',
//       '{"job":"all"}'::jsonb,
//       headers:='{"Content-Type":"application/json","x-agent-secret":"<AGENT_JOBS_SECRET>"}'::jsonb); $$);
//
// SECURITY: service-role client — every query pins org_id / user_id
// explicitly (same rule as channel-webhook/tools.ts). Writes are drafts only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimit, logAction } from "../_shared/rateLimit.ts";
import { adminWorkspace } from "../_shared/admin-workspace.ts";
import { runDigest, runLowStockPo, tell } from "../_shared/agent-jobs.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OWNER = Deno.env.get("OWNER_USER_ID") ?? "";
const SECRET = Deno.env.get("AGENT_JOBS_SECRET") ?? "";
const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

/* ---------------- dispatcher ---------------- */

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  if (!SECRET || req.headers.get("x-agent-secret") !== SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  if (!OWNER) return Response.json({ error: "OWNER_USER_ID not set" }, { status: 400 });

  // RATE LIMIT: max 5 agent job runs per hour (scheduled cron + manual)
  const supa0 = createClient(SUPABASE_URL, SERVICE_ROLE);
  const allowed = await rateLimit(supa0, OWNER, "agent_jobs", 5, 3600);
  if (!allowed)
    return Response.json(
      { error: "Rate limit exceeded — try again later." },
      { status: 429 }
    );
  await logAction(supa0, OWNER, "agent_jobs", { job: "all" });

  const body = await req.json().catch(() => null);
  const job = body?.job ?? "all";
  if (!body || !["all", "digest", "lowstock_po"].includes(job))
    return Response.json({ error: "Invalid job request" }, { status: 400 });

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const org = await adminWorkspace(supa, OWNER);
  if (!org) return Response.json({ error: "owner org not found" }, { status: 400 });

  const out: Record<string, unknown> = {};
  const messages: string[] = [];

  try {
    if (job === "lowstock_po" || job === "all") {
      const msg = await runLowStockPo(supa, org, OWNER);
      out.lowstock_po = msg || "no new draft needed";
      if (msg) messages.push(msg);
    }
    if (job === "digest" || job === "all") {
      const msg = await runDigest(supa, org);
      out.digest = "built";
      messages.push(msg);
    }

    if (messages.length) {
      out.telegram = await tell(supa, messages.join("\n\n"), {
        owner: OWNER,
        org,
        bot: BOT,
        chat: Deno.env.get("TELEGRAM_OWNER_CHAT_ID") ?? "",
      });
    }
    return Response.json({ ok: true, job, ...out });
  } catch (error) {
    console.error(
      "Scheduled job failed",
      error instanceof Error ? error.message : "unknown"
    );
    return Response.json(
      {
        ok: false,
        job,
        error: "Job could not finish. Check delivery before retrying.",
      },
      { status: 502 }
    );
  }
});
