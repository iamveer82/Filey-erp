# Filey AI and Coin wallet

Filey AI is the built-in paid assistant on Basic, Pro and Ultra. New accounts
start with Filey AI; an existing explicitly configured own-key/local model stays
selected. A saved paid choice becomes the single public `filey-ai` model.
Retired free choices require an explicit selection before spending Coin. Failed
requests never switch provider or funding method.

## User flow

- The composer and Settings → AI Assistant offer **Filey AI** or **Your API key**.
  The managed assistant has one model; there is no provider catalogue or free
  model picker. Model/provider identifiers and historical provider names are
  absent from the managed wallet and chat controls.
- Account menu → AI wallet, or Settings → AI Wallet, shows available Coin,
  one-time top-ups, Coin usage charges and paginated
  usage/top-up/adjustment history. **1 Coin = US$1**; the ledger remains USD micros.
  Input/output token counts and rates are not displayed to users; server-side
  token accounting and balance enforcement stay on the server. Quick recharge
  beside the balance opens the smallest configured top-up in the existing
  review, showing Coin, the service fee and the payment total before checkout.
  It never pays automatically. Checkout return and desktop payment checks verify
  the exact saved order for the signed-in user. An unrelated top-up, a changed
  balance or a success URL cannot confirm that order. Only the payment webhook
  adds Coin. The wallet refreshes after AI usage and when the app becomes active;
  older balance/history responses cannot overwrite a newer refresh.
  When available
  Coin cannot cover a request, Filey AI stops with **Insufficient credit. Add Coin
  to continue.** The app provides an Add Coin shortcut to the wallet; no automatic
  recharge or fallback occurs.
- Managed text, image understanding and agent tool rounds use the same paid
  server route. Desktop WhatsApp/Telegram reuse the in-app selection. Hosted
  channels use the same reservation, completion and settlement helper with the
  confirmed, paired owner's wallet. Tool approvals and module restrictions stay
  enforced; a channel connection does not bypass wallet balance checks.
- Existing top-ups still charge a flat $0.50 service fee, excluded from spendable
  Coin. Custom credit amounts remain $5–$100. Paid credits have no expiration or
  automatic top-up. Personal task/day spending-limit controls are retired, and
  their saved values no longer block requests. Balance reservations, request
  caps and abuse rate limits remain enforced on the server.
- Coin purchases are final and non-refundable, except where required by law.
  Coins cannot be withdrawn, exchanged for cash or transferred to other users.
  The purchase review states this before payment. Unused request reservations
  return to the same wallet; they are not cash refunds. Authoritative payment
  reversals and chargebacks still adjust the ledger and can pause spending.
- Separate image/video generation and transcription use users' own API
  connections and provider billing. New videos cannot spend Filey Coin;
  historical funded jobs retain status, cancellation and reconciliation only.
  The chat model does not generate videos. Proactive background sweeps do not
  spend Coin, while explicitly scheduled agent tasks use their selected funding.

## Server provider and pricing

Managed inference uses only `https://api.deepseek.com/chat/completions` and the
verified API model `deepseek-flash` (DeepSeek V4.1 Flash as of 3 October 2026).
Client requests contain only `filey-ai`; the server fixes the upstream model.
Old OpenRouter/OmniRoute chat configuration cannot create a fallback.
No master key, provider URL or upstream model identifier is shipped to clients.

Official provider pricing verified on 3 October 2026 is $0.003 per million
cached input tokens, $0.15 per million uncached input tokens and $0.60 per million
output tokens during off-peak hours. Filey's customer tariff is exactly **5/3**
of that base: $0.005/$0.25/$1.00 per million tokens. Thus $5 adds 5 Coin and covers
approximately $3 of base-rate provider usage, before per-request micro-unit
rounding. The spendable Coin balance is credited in full; Coin represents
Filey service credit at Filey's tariff.
Reservations use the scaled peak bounds ($0.01/$0.50/$2.00 per million tokens).
Supplier cost remains unknown in the ledger because actual peak/holiday pricing
is not verified. Filey funds the provider separately and bears peak premiums;
the $3 example is a base-rate budget, not a guarantee of actual supplier expense.

The server checks integer token counts, cache-hit plus cache-miss accounting,
 total usage, provider response identity and model before settling. It never
 trusts a caller-supplied cost or a provider-shaped `usage.cost` field. Customer
 charges apply the exact tariff before one final upward rounding to USD
 micro-units and cannot exceed the reserved allowance. Token/provider pricing
 and the margin are internal; the app shows actual Coin debits and remaining
 Coin. Legacy `markup_bps: 0` means no additional wallet multiplier is applied
 on top of Filey's already scaled tariff.
Output stays capped at 8,192 tokens and input context at 131,072 tokens, despite
 higher upstream limits. Default reasoning effort is low; tool continuations
 retain validated `reasoning_content` without displaying it to the user.

Prompts, completions and keys do not enter the wallet ledger or logs. Data sent
 to the provider is still covered by the app's disclosure of AI processing; the
 Filey AI product label does not replace required privacy disclosures.

References: [models and pricing](https://api-docs.deepseek.com/quick_start/pricing),
[chat completion contract](https://api-docs.deepseek.com/api/create-chat-completion),
[thinking and tools](https://api-docs.deepseek.com/guides/thinking_mode).

## Deployment and current status

These source changes remain **unpublished** until the coordinated deployment
and live readback succeed. On 4 October the user authorized web and matching
backend publishing for their mobile wallet test; desktop publishing remains held.
The supplied key authenticated successfully against the read-only model list,
 which includes `deepseek-flash`. No paid inference or checkout was performed.
The credential is staged
 outside the repository with Windows user encryption and owner-only access.

The one-use owner coupon was created in Dodo live mode on 4 October. It is
restricted to the requested existing customer and the 5 Coin product, with
100% off the complete $5.50 price, one total redemption and one per customer.
Its Filey account binding is staged locally; the server promotion secret,
database upgrades, matching handlers and web build remain unpublished.
The web payment review shows the discount and $0.00 total only to the verified
owner. Opening a checkout consumes the offer; it never falls back to a paid
checkout. Filey's private deadline is earlier than the provider coupon expiry
and remains authoritative for the first signed successful receipt.

Promotion validation passed 69 focused frontend tests and the final full Edge
suite passed 242 tests. The full frontend run passed 2,884 tests before the
10 new promotion UI regressions were added. The production build and seven
browser-security checks passed; the managed credential is absent from compiled
website files. Disposable PostgreSQL checks verify one claim and one 5 Coin
grant under concurrent retries, ordinary underpayment rejection and repeat
migration safety. The actual Dodo $0 receipt and funded inference still require
the user's live test. A $0 test does not verify cash collection or bank payout.

The wallet/recharge refinement passed 33 focused frontend tests. The own-key
video transition passed another 28 frontend tests, and the complete backend
suite passed all 192 tests. The production build and disposable PostgreSQL suite
passed, including saved-budget retirement, concurrent balance reservations,
replay protection and atomic payment/dispute reconciliation. A 390px dark-mode
browser preview confirmed quick recharge and its fee review fit without
horizontal scrolling; spending-limit controls and token counts/rates are absent.
Preview balances are synthetic, and payments/provider calls are disabled.

On 4 October, the checkout correlation and wallet refresh fixes passed 105 focused
frontend tests and 48 backend payment/managed-model contract tests. The production
build, frontend lint and both payment endpoint typechecks passed. Checks cover
unrelated top-ups, exact-order desktop and web returns, forged return URLs,
pending/reversed/disputed payments, same-account sign-in on checkout return,
account changes during verification and stale balance/history responses. No live
payment, bank payout or paid inference was performed.

Authorized web rollout prerequisites:

1. Retain the existing wallet, top-up fee and refund migrations. No wallet
   migration is needed for the model change; balances/history are not rewritten.
   Apply `supabase/2026-10-03-ai-credit-payment-safety.sql` after the video wallet
   migration for signed dispute ordering and retirement of personal task/day
   budgets. This separate payment hardening
   migration must be verified in the live catalog before handler publication.
2. Set **FILEY_AI_DEEPSEEK_KEY** in Supabase Edge Function secrets from the secure
   credential store. Never put it in a VITE variable, browser, source or command
   log. A missing key disables managed chat and chat-only top-up readiness.
3. Deploy `ai-credits`, `ai-video`, `channel-webhook` and `dodo` together
   with the frontend. Retain channel transport secrets and the current confirmed
   owner binding. The new frontend requires Dodo's saved `order_id` response and
   `ai-credits`' authenticated `checkout_status` action; it will not open checkout
   if the saved order identity is missing. Do not fabricate a user JWT for
   service-side calls.
4. Keep existing Dodo products, `DODO_AI_CREDIT_PACKS`, optional
   `DODO_AI_CREDIT_PRODUCT_ID`, `FILEY_APP_URL` and signed payment/refund/dispute
   webhook subscriptions. Both `DODO_PAYMENTS_API_KEY` and
   `DODO_PAYMENTS_WEBHOOK_KEY` are required before checkout is enabled. Credit is
   still added only by verified payment state. Verify the live environment and
   linked-bank payout readiness independently of test-mode checks.
5. Verify a funded synthetic request, insufficient balance, saved old budgets
   no longer blocking requests, reservation/request/rate caps, tool
   continuation, deliberate repeated messages and provider failures after
   deployment. Do not claim paid production inference before that verification.

## Accounting and security

Customer payments are collected by the Dodo merchant account configured on the
server. The Coin ledger does not hold or move real money: $10 of credit grants
10 Coin, while the $0.50 top-up fee is charged separately and grants no Coin.
Dodo pays eligible net receipts to the merchant's verified linked bank account
according to its payout schedule and threshold. Payment acceptance and payout
activation are separate; source checks cannot establish bank verification,
active payouts or real receipts. See [Dodo payouts](https://docs.dodopayments.com/features/payouts/payout-structure).
Filey funds its provider account separately; the wallet never sends customer
money directly to the model provider. Receipts are not all profit: provider
usage, payment fees, tax and merchant-absorbed peak pricing affect the margin.

Wallet tables remain hosted-only and outside business-data synchronization.
Clients cannot write money. `filey_ai_wallet` locks each account and enforces
 available funds, reservations, request caps and rate limits. Legacy personal
 task/day preference fields remain readable for compatibility but are not
 enforced; the retired public limits action returns a clear error. Unique payment, refund and
 request IDs prevent duplicate credits and settlements across devices/delegates.
Each tool round reserves before inference and settles once. Hosted channel
 request IDs are derived from authenticated provider message identity so a
 redelivery cannot cause a second model charge; deliberate new messages have
 different identities.

Paid app calls pin the captured account's Authorization token rather than
letting the SDK select a later active account. Account/workspace and Stop checks
run before dispatch and after authentication awaits; replies and cached balances
from an old account are discarded. Failed paid calls are never automatically
retried. Dispute updates use signed event timestamps; ordinary payment/refund
snapshots cannot clear a block, and blocking wins ties. A newer verified won
dispute, confirmed against the current provider list, can restore spending.
Payment confirmation, known reversals and dispute state commit in one account-
locked transaction. Every provider reversal is validated before that call; a
malformed later adjustment rolls back the entire snapshot. A payment already
reversed in full cannot temporarily fund a concurrent AI reservation.

Inference is never automatically retried. If a request, usage or settlement is
 uncertain, stop before tool execution and do not estimate a customer charge.
An unresolved hold expires under the existing ten-minute wallet policy; Filey
 absorbs unverifiable provider work. Stop prevents further rounds, while already
 completed billable work can settle. Refunds/disputes retain their existing debt
 and blocking behavior. No Redis or second payment balance is introduced.

The historical notes below record earlier deployments; their provider/model
 configuration is superseded by the current Filey AI route above.

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

## Custom amounts — September 24, 2026

The custom amount form, checkout request and server validation are implemented
and tested locally. They are not part of the already published 3.0.3 release.
Enabling them requires the dedicated product and `DODO_AI_CREDIT_PRODUCT_ID`
configuration described above, deployment of `ai-credits` and `dodo`, and the
updated frontend. Existing paid-provider readiness checks still apply. No live
product, secret, payment or customer record was changed for this addition.

The Coin branding, named paid-model picker and optional OmniRoute adapter are
also local changes, not part of 3.0.3. Deploy the updated `ai-credits` function
with the then-current frontend so the catalogue and historical zero-markup
policy matched. Clients
that previously saved `filey-ai` must select a named model; the backend does not
silently route that old alias. The gateway
must be hosted and verified before setting `FILEY_AI_GATEWAY=omniroute`; a
repository URL alone is not an inference service. Existing Dodo checkout pays
the merchant; payment fees, hosting and provider costs still affect net revenue.
