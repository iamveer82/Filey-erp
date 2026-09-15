// Filey — Dodo Payments edge function (Deno).
//
// Sells the one-time Freedom licence and turns a completed payment into an
// entitlement the app can see, so the plan flips on its own:
//
//   • POST { action: "checkout" }            → hosted checkout URL
//   • POST { action: "license_status" }      → { licensed } — polled after checkout
//   • POST { action: "license_activate" }    → signed offline licence token
//   • POST { action: "license_deactivate" }  → frees a device slot
//   • POST (with webhook-signature header)   → Dodo webhook: grant the licence
//
// Dodo is a merchant of record: it bills, charges tax and pays out, so nothing
// here touches card data. The webhook is the only thing that may grant a
// licence — a client claiming "I paid" proves nothing.
//
// Secrets:
//   DODO_PAYMENTS_API_KEY, DODO_PAYMENTS_WEBHOOK_KEY,
//   DODO_PAYMENTS_ENVIRONMENT (test_mode | live_mode — defaults to test_mode),
//   DODO_PRODUCT_FREEDOM (product id of the Freedom licence),
//   LICENSE_SIGNING_KEY, SITE_URL.
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
//
// Deploy:  supabase functions deploy dodo --no-verify-jwt
// (the webhook carries no Supabase JWT; the action path verifies the user.)

import DodoPayments from "https://esm.sh/dodopayments@2.50.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimit, logAction } from "../_shared/rateLimit.ts";
import {
  licenseActivate,
  licenseDeactivate,
  licenseStatus,
  grantLicense,
  type LicenseResult,
} from "../_shared/license.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_KEY = Deno.env.get("DODO_PAYMENTS_API_KEY") ?? "";
const WEBHOOK_KEY = Deno.env.get("DODO_PAYMENTS_WEBHOOK_KEY") ?? "";
const PRODUCT_FREEDOM = Deno.env.get("DODO_PRODUCT_FREEDOM") ?? "";
const SITE_URL = Deno.env.get("SITE_URL") ?? "";

// A missing variable must never mean "charge real cards", so test mode is the
// default and live has to be asked for by name.
const ENVIRONMENT =
  Deno.env.get("DODO_PAYMENTS_ENVIRONMENT") === "live_mode" ? "live_mode" : "test_mode";

const dodo = new DodoPayments({
  bearerToken: API_KEY,
  environment: ENVIRONMENT,
  webhookKey: WEBHOOK_KEY,
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, apikey, x-client-info, webhook-id, webhook-signature, webhook-timestamp",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

const reply = (r: LicenseResult) => json(r.body, r.status);
const admin = () => createClient(SUPABASE_URL, SERVICE_ROLE);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.headers.get("webhook-signature")) return handleWebhook(req);

  const payload = await req.json().catch(() => ({}) as Record<string, unknown>);
  const action = String(payload.action ?? "");

  try {
    const supa = admin();
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await supa.auth.getUser(jwt);
    const user = u?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const allowed = await rateLimit(supa, user.id, "dodo_action", 20, 3600);
    if (!allowed) return json({ error: "Rate limit exceeded — try again later." }, 429);
    await logAction(supa, user.id, "dodo_action", { action });

    if (action === "license_status") return reply(await licenseStatus(supa, user.id));

    if (action === "license_activate")
      return reply(
        await licenseActivate(
          supa,
          user,
          String(payload.fingerprint ?? ""),
          String(payload.device_name ?? "")
        )
      );

    if (action === "license_deactivate")
      return reply(await licenseDeactivate(supa, user.id, String(payload.fingerprint ?? "")));

    if (action === "checkout") {
      if (!API_KEY) return json({ error: "Payments are not configured yet." }, 503);
      if (!PRODUCT_FREEDOM) return json({ error: "Freedom product not configured" }, 503);
      const already = await licenseStatus(supa, user.id);
      if (already.body.licensed)
        return json({ error: "This account already owns a Freedom licence." }, 409);

      // SECURITY: the redirect target comes from SITE_URL, never the caller's
      // Origin header — otherwise the checkout doubles as an open redirect.
      const base = SITE_URL || "";
      const session = await dodo.checkoutSessions.create({
        product_cart: [{ product_id: PRODUCT_FREEDOM, quantity: 1 }],
        customer: { email: user.email ?? "", name: String(payload.name ?? "") || undefined },
        // The webhook is what grants the licence; this metadata is how it knows
        // whose account to grant it to.
        metadata: { type: "freedom_license", user_id: user.id },
        return_url: base ? `${base}/#/settings?section=license&checkout=success` : undefined,
        cancel_url: base ? `${base}/#/settings?section=license&checkout=cancel` : undefined,
      });
      if (!session.checkout_url) return json({ error: "Dodo returned no checkout URL" }, 502);
      return json({ url: session.checkout_url, session_id: session.session_id });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/** Dodo → us. Verified with the Standard Webhooks signature before anything is
 *  read out of the body; an unverified payload is an attacker's licence. */
async function handleWebhook(req: Request): Promise<Response> {
  if (!WEBHOOK_KEY) return json({ error: "Webhook key not configured" }, 503);
  const raw = await req.text();

  let event: Awaited<ReturnType<typeof dodo.webhooks.unwrap>>;
  try {
    event = await dodo.webhooks.unwrap(raw, {
      headers: {
        "webhook-id": req.headers.get("webhook-id") ?? "",
        "webhook-signature": req.headers.get("webhook-signature") ?? "",
        "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
      },
    });
  } catch (e) {
    return json({ error: `Invalid signature: ${e instanceof Error ? e.message : String(e)}` }, 401);
  }

  // Everything else (failures, disputes, refunds) is recorded by Dodo; only a
  // completed payment changes what this app lets someone do.
  if (event.type !== "payment.succeeded") return json({ received: true, ignored: event.type });

  const data = event.data;
  const meta = (data.metadata ?? {}) as Record<string, string>;
  if (meta.type !== "freedom_license" || !meta.user_id || !data.payment_id)
    return json({ received: true, ignored: "not a Freedom licence purchase" });

  try {
    const outcome = await grantLicense(admin(), meta.user_id, data.payment_id);
    return json({ received: true, outcome });
  } catch (e) {
    // 500 asks Dodo to retry, which is what we want: the buyer has paid and
    // has no licence yet.
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
