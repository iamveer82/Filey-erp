import { appCheckoutReturn } from "../_shared/checkout-return.ts";
// Filey — Dodo Payments edge function (Deno).
//
// Sells both plans and turns a completed payment into an entitlement the app
// can see, so the plan flips on its own:
//
//   • POST { action: "checkout" }            → Freedom licence (one-time)
//   • POST { action: "checkout_cloud" }      → Cloud subscription ($5/month)
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
//   DODO_PRODUCT_CLOUD (product id of the $5/month Cloud subscription),
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
import { createCreditCheckout, reconcileCreditPayment } from "../_shared/ai-credit-payments.ts";
import { subscriptionRefundAction, reconcileSubscriptionRefund } from "../_shared/subscription-refunds.ts";

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

/** Billing follows the profile workspace, with an explicit owner/admin check. */
async function userOrg(supa: ReturnType<typeof admin>, userId: string) {
  const { data: profile, error: profileError } = await supa.from("profiles")
    .select("org_id").eq("id", userId).maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.org_id) return null;
  const { data: org, error } = await supa.from("organizations")
    .select("*").eq("id", profile.org_id).maybeSingle();
  if (error) throw error;
  if (!org) return null;
  if (org.owner_id === userId) return org;
  const { data: member, error: memberError } = await supa.from("org_members")
    .select("role").eq("org_id", profile.org_id).eq("user_id", userId).maybeSingle();
  if (memberError) throw memberError;
  return member?.role === "admin" || member?.role === "owner" ? org : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
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

    const billingRead = action === "subscription_refunds" || action === "subscription_refund_payments";
    const allowed = await rateLimit(supa, user.id, billingRead ? "dodo_read" : "dodo_action", billingRead ? 120 : 20, 3600);
    if (!allowed) return json({ error: "Rate limit exceeded — try again later." }, 429);
    await logAction(supa, user.id, "dodo_action", { action });

    // Account-owned and available on every tier, independently of org billing.
    if (action === "checkout_ai_credits") {
      if (!API_KEY) return json({ error: "Payments are not configured yet." }, 503);
      return json(await createCreditCheckout(dodo, supa, user, payload.pack_id, payload.amount_cents));
    }

    if (["subscription_refunds", "subscription_refund_payments", "request_subscription_refund", "review_subscription_refund", "refresh_subscription_refund"].includes(action)) {
      if (!API_KEY) return json({ error: "Payments are not configured yet." }, 503);
      return json(await subscriptionRefundAction(dodo, supa, user.id, await userOrg(supa, user.id), payload));
    }

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
        return_url: payload.from === "app" ? appCheckoutReturn({ section: "billing", plan: "ultra", checkout: "success" }) : base ? `${base}/thanks?plan=freedom${fromApp}` : undefined,
        cancel_url: payload.from === "app" ? appCheckoutReturn({ section: "billing", checkout: "cancel" }) : base ? `${base}/#pricing` : undefined,
      });
      if (!session.checkout_url) return json({ error: "Dodo returned no checkout URL" }, 502);
      return json({ url: session.checkout_url, session_id: session.session_id });
    }

    if (action === "checkout_cloud") {
      if (!API_KEY) return json({ error: "Payments are not configured yet." }, 503);
      if (!PRODUCT_CLOUD) return json({ error: "Cloud plan not configured" }, 503);
      const org = await userOrg(supa, user.id);
      if (!org) return json({ error: "Only the workspace owner or an admin can manage billing." }, 403);
      if (org.plan !== "free" && ["active", "trialing", "past_due"].includes(org.plan_status))
        return json({ error: "This workspace already has a paid plan. Use Manage billing." }, 409);
      const owned = await licenseStatus(supa, String(org.owner_id));
      if (owned.body.licensed)
        return json({ error: "This workspace already includes cloud access through Ultra." }, 409);

      const base = SITE_URL || "";
      const session = await dodo.checkoutSessions.create({
        product_cart: [{ product_id: PRODUCT_CLOUD, quantity: 1 }],
        customer: { email: user.email ?? "" },
        // org_id is how the webhook knows whose cloud to switch on; the
        // subscription carries it forward to every renewal event.
        metadata: { type: "cloud_subscription", org_id: String(org.id), user_id: user.id },
        return_url: payload.from === "app" ? appCheckoutReturn({ section: "billing", plan: "cloud", checkout: "success" }) : base ? `${base}/thanks?plan=cloud${fromApp}` : undefined,
        cancel_url: payload.from === "app" ? appCheckoutReturn({ section: "billing", checkout: "cancel" }) : base ? `${base}/#pricing` : undefined,
      });
      if (!session.checkout_url) return json({ error: "Dodo returned no checkout URL" }, 502);
      return json({ url: session.checkout_url, session_id: session.session_id });
    }

    // Cancelling, changing the card, downloading invoices — all Dodo's, since
    // Dodo is the merchant of record and owns the billing relationship.
    if (action === "portal") {
      const org = await userOrg(supa, user.id);
      if (!org) return json({ error: "Only the workspace owner or an admin can manage billing." }, 403);
      const customerId = org.dodo_customer_id as string | undefined;
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
  // There is no account UUID yet; the service-only limiter records this
  // attempt. audit_log.user_id accepts real account UUIDs only.

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
  if (event.type.startsWith("subscription.")) {
    try { return await handleSubscription(event.data, event.timestamp); }
    catch { return json({ error: "Could not update subscription. Delivery will be retried." }, 500); }
  }

  if ((event.type === "payment.succeeded" && (event.data as { metadata?: { type?: string } }).metadata?.type === "ai_credits") || event.type.startsWith("refund.") || event.type.startsWith("dispute.")) {
    const paymentId = (event.data as { payment_id?: string }).payment_id;
    if (paymentId) {
      try {
        if (await reconcileCreditPayment(dodo, admin(), paymentId)) return json({ received: true, credits: true });
        if (event.type.startsWith("refund.") && await reconcileSubscriptionRefund(dodo, admin(), paymentId))
          return json({ received: true, subscription_refund: true });
      }
      catch { return json({ error: "Payment reconciliation failed. Delivery will be retried." }, 500); }
    }
  }

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

/** Read current provider state, then atomically order deliveries and claims. */
async function handleSubscription(payload: unknown, timestamp: string): Promise<Response> {
  const id = String((payload as { subscription_id?: string })?.subscription_id ?? "");
  if (!id || !Number.isFinite(Date.parse(timestamp)))
    return json({ error: "Subscription event lacks an id or timestamp." }, 400);
  const data = await dodo.subscriptions.retrieve(id);
  const buyer = buyerOf(data as DodoPurchase, PRODUCT_CLOUD, "cloud_subscription");
  if (!buyer) return json({ received: true, ignored: "unrelated product" });
  const patch = planPatchFor(data.status, data.next_billing_date, CLOUD_PLAN);
  const { data: outcome, error } = await admin().rpc("filey_apply_dodo_subscription", {
    p_subscription: id, p_email: buyer.email?.trim().toLowerCase() ?? "",
    p_customer: data.customer?.customer_id ?? null,
    p_org: buyer.orgId ?? null, p_user: buyer.userId ?? null,
    p_status: patch.plan_status, p_period_end: patch.current_period_end,
    p_event_at: timestamp,
  });
  if (error) throw error;
  return json({ received: true, outcome });
}
