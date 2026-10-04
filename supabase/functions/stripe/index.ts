// Filey — Stripe billing edge function (Deno). DEPRECATED.
//
// Dodo Payments sells the Freedom licence now (supabase/functions/dodo). This
// function stays deployed only because apps shipped before 2.11.1 call it for
// license_activate / license_deactivate; retire it once those installs are
// gone. New work belongs in the dodo function, and licence issuing itself
// lives in _shared/license.ts.
//
// One function, three jobs (routed by request shape):
//   • POST { action: "checkout", plan }  → Stripe Checkout (subscription) URL
//   • POST { action: "portal" }          → Stripe billing-portal URL
//   • POST  (with stripe-signature hdr)  → webhook: sync plan onto the org
//
// Secrets (set later, when keys are ready):
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO,
//   STRIPE_PRICE_BUSINESS, SITE_URL (optional). SUPABASE_URL +
//   SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
//
// Deploy:  supabase functions deploy stripe --no-verify-jwt
// (webhook has no Supabase JWT; the action path verifies the user manually.)

import Stripe from "https://esm.sh/stripe@17?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { licenseActivate, licenseDeactivate } from "../_shared/license.ts";
import { rateLimit, logAction } from "../_shared/rateLimit.ts";
import { adminWorkspace } from "../_shared/admin-workspace.ts";
import { mfaAllowed, MFA_REQUIRED } from "../_shared/mfa.ts";
import { stripeCheckoutArgs } from "../_shared/stripe-checkout.ts";
import { dispatchStripeAction } from "../_shared/stripe-actions.ts";
import { BillingRequestError, readBillingBody } from "../_shared/billing-request.ts";
import {
  applyStripeSubscription,
  stripeSubscriptionCheckoutAllowed,
} from "../_shared/stripe-subscriptions.ts";

// Licence-only legacy installs must work after Stripe sales are retired.
// Constructing Stripe with an absent key throws before any request can run.
function stripeClient() {
  const key = Deno.env.get("STRIPE_SECRET_KEY")?.trim();
  if (!key) throw new Error("Stripe billing is unavailable.");
  return new Stripe(key, { apiVersion: "2024-06-20" });
}
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SITE_URL = Deno.env.get("SITE_URL") ?? "";

const PRICES: Record<string, string | undefined> = {
  pro: Deno.env.get("STRIPE_PRICE_PRO"),
  business: Deno.env.get("STRIPE_PRICE_BUSINESS"),
};
// One-time desktop license (Lite tier).
const PRICE_LITE = Deno.env.get("STRIPE_PRICE_LITE");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE);
}

async function userOrg(supa: ReturnType<typeof admin>, userId: string) {
  const orgId = await adminWorkspace(supa, userId);
  if (!orgId) return null;
  const { data: org } = await supa
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .maybeSingle();
  return org ?? null;
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const sig = req.headers.get("stripe-signature");
  if (sig) return handleWebhook(req, sig);

  // SECURITY: SITE_URL wins — the Origin header is caller-controlled, and it
  // ends up in Stripe success/cancel redirect URLs (open-redirect phishing on
  // the public pay_invoice path otherwise).
  const origin = SITE_URL || "https://app.gofiley.com";
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(await readBillingBody(req, 16_384));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    payload = parsed as Record<string, unknown>;
  } catch (error) {
    return json({ error: error instanceof BillingRequestError ? error.message : "Invalid JSON billing request." }, error instanceof BillingRequestError ? 413 : 400);
  }
  const action = payload.action;
  if (typeof action !== "string" || !["pay_invoice", "license_activate", "license_deactivate", "checkout", "checkout_lite", "portal"].includes(action))
    return json({ error: "Unknown billing action." }, 400);

  try {
    return await dispatchStripeAction(
      action,
      async () => {
        // AUTHENTICATED actions below (the account owner).
        const supa = admin();
        const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        const { data: u } = await supa.auth.getUser(jwt);
        const user = u?.user;
        if (!user) return json({ error: "Unauthorized" }, 401);
        if (!mfaAllowed(user, jwt)) return json(MFA_REQUIRED, 403);

        // RATE LIMIT: max 20 Stripe actions per hour per user
        const allowed = await rateLimit(supa, user.id, "stripe_action", 20, 3600);
        if (!allowed)
          return json({ error: "Rate limit exceeded — try again later." }, 429);
        await logAction(supa, user.id, "stripe_action", { action });

        // Desktop license actions don't need an org — they attach to the user.
        if (action === "license_activate") {
          const result = await licenseActivate(
            supa,
            user,
            String(payload.fingerprint ?? ""),
            String(payload.device_name ?? "")
          );
          return json(result.body, result.status);
        }
        if (action === "license_deactivate") {
          const result = await licenseDeactivate(
            supa,
            user.id,
            String(payload.fingerprint ?? "")
          );
          return json(result.body, result.status);
        }

        const org = await userOrg(supa, user.id);
        if (!org)
          return json(
            { error: "Workspace billing requires owner or administrator access." },
            403
          );

        const plan = payload.plan;
        if (action === "checkout" && (typeof plan !== "string" || !Object.hasOwn(PRICES, plan) || !PRICES[plan]))
          return json({ error: "Choose an available plan." }, 400);
        if (action === "checkout_lite" && !PRICE_LITE)
          return json({ error: "Lite price not configured" }, 400);
        if (action === "checkout" && !stripeSubscriptionCheckoutAllowed(org))
          return json(
            {
              error:
                "Your workspace already has paid access. Manage the existing subscription from billing.",
            },
            409
          );

        const stripe = stripeClient();

        // ensure a Stripe customer for the org
        let customerId = org.stripe_customer_id as string | null;
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: user.email ?? undefined,
            name: org.name ?? undefined,
            metadata: { org_id: org.id },
          });
          customerId = customer.id;
          const { error } = await supa
            .from("organizations")
            .update({ stripe_customer_id: customerId })
            .eq("id", org.id);
          if (error) throw new Error("Billing customer could not be saved. Try again.");
        }

        if (action === "portal") {
          const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${origin}/#/settings?section=billing`,
          });
          return json({ url: session.url });
        }

        // One-time desktop license (Lite). invoice_creation makes Stripe email a
        // proper invoice for the one-off payment (subscriptions do this natively).
        if (action === "checkout_lite") {
          const session = await stripe.checkout.sessions.create({
            mode: "payment",
            customer: customerId,
            line_items: [{ price: PRICE_LITE, quantity: 1 }],
            invoice_creation: { enabled: true },
            success_url: `${origin}/#/settings?section=license&checkout=success`,
            cancel_url: `${origin}/#/settings?section=license&checkout=cancel`,
            metadata: { type: "lite_license", user_id: user.id },
          });
          return json({ url: session.url });
        }

        if (action === "checkout") {
          const price = PRICES[plan as string];
          const session = await stripe.checkout.sessions.create({
            mode: "subscription",
            customer: customerId,
            line_items: [{ price, quantity: 1 }],
            success_url: `${origin}/#/settings?section=billing&checkout=success`,
            cancel_url: `${origin}/#/settings?section=billing&checkout=cancel`,
            metadata: { org_id: org.id, plan: String(plan) },
            subscription_data: { metadata: { org_id: org.id, plan: String(plan) } },
          });
          return json({ url: session.url });
        }

        return json({ error: "Unknown action" }, 400);
      },
      CORS
    );
  } catch {
    return json({ error: "Billing is temporarily unavailable. Please try again later." }, 503);
  }
}
if (import.meta.main) Deno.serve(handleRequest);

async function handleWebhook(req: Request, sig: string): Promise<Response> {
  let raw: string;
  try {
    raw = await readBillingBody(req, 1_000_000);
  } catch (error) {
    return json({ error: error instanceof BillingRequestError ? error.message : "Invalid billing request." }, error instanceof BillingRequestError ? 413 : 400);
  }
  let stripe: Stripe;
  try { stripe = stripeClient(); } catch {
    return json({ error: "Billing is temporarily unavailable. Please try again later." }, 503);
  }
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, WEBHOOK_SECRET);
  } catch {
    return json({ error: "Invalid webhook signature." }, 401);
  }
  const supa = admin();

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const s = event.data.object as Stripe.Checkout.Session;
        // Completion alone is not payment for delayed payment methods.
        if (s.payment_status !== "paid") break;
        const settlement = stripeCheckoutArgs(s);
        if (settlement) {
          const { error } = await supa.rpc("filey_settle_stripe_checkout", settlement);
          if (error) throw new Error("Stripe checkout settlement could not be saved.");
          break;
        }
        // An unrelated one-time payment cannot grant a subscription. The
        // checkout only supplies an id: use Stripe's current state and the
        // atomic customer/workspace binding, never delayed event metadata.
        if (s.mode !== "subscription") break;
        const id =
          typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
        await applyStripeSubscription(
          supa,
          stripe,
          id ?? "",
          event.created,
          true,
          PRICES
        );
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await applyStripeSubscription(supa, stripe, sub.id, event.created, false, PRICES);
        break;
      }
    }
  } catch {
    return json({ error: "Billing delivery could not be completed. Delivery will be retried." }, 503);
  }
  return json({ received: true });
}
