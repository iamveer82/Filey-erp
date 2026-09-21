# Filey AI Credits

Optional on **Basic, Pro and Ultra**, independent of a subscription and owned by
the signed-in Supabase account. Changing workspace or plan does not move money.
The default remains the user's own API key/local model. Selecting credits is
explicit; failed BYOK/free requests never start paid requests. Free models are available on every plan without a wallet balance.

## User flow

- Settings → AI Credits: available balance, one-time top-ups, model rates,
  per-task/daily spending limits, and paginated usage/top-up/refund history.
- The chat composer and AI settings expose the funding/model selector.
- Credit mode covers text, vision and the existing agent's function tools,
  including delegated rounds. Separate image generation, voice and third-party
  services retain their own connections. Background proactive sweeps do not
  spend credits; explicitly scheduled agent tasks use the selected mode.
- Free AI lists live, zero-priced OpenRouter models that support function tools,
  including `openrouter/free` for automatic selection. Each verified account
  gets up to 20 provider requests per 24-hour window, subject to the provider's
  shared quota and availability. Agent tasks may use several requests. Free
  mode never falls back to a paid model or touches the wallet.
- All amounts are USD. Each top-up adds a flat $0.50 service fee: $5.50 buys $5
  of credit, before applicable taxes. The fee is recorded separately and is not
  spendable. Provider usage has no default Filey markup and is charged to six
  decimal places, rounded up. Paid credits have no expiration or auto-top-up.
  AI credits are excluded from Filey's subscription refund program. There is no
  customer credit-refund action. Provider reversals/disputes still reconcile the
  ledger so reversed money cannot be spent. The service fee is not net profit: payment
  fees, taxes, provider overhead and absorbed failures still affect margin.
  Daily limits reset at midnight UTC. Defaults: $1/task and $5/day.
- A task reserves a conservative input/output allowance before each model call.
  Long/vision prompts can need a larger available allowance than their eventual
  charge. Actual provider-reported cost settles the reservation; unused funds
  return immediately. Stop prevents further rounds, but already executed model
  work can be charged. Maximum output is 8,192 tokens per call.

## Deployment

1. Apply `supabase/2026-09-20-ai-credits.sql`. It only adds new credit tables,
   indexes, RLS and one service-only RPC; it does not change business records.
2. Store a funded OpenRouter key as **FILEY_AI_OPENROUTER_KEY** in Supabase Edge
   Function secrets. Never use a VITE variable or commit a provider key.
3. Set **FILEY_AI_MARKUP_BPS** to `0` (the default). The $0.50 fee is collected only at top-up, not again on usage.
   Optional **FILEY_AI_MODELS** is a comma-separated allowlist of OpenRouter IDs.
   The default list is in `supabase/functions/ai-credits/index.ts`. The live
   catalogue filters unavailable models and unsupported pricing/capabilities.
4. Apply `supabase/2026-09-21-ai-credit-topup-fee.sql` before deploying the checkout handler. Create one-time Dodo products for $5, $10 and $25 AI credit top-ups, priced at **$5.50, $10.50 and $25.50** respectively in
   USD, with no discounts, recurring billing or pay-what-you-want. Set the
   **DODO_AI_CREDIT_PACKS** secret to a JSON array of their real IDs and spendable credit cents (excluding the fee):
   `[{"id":"pdt_REPLACE","cents":500}]`. This illustrative ID is not a product.
   Checkout verifies that the provider's product price equals credit + 50 cents before creating an order. Use a product name/description that clearly shows both credit and fee.
   Dodo handles checkout tax; tax is not credited as spendable AI balance.
5. Set **FILEY_APP_URL** to the hosted app origin (default
   `https://app.gofiley.com`). Keep existing Dodo API/webhook/environment secrets.
6. Deploy `ai-credits` and the updated `dodo` with `--no-verify-jwt`. Both handlers
   validate authentication themselves; only Dodo's signed webhook is public.
7. The existing Dodo webhook must include `payment.succeeded`, all `refund.*`
   and all `dispute.*` events. Reconciliation retrieves current provider payment
   state and all succeeded refunds, so out-of-order events converge safely.
8. Complete a Dodo **test-mode** checkout and refund against a non-production
   database, then test one funded model call before enabling sales in production.
   Never test by creating/deleting a customer's invoices or other ERP records.

Without the provider key or products, checkout remains unavailable. Free models need a valid key but no published payment products or customer credit. The UI
reports that setup is incomplete, while BYOK/local models continue working.
Do not call this integration live until secrets, webhook subscriptions, products,
deployment and the funded provider checkout tests have all been verified.

## Accounting and security

`ai_credit_accounts`, `ai_credit_orders`, `ai_credit_requests`, and
`ai_credit_ledger` stay in the hosted database; they are never part of local sync.
Clients may read their own balance/history but have no money-write privileges.
Every mutation runs in `filey_ai_wallet`, locking the account row. Unique payment,
refund and request IDs prevent duplicate credits or charges. USD micro-units use
Postgres bigint. Reservations enforce available funds, task/day budgets and a
30-call/minute limit together, including simultaneous tabs/devices/delegates.

The authenticated `ai-credits` proxy builds an allowlisted OpenRouter request,
caps routing prices and tokens, rejects paid plugins/remote image URLs and bills
only usage reported directly by the provider. Prompts, completions and master
keys are not stored in the ledger or logs. Inference requests are not retried.
Refunds can make a previously spent balance negative, blocking further spend;
disputes block spending until provider state shows they were won.

Unused/crashed reservations expire after ten minutes when that account next
reads or uses its wallet. Unverifiable/timeout usage is absorbed by Filey, never
estimated and charged to the customer. A late settlement cannot charge an
expired hold. The merchant also absorbs any provider cost beyond a reservation.
Monitor these exceptions before raising scale or default output limits.

No Redis is required for accounting. The model catalogue is cached for five
minutes per edge instance, the frontend caches balances for one minute per
account, and there is no background balance polling. Ordinary completions use
two atomic wallet calls (reserve and settle), plus authentication. Free inference uses the existing atomic rate limiter (per-account daily and global per-minute counters), without creating reservations, wallet debits or ledger entries. An upstream
API charge and a database transaction cannot be one distributed transaction;
expired holds and idempotency provide the explicit failure policy above.

## Verification

- `npm run test:rls:local`: disposable PostgreSQL, idempotent migration, account
  isolation, limits, duplicate payment/settlement/refund, debt, disputes, expiry
  and eight concurrent reservations for five available dollars.
- `deno test --allow-env --lock=deno.lock --frozen supabase/functions/_shared/ai-credits_test.ts`
- `npm test -- src/lib/__tests__/ai-credits.test.ts`
- `deno check --lock=deno.lock supabase/functions/ai-credits/index.ts supabase/functions/dodo/index.ts`
- `npm run typecheck` and the existing AI connection/regression tests.

Provider references: [usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting),
[provider routing](https://openrouter.ai/docs/guides/routing/provider-selection),
[Dodo credit billing](https://docs.dodopayments.com/features/credit-based-billing).
Dodo collects top-ups; Filey's transactional ledger is the spending authority.
Do not also enable Dodo token-meter deductions for these same products, which
would create two independent balances.

## Subscription refunds

Settings → Billing → Subscription refunds lists the current workspace's requests.
Owners/admins can select one of the latest 20 successful charges of the linked
subscription and submit a reason. This requests a review; it does not move money.
Ultra's one-time licence and AI credits are not subscription payments. There is
no invented automatic refund window or guarantee of approval.

Apply `supabase/2026-09-20-subscription-refunds.sql`, then redeploy `dodo`.
Set **FILEY_BILLING_ADMIN_USER_IDS** to the comma-separated Supabase account UUIDs
of trusted Filey merchant reviewers. It defaults to no reviewers; workspace
ownership, user-editable profile metadata and the agent's `OWNER_USER_ID` do not
grant merchant authority. Reviewers see the oldest 100 open requests in Billing.
Review the queue there regularly; this version does not send reviewer emails.

Approval requires a note and a confirmation showing the complete payment amount
and ID. The edge function rechecks the subscription product, customer, currency,
amount, disputes and existing refunds directly with Dodo before an atomic claim.
One full refund is submitted with SDK retries disabled. The same payment cannot
be requested or approved twice. Rejections include a customer-visible explanation.

Signed `refund.succeeded` / `refund.failed` webhooks reconcile current provider
state, including refunds issued in Dodo. Reviewers can also check status manually.
An uncertain submission stays `needs_review` (or `processing` if the edge process
dies), never auto-retries. Inspect that payment in Dodo before manually completing
an unresolved/failed refund. Partial refunds are shown distinctly. Refunds do not
cancel subscriptions; customers use Manage billing to cancel future renewals.

The requests table is hosted-only, RLS-enabled, service-role-only and is never
synced to local ERP records. Database tests check privileges, unique payment IDs
and eight concurrent approval claims; edge tests exercise ownership, credit
exclusion, merchant authorization, duplicate approval and uncertain submissions.

Provider reference: [Dodo refunds API](https://docs.dodopayments.com/api-reference/refunds/post-refunds).

## Rollout status — September 21, 2026

Both migrations are applied to the Filey Supabase project and the `dodo` and
`ai-credits` edge functions are deployed. Read-back verified all five new tables
have RLS and deny client writes; only the service role can execute the wallet RPC.
The existing Dodo endpoint now includes both refund events and all seven dispute
events, retaining its previous subscription/payment subscriptions (21 total).
No customer ERP records or real financial transactions were used in testing.

The September 21 fee-column migration and updated edge handlers are also deployed.
Read-back verified the integer fee column defaults to zero for existing orders.
New orders snapshot the $0.50 fee separately. Unauthenticated requests still return
401. Storing the supplied OpenRouter key in Supabase is pending confirmation after
automatic approval review blocked that action; no provider key is committed.

The supplied OpenRouter key was validated and a real free inference returned $0 provider cost. Its account currently has $0 funded balance and a shared allowance of 50 free requests per day. A key spending limit is not a funded balance. Paid AI is unavailable pending a funded managed-provider account,
published credit products and a funded end-to-end test. A $5 product form was
saved as a draft in Dodo; it is not a published, purchasable product. Merchant
review stays disabled until the owner identifies the reviewer account and its
UUID is configured in `FILEY_BILLING_ADMIN_USER_IDS`. The app's frontend changes
are in this branch and require the normal web/desktop release process.

Verified: 1,635 app tests; 82 edge tests; disposable PostgreSQL concurrency/RLS
tests; production build; desktop and 390px browser UI previews with fixture data.
Two direct free-provider smoke tests passed (text and function calling), both at
$0 cost. Production checkout, paid provider inference and actual refunds were not
exercised. The service fee is excluded from wallet credit; the free handler tests
reject paid-model substitution, quota failures and any unexpected nonzero usage.
