// Filey — Dodo Payments edge function (Deno).
//
// Sells both plans and turns a completed payment into an entitlement the app
// can see, so the plan flips on its own:
//
//   • POST { action: "checkout" }            → Freedom licence (one-time)
//   • POST { action: "checkout_cloud" }      → Cloud subscription ($1/month)
//   • POST { action: "portal" }              → Dodo customer portal (cancel, cards)
//   • POST { action: "license_status" }      → { licensed } — polled after checkout
//   • POST { action: "license_activate" }    → signed offline licence token
//   • POST { action: "license_deactivate" }  → frees a device slot
//   • POST (with webhook-signature header)   → Dodo webhook: grant licence / set plan
//
// Dodo is a merchant of record: it bills, charges tax and pays out, so nothing
// here touches card data. The webhook is the only thing that may grant a
// licence — a client claiming "I paid" proves nothing.
//
// Secrets:
//   DODO_PAYMENTS_API_KEY, DODO_PAYMENTS_WEBHOOK_KEY,
//   DODO_PAYMENTS_ENVIRONMENT (test_mode | live_mode — defaults to test_mode),
//   DODO_PRODUCT_FREEDOM (product id of the Freedom licence),
//   DODO_PRODUCT_CLOUD (product id of the $1/month Cloud subscription),
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
import { buyerOf, planPatchFor, type DodoPurchase } from "../_shared/billing.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_KEY = Deno.env.get("DODO_PAYMENTS_API_KEY") ?? "";
const WEBHOOK_KEY = Deno.env.get("DODO_PAYMENTS_WEBHOOK_KEY") ?? "";
const PRODUCT_FREEDOM = Deno.env.get("DODO_PRODUCT_FREEDOM") ?? "";
const PRODUCT_CLOUD = Deno.env.get("DODO_PRODUCT_CLOUD") ?? "";
const SITE_URL = Deno.env.get("SITE_URL") ?? "";
/** The org plan value a live Cloud subscription sets. Any value other than
 *  "free" already lifts the server-side invoice cap and reads as paid in
 *  resolveTier(), so nothing else has to learn this name. */
const CLOUD_PLAN = "cloud";

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

/** The org this user bills for: their membership first, then an org they own. */
async function userOrg(supa: ReturnType<typeof admin>, userId: string) {
  const { data: member } = await supa
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  let orgId = member?.org_id as string | undefined;
  if (!orgId) {
    const { data: owned } = await supa
      .from("organizations")
      .select("id")
      .eq("owner_id", userId)
      .limit(1)
      .maybeSingle();
    orgId = owned?.id as string | undefined;
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
  if (req.headers.get("webhook-signature")) return handleWebhook(req);

  const payload = await req.json().catch(() => ({}) as Record<string, unknown>);
  const action = String(payload.action ?? "");

  try {
    const supa = admin();

    // PUBLIC: buying from the website, where there is no account yet. The
    // purchase is parked against the email and claimed at first sign-in, so
    // this grants nothing by itself and needs no session.
    if (action === "public_checkout") return await publicCheckout(supa, payload);

    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await supa.auth.getUser(jwt);
    const user = u?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    // Signed-in checkouts come from the app or from gofiley.com; /thanks words
    // the next step differently for each.
    const fromApp = payload.from === "web" ? "" : "&from=app";

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
        return json({ error: "This account already owns Ultra." }, 409);

      // SECURITY: the redirect target comes from SITE_URL, never the caller's
      // Origin header — otherwise the checkout doubles as an open redirect.
      const base = SITE_URL || "";
      const session = await dodo.checkoutSessions.create({
        product_cart: [{ product_id: PRODUCT_FREEDOM, quantity: 1 }],
        customer: { email: user.email ?? "", name: String(payload.name ?? "") || undefined },
        // The webhook is what grants the licence; this metadata is how it knows
        // whose account to grant it to.
        metadata: { type: "freedom_license", user_id: user.id },
        return_url: base ? `${base}/thanks?plan=freedom${fromApp}` : undefined,
        cancel_url: base ? `${base}/#pricing` : undefined,
      });
      if (!session.checkout_url) return json({ error: "Dodo returned no checkout URL" }, 502);
      return json({ url: session.checkout_url, session_id: session.session_id });
    }

    if (action === "checkout_cloud") {
      if (!API_KEY) return json({ error: "Payments are not configured yet." }, 503);
      if (!PRODUCT_CLOUD) return json({ error: "Cloud plan not configured" }, 503);
      const org = await userOrg(supa, user.id);
      if (!org) return json({ error: "No organisation found for this account." }, 404);

      const base = SITE_URL || "";
      const session = await dodo.checkoutSessions.create({
        product_cart: [{ product_id: PRODUCT_CLOUD, quantity: 1 }],
        customer: { email: user.email ?? "" },
        // org_id is how the webhook knows whose cloud to switch on; the
        // subscription carries it forward to every renewal event.
        metadata: { type: "cloud_subscription", org_id: String(org.id), user_id: user.id },
        return_url: base ? `${base}/thanks?plan=cloud${fromApp}` : undefined,
        cancel_url: base ? `${base}/#pricing` : undefined,
      });
      if (!session.checkout_url) return json({ error: "Dodo returned no checkout URL" }, 502);
      return json({ url: session.checkout_url, session_id: session.session_id });
    }

    // Cancelling, changing the card, downloading invoices — all Dodo's, since
    // Dodo is the merchant of record and owns the billing relationship.
    if (action === "portal") {
      const org = await userOrg(supa, user.id);
      const customerId = org?.dodo_customer_id as string | undefined;
      if (!customerId)
        return json({ error: "No subscription on this workspace yet." }, 404);
      const portal = await dodo.customers.customerPortal.create(customerId);
      if (!portal.link) return json({ error: "Dodo returned no portal link" }, 502);
      return json({ url: portal.link });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Checkout for someone who has no Filey account yet (the pricing page).
 *
 *  Unauthenticated on purpose, so it is written to be boring: it validates the
 *  email, picks the product from a two-item map rather than anything the
 *  caller sends, and rate-limits per address. Nothing it does grants access —
 *  the webhook parks the purchase and the app claims it at first sign-in. */
async function publicCheckout(
  supa: ReturnType<typeof admin>,
  payload: Record<string, unknown>
): Promise<Response> {
  if (!API_KEY) return json({ error: "Payments are not configured yet." }, 503);
  const plan = String(payload.plan ?? "");
  const email = String(payload.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 320)
    return json({ error: "Enter a valid email address." }, 400);

  const product = plan === "cloud" ? PRODUCT_CLOUD : plan === "freedom" ? PRODUCT_FREEDOM : "";
  if (!product) return json({ error: `Unknown plan: ${plan}` }, 400);

  // An open endpoint that creates sessions upstream needs a ceiling. Keyed by
  // the email, which is the only identity a stranger has here.
  const allowed = await rateLimit(supa, `web:${email}`, "dodo_public_checkout", 5, 3600);
  if (!allowed) return json({ error: "Too many attempts — try again later." }, 429);
  await logAction(supa, `web:${email}`, "dodo_public_checkout", { plan });

  const base = SITE_URL || "";
  const session = await dodo.checkoutSessions.create({
    product_cart: [{ product_id: product, quantity: 1 }],
    customer: { email },
    // No user_id: the webhook parks this against the email instead.
    metadata: { type: plan === "cloud" ? "cloud_subscription" : "freedom_license", email, source: "website" },
    return_url: base ? `${base}/thanks?plan=${plan}` : undefined,
    cancel_url: base ? `${base}/#pricing` : undefined,
  });
  if (!session.checkout_url) return json({ error: "Dodo returned no checkout URL" }, 502);
  return json({ url: session.checkout_url, session_id: session.session_id });
}

/** Park a website purchase against the buyer's email, or grant it outright if
 *  that email already belongs to a Filey account. */
async function parkOrGrant(
  supa: ReturnType<typeof admin>,
  kind: "cloud" | "freedom",
  email: string,
  refs: { payment_id?: string; subscription_id?: string; customer_id?: string }
): Promise<string> {
  const { data: user } = await supa
    .from("filey_users_by_email")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (user?.id && kind === "freedom" && refs.payment_id) {
    const outcome = await grantLicense(supa, String(user.id), refs.payment_id);
    if (outcome !== "duplicate") return `granted to existing account (${outcome})`;
    return "duplicate";
  }

  const { error } = await supa.from("pending_entitlements").insert({
    email: email.toLowerCase(),
    kind,
    dodo_payment_id: refs.payment_id ?? null,
    dodo_subscription_id: refs.subscription_id ?? null,
    dodo_customer_id: refs.customer_id ?? null,
  });
  // A duplicate delivery hits the unique index; that is the idempotency, not
  // an error worth retrying.
  if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message);
  return error ? "already parked" : "parked for first sign-in";
}

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

  // Subscriptions: every lifecycle event restates the status, so one handler
  // covers activation, renewal, a failed card and cancellation alike.
  if (event.type.startsWith("subscription.")) return await handleSubscription(event.data);

  // Everything else (disputes, refunds) is recorded by Dodo; only a completed
  // payment changes what this app lets someone do.
  if (event.type !== "payment.succeeded") return json({ received: true, ignored: event.type });

  const data = event.data;

  // A subscription's first charge arrives here too; the subscription events
  // own that plan, so this path only handles the one-time licence. buyerOf
  // also recognises purchases from Dodo's storefront and payment links, which
  // carry none of our metadata.
  const buyer = buyerOf(data as DodoPurchase, PRODUCT_FREEDOM, "freedom_license");
  if (!buyer || !data.payment_id)
    return json({ received: true, ignored: "not an Ultra licence purchase" });

  try {
    // No account attached (the website, the storefront): park it against the
    // email, or grant it now if that email already has an account.
    if (!buyer.userId) {
      if (!buyer.email) return json({ received: true, ignored: "purchase with no buyer" });
      const outcome = await parkOrGrant(admin(), "freedom", buyer.email, {
        payment_id: data.payment_id,
      });
      return json({ received: true, outcome });
    }
    const outcome = await grantLicense(admin(), buyer.userId, data.payment_id);
    return json({ received: true, outcome });
  } catch (e) {
    // 500 asks Dodo to retry, which is what we want: the buyer has paid and
    // has no licence yet.
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

/** Put an org on (or off) the Cloud plan from a subscription event.
 *
 *  Events can arrive out of order — a retry of `subscription.active` can land
 *  after `subscription.cancelled` — so the org is matched by subscription id
 *  once it is known, and the row records which subscription set it. */
async function handleSubscription(payload: unknown): Promise<Response> {
  // The SDK's event union is wide; read the four fields this needs by name
  // rather than pretending the whole union is one shape.
  const data = (payload ?? {}) as {
    subscription_id?: string;
    status?: string;
    next_billing_date?: string;
    metadata?: Record<string, string>;
    customer?: { customer_id?: string };
  };
  const subscriptionId = String(data.subscription_id ?? "");
  const status = String(data.status ?? "");
  const nextBilling = data.next_billing_date ? String(data.next_billing_date) : null;
  const meta = data.metadata ?? {};
  const customer = data.customer ?? {};
  // Storefront / payment-link subscriptions carry no metadata: the product
  // and Dodo's customer email stand in for it.
  const buyer = buyerOf(payload as DodoPurchase, PRODUCT_CLOUD, "cloud_subscription");
  if (!subscriptionId || !status)
    return json({ received: true, ignored: "subscription event without id or status" });

  const supa = admin();
  // The checkout metadata names the org on the first event; later events for
  // the same subscription find it by id, so a renewal needs no metadata.
  let orgId = meta.org_id ?? "";
  if (!orgId) {
    const { data: found } = await supa
      .from("organizations")
      .select("id")
      .eq("dodo_subscription_id", subscriptionId)
      .limit(1)
      .maybeSingle();
    orgId = (found?.id as string) ?? "";
  }
  if (!orgId) {
    // A website subscription has no org yet. Park it against the email so the
    // first sign-in switches that workspace on — but only while the
    // subscription is one that grants something; a cancellation for an
    // unclaimed purchase has nothing to park.
    if (buyer?.email && planPatchFor(status, nextBilling, CLOUD_PLAN).plan !== "free") {
      const outcome = await parkOrGrant(supa, "cloud", buyer.email, {
        subscription_id: subscriptionId,
        customer_id: customer.customer_id,
      });
      return json({ received: true, outcome });
    }
    return json({ received: true, ignored: "no organisation for this subscription" });
  }

  const patch = planPatchFor(status, nextBilling, CLOUD_PLAN);
  const { error } = await supa
    .from("organizations")
    .update({
      ...patch,
      dodo_subscription_id: subscriptionId,
      ...(customer.customer_id ? { dodo_customer_id: customer.customer_id } : {}),
    })
    .eq("id", orgId);
  // 500 so Dodo retries: an org left on the wrong plan either loses access it
  // paid for or keeps access it stopped paying for.
  if (error) return json({ error: error.message }, 500);
  return json({ received: true, org: orgId, plan: patch.plan, status: patch.plan_status });
}
