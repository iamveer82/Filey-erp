// Composio webhook receiver: live events from apps customers connected.
//
// Public by necessity (Composio calls it). Trust model: every POST must carry a
// fresh signature made with COMPOSIO_WEBHOOK_SECRET (the secret Composio returns
// when the project's webhook subscription is created). Without the secret the
// function refuses everything. An event is stored only for a trigger a customer
// turned on through the `integrations` function, which recorded who owns it;
// the event's own user id must match that owner's Composio identity too.
//
//   supabase functions deploy composio-webhook --no-verify-jwt
//
// Secret: COMPOSIO_WEBHOOK_SECRET. Tables: supabase/2026-11-21-app-events.sql.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readBillingBody, BillingRequestError } from "../_shared/billing-request.ts";
import { parseComposioEvent, storableData, verifyComposio } from "../_shared/composio-webhook.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const secret = (Deno.env.get("COMPOSIO_WEBHOOK_SECRET") ?? "").trim();
  if (!secret) return json({ error: "Webhooks are not configured." }, 503);

  let raw: string;
  try {
    raw = await readBillingBody(req, 524_288);
  } catch (error) {
    if (error instanceof BillingRequestError) return json({ error: "Payload too large." }, 413);
    return json({ error: "Could not read the request." }, 400);
  }
  const headers = {
    id: req.headers.get("webhook-id"),
    timestamp: req.headers.get("webhook-timestamp"),
    signature: req.headers.get("webhook-signature"),
  };
  if (!(await verifyComposio(secret, headers, raw))) return json({ error: "Invalid signature." }, 401);

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ ok: true, ignored: "not json" }); }
  const event = parseComposioEvent(body, headers.id ?? "");
  if (!event) return json({ ok: true, ignored: "event type" });

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    if (event.kind === "trigger") {
      const { data: trigger, error } = await supa.from("app_triggers")
        .select("id,org_id,user_id,entity,toolkit").eq("id", event.triggerId).maybeSingle();
      if (error) throw error;
      // A trigger Filey did not create, or one whose owner identity disagrees, is not stored.
      if (!trigger || (event.userId && event.userId !== trigger.entity)) return json({ ok: true, ignored: "unknown trigger" });
      const { error: insertError } = await supa.from("app_events").upsert({
        event_key: event.key, trigger_id: trigger.id, org_id: trigger.org_id, user_id: trigger.user_id,
        toolkit: trigger.toolkit, trigger_slug: event.triggerSlug, data: storableData(event.data),
      }, { onConflict: "event_key", ignoreDuplicates: true });
      if (insertError) throw insertError;
    } else {
      // The app signed the customer out: tell every owner who had events on that account.
      const { data: owners, error } = await supa.from("app_triggers")
        .select("org_id,user_id,toolkit").eq("connected_account_id", event.connectedAccountId);
      if (error) throw error;
      const seen = new Set<string>();
      for (const owner of owners ?? []) {
        const who = `${owner.org_id}:${owner.user_id}`;
        if (seen.has(who)) continue;
        seen.add(who);
        const { error: insertError } = await supa.from("app_events").upsert({
          event_key: `${event.key}:${who}`, trigger_id: null, org_id: owner.org_id, user_id: owner.user_id,
          toolkit: event.toolkit || owner.toolkit, trigger_slug: "CONNECTION_EXPIRED",
          data: { message: "This app signed Filey out. Connect it again in Integrations to keep receiving events." },
        }, { onConflict: "event_key", ignoreDuplicates: true });
        if (insertError) throw insertError;
      }
    }
    // ponytail: no cron; about one call in a hundred clears events older than 30 days.
    if (Math.random() < 0.01)
      await supa.from("app_events").delete().lt("received_at", new Date(Date.now() - 30 * 86_400_000).toISOString());
    return json({ ok: true });
  } catch (error) {
    console.error("composio-webhook", error instanceof Error ? error.message : error);
    // A failed save is retried by Composio; event_key keeps a retry from storing twice.
    return json({ error: "Could not store the event." }, 500);
  }
});
