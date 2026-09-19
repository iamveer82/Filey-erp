# Selling Filey with Dodo Payments

Dodo Payments replaces Stripe as the way Filey is sold. Dodo is a *merchant of
record*: it takes the payment, charges the right tax for the buyer's country,
issues the invoice and pays out — so Filey never touches card data and never
has to register for VAT in a customer's jurisdiction.

Two things are for sale:

| Plan | Price | What it is | How it is enforced |
|------|-------|-----------|--------------------|
| **Basic** | AED 0 | The whole ERP on one device, 5 invoices a month | Client-side cap in `checkFreeInvoiceCap()`; the cloud refuses its writes |
| **Pro** | $5 / month | Full cloud: sync up to five registered devices, no invoice cap | `organizations.plan = 'cloud'`, set by subscription webhooks |
| **Ultra** | $100 once | Full local: unlimited, offline, two devices | A signed ECDSA token the desktop verifies with no network |

One line decides which you need: work on this machine, or work everywhere.
Basic is a real tier — every module, your own data, five invoices a month — not
a trial. Pro provides a monthly subscription; Ultra includes an offline desktop licence and web/cloud access. An Ultra owner does not need a second Pro subscription.

What the buyer sees, either way: click buy, pay on Dodo's hosted page, and the
app is on the new plan. No licence code, no email, no support ticket.

## How it fits together

```
app  ──POST {action:"checkout"}──►  dodo fn  ──►  Dodo checkout session
                                                     │
buyer pays on Dodo's hosted page  ◄──────────────────┘
        │
        ├─► Dodo webhook: payment.succeeded  ──►  dodo fn  ──►  licenses row
        │
        └─► browser returns to /#/settings?section=license&checkout=success
                   │
                   └─► claimPurchasedLicense() polls license_status, then
                       license_activate → signed ECDSA token → Ultra
```

The webhook is the **only** thing that grants a licence. The returning browser
proves nothing — it is just a hint to start polling. A buyer who closes the tab
still gets their licence; the next time they open the licence page, the
entitlement is already there and the device activates.

The licence token itself is unchanged: an ECDSA P-256 signature the desktop
verifies offline forever, issued by `_shared/license.ts`.

## Buying from the website, before you have an account

The pricing page sells both plans directly. Nobody is signed in there, so the
only thing it collects is an email:

```
gofiley.com  ──{action:"public_checkout", plan, email}──►  dodo fn  ──►  Dodo checkout
                                                                            │
buyer pays  ◄───────────────────────────────────────────────────────────────┘
     │
     ├─► webhook: no user_id, but an email
     │        ├─ that email already has a Filey account  → granted immediately
     │        └─ it does not                             → parked in pending_entitlements
     │
     └─► /thanks — "sign in to Filey with the address you paid with"
                   │
                   └─► app signs in → filey_claim_entitlements() → licence or plan
```

`public_checkout` is the one unauthenticated action on the function, so it is
written to be boring: it validates the email, picks the product id from a
two-item map rather than anything the caller sends, and rate-limits to five
attempts an hour per address. It grants nothing on its own — only the webhook
does, and only after signature verification.

**Claiming is safe because Supabase has already verified the email** of whoever
is signed in, so only the real owner of an address can collect a purchase made
against it. `pending_entitlements` has RLS on and *no policies at all*: no
client can read it, however authenticated. The claim runs through a SECURITY
DEFINER function that only ever looks at the caller's own address.

A buyer who mistypes their email gifts the purchase to whoever owns the address
they typed. That risks giving value away — never taking it from someone — which
is the right way round for this to fail, and why `/thanks` leads with the
address they paid with.

## How cloud access is enforced

`public.filey_cloud_access()` (see `2026-09-16-cloud-access.sql`) is the real
gate: a restrictive policy on every business table that lets INSERT, UPDATE and
DELETE through only for an org with a live paid plan — or one that is
grandfathered. `resolveCloudAccess()` in `src/lib/license.ts` mirrors it
exactly, and `cloud-access.test.ts` pins the pair together. If they ever
disagree, the app offers a Sync button the database then refuses.

Three deliberate properties:

- **SELECT is never gated.** Someone who stops paying keeps reading and
  exporting every row they already made. Only new cloud writes stop. Their
  books are not hostage to one missed renewal.
- **Everyone already syncing is grandfathered**, flagged once at migration
  time. They signed up when cloud was free; taking it away from a working
  business to sell them a plan is not a trade worth making. A grandfathered org
  is uncapped too, in the database and in the client, because it was uncapped
  in practice before.
- **The whole gate sits behind `platform_config.licensing_enforced`**, the same
  switch the invoice cap already uses. Until that reads `'true'`, this
  migration changes nothing — so it can ship long before you decide to charge.

Note the client constant `ENFORCE_LICENSING` in `src/lib/license.ts` is
separate and already `true`: the app caps free invoices and hides sync on its
own. The database flag is what makes the server agree.

## How the subscription differs

The Pro plan rides the same function and the same webhook endpoint. Every
`subscription.*` event restates the subscription's status, so one handler
covers activation, renewal, a failed card and cancellation — it maps the status
onto the org's plan through `_shared/billing.ts` and writes it.

Two deliberate choices there, both covered by `billing.test.ts`:

- **`past_due` and `on_hold` keep the cloud working.** A card that failed on a
  $5 renewal is a card problem, not a decision to stop. Locking someone out of
  their own invoices over one failed charge costs more than the charge.
- **An unknown future status fails closed** to free, rather than falling
  through as paid.

Renewals carry no checkout metadata, so the org is found by
`dodo_subscription_id`, which the first event records. That column is revoked
from `authenticated` like every other billing column: a member who could write
it could claim someone else's subscription and, via its unique index, keep the
paying org from ever being marked paid.

## One-time setup

Both environments are already provisioned. Test and live share nothing — separate
keys, products, webhooks, customers and payments — so each column below was
created independently.

| Thing | Live (in use) | Test |
|---|---|---|
| Ultra, one-time $100 | `pdt_0NnqAUlBQ5P8F8IERLZOF` | `pdt_0NnmhtUadaYNc1xddfHT0` |
| Pro, $5/month subscription | `pdt_0NnqAUoNM0pPYUuGHkiR5` | `pdt_0NnmhvmMYVo9Ojtd9szfD` |
| Webhook → `…functions.supabase.co/dodo` | `ep_3JU1WZmbOqNWso8U0CYFo2PPTPx` | `ep_3JRoU69y6y8qshDvaZxyrzDyiQb` |

The project's secrets point at **live mode** as of 2026-09-18. Switching back to
test means setting the test key, the test webhook secret, both test product ids
and `DODO_PAYMENTS_ENVIRONMENT=test_mode` together — a live key with a test
product id fails, and a mismatched webhook secret rejects every delivery.

The steps below are what created each environment:

1. **Products.** Dodo dashboard → Products → create two:
   - a **one-time** product for the Ultra licence at $100, and
   - a **subscription** product for Pro at $5 / month.

   Copy both ids (`pdt_…`).
2. **API key.** Developer → API keys. Start in **test mode**.
3. **Webhook.** Developer → Webhooks → new endpoint:
   `https://<project-ref>.functions.supabase.co/dodo`, subscribed to
   `payment.succeeded` **and every `subscription.*` event** (active, renewed,
   on_hold, past_due, paused, unpaused, updated, plan_changed, cancelled, expired, failed). Copy the signing
   secret (`whsec_…`).
4. **Secrets:**

   ```bash
   supabase secrets set \
     DODO_PAYMENTS_API_KEY=... \
     DODO_PAYMENTS_WEBHOOK_KEY=whsec_... \
     DODO_PAYMENTS_ENVIRONMENT=test_mode \
     DODO_PRODUCT_FREEDOM=pdt_... \
     DODO_PRODUCT_CLOUD=pdt_... \
     SITE_URL=https://gofiley.com
   ```

   `LICENSE_SIGNING_KEY` is already set from the Stripe era — the same key
   keeps every previously issued licence valid.

5. **Migrations.** Apply `supabase/2026-09-15-dodo-payments.sql` (adds
   `licenses.dodo_payment_id` and its idempotency index) and
   `supabase/2026-09-16-cloud-subscription.sql` (adds the org's Dodo customer
   and subscription ids, and revokes them from app users).
6. **Deploy:** `supabase functions deploy dodo --no-verify-jwt` — the webhook
   arrives without a Supabase JWT, and the action path verifies the user
   itself.

## Verifying before you charge anyone

With `DODO_PAYMENTS_ENVIRONMENT=test_mode`, buy each plan with a Dodo test
card. Then check, in order:

**Ultra**

- a `licenses` row exists for the buyer with `dodo_payment_id` set,
- the app flipped to Ultra without any further clicking,
- replaying the same webhook (Dodo dashboard → resend) does **not** create a
  second row — the partial unique index refuses it.

**Pro**

- the buyer's `organizations` row shows `plan = 'cloud'`, `plan_status =
  'active'`, and `dodo_subscription_id` / `dodo_customer_id` set,
- the 5-invoice free cap no longer fires (the cap function treats any plan
  other than `free` with a live status as paid),
- **Billing → Manage** opens Dodo's customer portal,
- cancelling in that portal returns the org to `plan = 'free'` on the next
  `subscription.cancelled` event.

## Going live — done 2026-09-18

The project now runs on live credentials: live key, live webhook secret, live
product ids, `DODO_PAYMENTS_ENVIRONMENT=live_mode`. Verified after the cutover
by signing a webhook with the live secret (accepted, routed, nothing written)
and with the old test secret (rejected, "No matching signature found"), and by
building a live checkout session against `checkout.dodopayments.com`.

The environment variable still defaults to `test_mode` when unset, deliberately:
a missing variable must never mean "charge real cards".

**Rotating the API key.** The key creates checkout and portal sessions and retrieves current subscription state during webhook handling. A revoked key interrupts these calls; Dodo retries failed webhook deliveries. Signature verification uses a separate webhook secret. After issuing a replacement:

```bash
supabase secrets set --project-ref voyrjqgaypiylwskkwpr DODO_PAYMENTS_API_KEY=<new key>
supabase functions deploy dodo --no-verify-jwt --project-ref voyrjqgaypiylwskkwpr
```

The redeploy matters: the client is built once at module load, so a warm worker
keeps the old key until it is recycled.

## What is left of Stripe

`supabase/functions/stripe` stays deployed but deprecated. Apps shipped before
2.11.1 call it for `license_activate` / `license_deactivate`; delete it once
those installs are gone. Its `pay_invoice` path (a customer paying an invoice
from a share link) is untouched — that is a different feature from selling
Filey, and an MoR cannot do it, since that money belongs to the tenant.

## September 19, 2026 integration audit

Live products now display Pro and Ultra with matching Filey artwork and current descriptions. Pro charges $5 monthly; its duration is 20 years, following Dodo’s ongoing subscription setup. A one-month duration with monthly frequency expires after one cycle. Customers may cancel earlier through Billing.

The new 2026-09-19-billing-integrity.sql migration makes email verification explicit, serializes subscription delivery with row locks, and prevents an older event from reactivating a cancelled entitlement. The function checks product IDs even when metadata is present, retrieves current provider state, and assigns subscriptions only to authorized workspaces. Client billing and account pages use the current workspace. Production web access uses the server filey_cloud_access gate, including workspace-owner Ultra access.

API and webhook signing secrets live only in Supabase. Never use VITE variables for them. The migration and updated function were deployed. Live negative checks rejected unauthenticated actions and invalid signatures. Regression SQL runs entirely inside a rollback; no customer business records were changed. No real payment was made. A separate sandbox purchase/renewal/cancellation acceptance pass remains required before commercial release.

The web app is deployed in Vercel's `GoFiley / filey-erp` project at `https://filey-erp.vercel.app`. The website's Open Filey buttons use that working address. Public invoice links in the web app use its current origin; no URL environment override is needed. `app.gofiley.com` has been added to Vercel, but is pending GoDaddy sign-in and the following DNS record: CNAME `app` → `84cab2e31d4c788f.vercel-dns-017.com`. After Vercel verifies DNS and HTTPS, update the website's `APP_URL` to the custom domain. Do not replace the apex website or email DNS records.

Basic remains free and has no Dodo checkout product. Its cover and the Pro/Ultra originals are in the local `output/brand/plans` folder, with the generation prompts. Both paid product images and descriptions were saved and verified through Dodo's product API.
