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
// One-time desktop license (Lite tier).
const PRICE_LITE = Deno.env.get("STRIPE_PRICE_LITE");
// ECDSA P-256 private key (PKCS8, base64) — signs desktop license tokens.
const LICENSE_SIGNING_KEY = Deno.env.get("LICENSE_SIGNING_KEY") ?? "";
const LICENSE_DEVICE_SLOTS = 2;

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

  const origin = req.headers.get("origin") || SITE_URL || "";
  const payload = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = String(payload.action ?? "");

  try {
    // PUBLIC: a customer paying a shared invoice (no Filey account / JWT).
    if (action === "pay_invoice") return await payInvoice(String(payload.token ?? ""), origin);

    // AUTHENTICATED actions below (the account owner).
    const supa = admin();
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u } = await supa.auth.getUser(jwt);
    const user = u?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    // Desktop license actions don't need an org — they attach to the user.
    if (action === "license_activate")
      return await licenseActivate(
        supa,
        user,
        String(payload.fingerprint ?? ""),
        String(payload.device_name ?? "")
      );
    if (action === "license_deactivate")
      return await licenseDeactivate(supa, user.id, String(payload.fingerprint ?? ""));

    const org = await userOrg(supa, user.id);
    if (!org) return json({ error: "No organization found" }, 400);

    const plan = payload.plan;

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

    // One-time desktop license (Lite). invoice_creation makes Stripe email a
    // proper invoice for the one-off payment (subscriptions do this natively).
    if (action === "checkout_lite") {
      if (!PRICE_LITE) return json({ error: "Lite price not configured" }, 400);
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

/* ---------------- desktop license: activation + signing ---------------- */

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** Sign a license payload with the server-only ECDSA P-256 key. The desktop
 *  app verifies with the embedded public key — fully offline afterwards. */
async function signLicense(payload: Record<string, unknown>): Promise<string> {
  if (!LICENSE_SIGNING_KEY) throw new Error("LICENSE_SIGNING_KEY not configured");
  const pkcs8 = Uint8Array.from(atob(LICENSE_SIGNING_KEY), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, body);
  return `${b64url(body)}.${b64url(new Uint8Array(sig))}`;
}

async function licenseActivate(
  supa: ReturnType<typeof admin>,
  user: { id: string; email?: string | null },
  fingerprint: string,
  deviceName: string
): Promise<Response> {
  if (!fingerprint) return json({ error: "Missing device fingerprint" }, 400);
  const { data: lic } = await supa
    .from("licenses")
    .select("id, product, status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!lic) return json({ error: "No active license on this account" }, 404);

  const { data: devices } = await supa
    .from("license_devices")
    .select("id, fingerprint, deactivated_at")
    .eq("license_id", lic.id);
  const active = (devices ?? []).filter((d) => !d.deactivated_at);
  const mine = (devices ?? []).find((d) => d.fingerprint === fingerprint);

  if (mine?.deactivated_at) {
    // Re-activating a freed slot — only if a slot is open.
    if (active.length >= LICENSE_DEVICE_SLOTS)
      return json({ error: `All ${LICENSE_DEVICE_SLOTS} device slots are in use. Deactivate another device first.` }, 409);
    await supa
      .from("license_devices")
      .update({ deactivated_at: null, activated_at: new Date().toISOString(), device_name: deviceName || null })
      .eq("id", mine.id);
  } else if (!mine) {
    if (active.length >= LICENSE_DEVICE_SLOTS)
      return json({ error: `All ${LICENSE_DEVICE_SLOTS} device slots are in use. Deactivate another device first.` }, 409);
    const { error } = await supa.from("license_devices").insert({
      license_id: lic.id,
      fingerprint,
      device_name: deviceName || null,
    });
    if (error) return json({ error: error.message }, 500);
  }

  const token = await signLicense({
    email: user.email ?? "",
    product: lic.product,
    issued: new Date().toISOString().slice(0, 10),
    device_id: fingerprint,
    license_id: lic.id,
  });
  return json({ token });
}

async function licenseDeactivate(
  supa: ReturnType<typeof admin>,
  userId: string,
  fingerprint: string
): Promise<Response> {
  if (!fingerprint) return json({ error: "Missing device fingerprint" }, 400);
  const { data: lic } = await supa
    .from("licenses")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!lic) return json({ error: "No active license on this account" }, 404);
  await supa
    .from("license_devices")
    .update({ deactivated_at: new Date().toISOString() })
    .eq("license_id", lic.id)
    .eq("fingerprint", fingerprint);
  return json({ ok: true });
}

async function invoiceBalance(supa: ReturnType<typeof admin>, docId: number) {
  const [{ data: doc }, { data: items }, { data: pays }] = await Promise.all([
    supa.from("invoice_docs").select("*").eq("id", docId).maybeSingle(),
    supa.from("invoice_doc_items").select("qty,unit_price").eq("invoice_id", docId),
    supa.from("invoice_payments").select("amount").eq("invoice_id", docId),
  ]);
  if (!doc) return null;
  const subtotal = (items ?? []).reduce(
    (s: number, i: { qty: number; unit_price: number }) => s + Number(i.qty) * Number(i.unit_price),
    0
  );
  const taxable = Math.max(0, subtotal - Number(doc.discount || 0));
  const total = taxable + (taxable * Number(doc.tax_rate || 0)) / 100;
  const paid = (pays ?? []).reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0);
  return { doc, total, paid, balance: Math.round((total - paid) * 100) / 100 };
}

// Public: create a one-off Checkout for the outstanding balance of a shared invoice.
async function payInvoice(token: string, origin: string): Promise<Response> {
  if (!token) return json({ error: "Missing token" }, 400);
  const supa = admin();
  const { data: doc } = await supa
    .from("invoice_docs")
    .select("id, number, currency, shared")
    .eq("share_token", token)
    .eq("shared", true)
    .maybeSingle();
  if (!doc) return json({ error: "Invoice not found or not shared" }, 404);
  const bal = await invoiceBalance(supa, doc.id);
  if (!bal || bal.balance <= 0) return json({ error: "This invoice is already paid." }, 400);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: String(doc.currency || "AED").toLowerCase(),
          product_data: { name: `Invoice ${doc.number}` },
          unit_amount: Math.round(bal.balance * 100),
        },
        quantity: 1,
      },
    ],
    success_url: `${origin}/#/portal/${token}?paid=1`,
    cancel_url: `${origin}/#/portal/${token}`,
    metadata: { type: "invoice_payment", invoice_id: String(doc.id) },
  });
  return json({ url: session.url });
}

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
        // A customer paid a shared invoice → record the payment.
        if (s.metadata?.type === "invoice_payment") {
          const invId = Number(s.metadata.invoice_id);
          const { data: doc } = await supa
            .from("invoice_docs")
            .select("user_id, org_id")
            .eq("id", invId)
            .maybeSingle();
          await supa.from("invoice_payments").insert({
            invoice_id: invId,
            amount: (s.amount_total ?? 0) / 100,
            method: "card",
            paid_at: new Date().toISOString(),
            user_id: doc?.user_id,
            org_id: doc?.org_id,
          });
          const bal = await invoiceBalance(supa, invId);
          if (bal && bal.balance <= 0)
            await supa.from("invoice_docs").update({ status: "paid" }).eq("id", invId);
          break;
        }
        // A one-time desktop license purchase → issue the license.
        if (s.metadata?.type === "lite_license") {
          await supa.from("licenses").insert({
            user_id: s.metadata.user_id,
            product: "filey-desktop",
            status: "active",
            stripe_payment_intent: String(s.payment_intent ?? ""),
          });
          break;
        }
        // Otherwise it's a subscription checkout → set the org's plan.
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
