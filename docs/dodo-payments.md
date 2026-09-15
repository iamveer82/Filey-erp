# Selling the Freedom licence with Dodo Payments

Dodo Payments replaces Stripe as the way Filey is sold. Dodo is a *merchant of
record*: it takes the payment, charges the right tax for the buyer's country,
issues the invoice and pays out — so Filey never touches card data and never
has to register for VAT in a customer's jurisdiction.

What the buyer sees: click **Buy desktop license**, pay on Dodo's hosted page,
come back to Filey, and the app is on Freedom. No licence code, no email, no
support ticket.

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

## One-time setup

1. **Product.** Dodo dashboard → Products → create a **one-time** product for
   the Freedom licence at AED 1,499. Copy its id (`pdt_…`).
2. **API key.** Developer → API keys. Start in **test mode**.
3. **Webhook.** Developer → Webhooks → new endpoint:
   `https://<project-ref>.functions.supabase.co/dodo`, subscribed to
   `payment.succeeded`. Copy the signing secret (`whsec_…`).
4. **Secrets:**

   ```bash
   supabase secrets set \
     DODO_PAYMENTS_API_KEY=... \
     DODO_PAYMENTS_WEBHOOK_KEY=whsec_... \
     DODO_PAYMENTS_ENVIRONMENT=test_mode \
     DODO_PRODUCT_FREEDOM=pdt_... \
     SITE_URL=https://gofiley.com
   ```

   `LICENSE_SIGNING_KEY` is already set from the Stripe era — the same key
   keeps every previously issued licence valid.

5. **Migration.** Apply `supabase/2026-09-15-dodo-payments.sql` (adds
   `licenses.dodo_payment_id` and its idempotency index).
6. **Deploy:** `supabase functions deploy dodo --no-verify-jwt` — the webhook
   arrives without a Supabase JWT, and the action path verifies the user
   itself.

## Verifying before you charge anyone

With `DODO_PAYMENTS_ENVIRONMENT=test_mode`, buy the licence with a Dodo test
card. Then check, in order:

- a `licenses` row exists for the buyer with `dodo_payment_id` set,
- the app flipped to Freedom without any further clicking,
- replaying the same webhook (Dodo dashboard → resend) does **not** create a
  second row — the partial unique index refuses it.

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
