// Filey — Stripe billing edge function (Deno).
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

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-06-20",
});
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SITE_URL = Deno.env.get("SITE_URL") ?? "";

const PRICES: Record<string, string | undefined> = {
  pro: Deno.env.get("STRIPE_PRICE_PRO"),
  business: Deno.env.get("STRIPE_PRICE_BUSINESS"),
};

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
  const { data: m } = await supa
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  let orgId = m?.org_id as string | undefined;
  if (!orgId) {
    const { data: o } = await supa
      .from("organizations")
      .select("id")
      .eq("owner_id", userId)
      .limit(1)
      .maybeSingle();
    orgId = o?.id as string | undefined;
  }
  if (!orgId) return null;
  const { data: org } = await supa
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .maybeSingle();
  return org ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const sig = req.headers.get("stripe-signature");
  if (sig) return handleWebhook(req, sig);

  try {
    const supa = admin();
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u } = await supa.auth.getUser(jwt);
    const user = u?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const org = await userOrg(supa, user.id);
    if (!org) return json({ error: "No organization found" }, 400);

    const { action, plan } = await req.json().catch(() => ({}));
    const origin = req.headers.get("origin") || SITE_URL || "";

    // ensure a Stripe customer for the org
    let customerId = org.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: org.name ?? undefined,
        metadata: { org_id: org.id },
      });
      customerId = customer.id;
      await supa.from("organizations").update({ stripe_customer_id: customerId }).eq("id", org.id);
    }

    if (action === "portal") {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${origin}/#/settings?section=billing`,
      });
      return json({ url: session.url });
    }

    if (action === "checkout") {
      const price = PRICES[plan as string];
      if (!price) return json({ error: `Unknown or unconfigured plan: ${plan}` }, 400);
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
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function handleWebhook(req: Request, sig: string): Promise<Response> {
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, WEBHOOK_SECRET);
  } catch (e) {
    return json({ error: `Webhook signature failed: ${e instanceof Error ? e.message : e}` }, 400);
  }
  const supa = admin();

  const setPlan = async (
    match: { col: string; val: string },
    patch: Record<string, unknown>
  ) => {
    await supa.from("organizations").update(patch).eq(match.col, match.val);
  };

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        await setPlan(
          { col: "id", val: String(s.metadata?.org_id) },
          {
            plan: s.metadata?.plan ?? "pro",
            plan_status: "active",
            stripe_customer_id: String(s.customer),
            stripe_subscription_id: String(s.subscription),
          }
        );
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const deleted = event.type === "customer.subscription.deleted";
        await setPlan(
          { col: "stripe_customer_id", val: String(sub.customer) },
          {
            plan: deleted ? "free" : (sub.metadata?.plan ?? "pro"),
            plan_status: deleted ? "canceled" : sub.status,
            stripe_subscription_id: sub.id,
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          }
        );
        break;
      }
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
  return json({ received: true });
}
