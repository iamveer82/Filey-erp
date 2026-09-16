# Selling Filey with Dodo Payments

Dodo Payments replaces Stripe as the way Filey is sold. Dodo is a *merchant of
record*: it takes the payment, charges the right tax for the buyer's country,
issues the invoice and pays out — so Filey never touches card data and never
has to register for VAT in a customer's jurisdiction.

Two things are for sale:

| Plan | Price | What it is | How it is enforced |
|------|-------|-----------|--------------------|
| **Cloud** | $1 / month | Unlimited hosted invoices and sync across devices | `organizations.plan = 'cloud'`, set by subscription webhooks |
| **Freedom** | AED 1,499 once | Own it outright; works offline on two devices | A signed ECDSA token the desktop verifies with no network |

Free is untouched: the whole ERP locally, cloud sync included, capped at 5
hosted invoices a month. Cloud lifts the cap rather than unlocking the cloud —
nobody signed in today loses anything.

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
                       license_activate → signed ECDSA token → Freedom
```

The webhook is the **only** thing that grants a licence. The returning browser
proves nothing — it is just a hint to start polling. A buyer who closes the tab
still gets their licence; the next time they open the licence page, the
entitlement is already there and the device activates.

The licence token itself is unchanged: an ECDSA P-256 signature the desktop
verifies offline forever, issued by `_shared/license.ts`.

## How the subscription differs

The Cloud plan rides the same function and the same webhook endpoint. Every
`subscription.*` event restates the subscription's status, so one handler
covers activation, renewal, a failed card and cancellation — it maps the status
onto the org's plan through `_shared/billing.ts` and writes it.

Two deliberate choices there, both covered by `billing.test.ts`:

- **`past_due` and `on_hold` keep the cloud working.** A card that failed on a
  $1 renewal is a card problem, not a decision to stop. Locking someone out of
  their own invoices over a dollar costs more than the dollar.
- **An unknown future status fails closed** to free, rather than falling
  through as paid.

Renewals carry no checkout metadata, so the org is found by
`dodo_subscription_id`, which the first event records. That column is revoked
from `authenticated` like every other billing column: a member who could write
it could claim someone else's subscription and, via its unique index, keep the
paying org from ever being marked paid.

## One-time setup

1. **Products.** Dodo dashboard → Products → create two:
   - a **one-time** product for the Freedom licence at AED 1,499, and
   - a **subscription** product for Cloud at $1 / month.

   Copy both ids (`pdt_…`).
2. **API key.** Developer → API keys. Start in **test mode**.
3. **Webhook.** Developer → Webhooks → new endpoint:
   `https://<project-ref>.functions.supabase.co/dodo`, subscribed to
   `payment.succeeded` **and every `subscription.*` event** (active, renewed,
   on_hold, past_due, paused, cancelled, expired, failed). Copy the signing
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

**Freedom**

- a `licenses` row exists for the buyer with `dodo_payment_id` set,
- the app flipped to Freedom without any further clicking,
- replaying the same webhook (Dodo dashboard → resend) does **not** create a
  second row — the partial unique index refuses it.

**Cloud**

- the buyer's `organizations` row shows `plan = 'cloud'`, `plan_status =
  'active'`, and `dodo_subscription_id` / `dodo_customer_id` set,
- the 5-invoice free cap no longer fires (the cap function treats any plan
  other than `free` with a live status as paid),
- **Billing → Manage** opens Dodo's customer portal,
- cancelling in that portal returns the org to `plan = 'free'` on the next
  `subscription.cancelled` event.

## Going live

Swap the API key for the live one and set
`DODO_PAYMENTS_ENVIRONMENT=live_mode`. A live webhook endpoint has its own
signing secret, so update `DODO_PAYMENTS_WEBHOOK_KEY` too. The environment
variable defaults to `test_mode` when unset, deliberately: a missing variable
must never mean "charge real cards".

## What is left of Stripe

`supabase/functions/stripe` stays deployed but deprecated. Apps shipped before
2.11.1 call it for `license_activate` / `license_deactivate`; delete it once
those installs are gone. Its `pay_invoice` path (a customer paying an invoice
from a share link) is untouched — that is a different feature from selling
Filey, and an MoR cannot do it, since that money belongs to the tenant.
