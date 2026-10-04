# Billing, managed AI and payroll audit — 2026-10-04

This wave manually reviewed 26 complete runtime files (5,598 lines) and five
complete migrations (581 lines), plus named portions of five larger
source/schema files. The exact
paths, inclusive ranges, line counts and snapshot hashes are recorded in
`2026-10-04-billing-payroll-coverage.json` alongside this report. Runtime counts
exclude tests, fixtures, generated locks and the canonical schema. This is a
bounded audit of billing, managed AI and payroll paths, not a whole-repository
manual review or a guarantee that every defect has been found.

## Confirmed fresh repairs

1. **Coin account acquisition.** The Supabase SDK could supply account B's session
   while the task and workspace cache still represented account A. Post-request
   checks cannot undo a charge or purchase already dispatched under B. The Coin
   session helper now checks both the captured workspace scope and the reviewed
   account against the acquired SDK user before dispatch. Regression tests cover
   status, history, recharge and inference without any backend dispatch.
   Files: `src/lib/aiCredits.ts`, `src/lib/__tests__/ai-credits.test.ts`.
2. **Retired Stripe startup and request handling.** Constructing the SDK with an
   empty retired Stripe key threw during module import, preventing independent
   license actions from running. Provider construction is now lazy; license
   activation/deactivation remain available without that key. The legacy handler
   also enforces POST, bounded actual action/webhook bodies, object JSON, an
   action allowlist and owned plan keys before customer creation. Provider,
   database and signature failures use fixed safe responses. Existing Stripe
   dependencies were added to the Deno lock without replacing prior pins.
   Files: `supabase/functions/stripe/index.ts`, `_shared/stripe-request_test.ts`,
   `deno.lock`.
3. **Legacy video error disclosure.** Unexpected database or provider parsing
   errors could be returned directly to users. Malformed and oversized requests
   now have distinct safe 400/413 responses; only fixed known failures are
   exposed, and unexpected failures return a generic 503. Legacy job reads,
   cancellation and callback settlement remain supported. New managed video
   quote/start calls retain the existing BYOK-only refusal; this repair does not
   add a Coin video service. Files: `supabase/functions/ai-video/index.ts`,
   `_shared/ai-video_test.ts`.
4. **Rotating public checkout addresses.** A caller could bypass the five-per-hour
   email limit by choosing another email for each hosted checkout. A shared
   100-per-hour reservation now precedes the existing email reservation. Rejected
   global attempts create no new per-email subjects or provider sessions. This
   bounds shared provider work; it is not proof of distributed flood resistance.
   Files: `supabase/functions/dodo/index.ts`, `_shared/dodo-request_test.ts`.
5. **Purchase polling scope drift.** License and Pro polling could recapture a
   newly selected workspace after a timer delay and accept its purchase instead
   of the original one. Polls now retain one original scope and check it before
   and after each awaited read; subscription reads also fence their workspace
   lookups. Files: `src/lib/license.ts`, `src/lib/subscription.ts`,
   `dodo-license-claim.test.ts`, `cloud-subscription.test.ts`.
6. **Partial or duplicate payroll.** Cloud payroll previously saved the payslip,
   ledger entries and account balances through separate requests. A later
   failure left partial books; concurrent clients could both pay one employee
   for the same period. `hr.runPayroll` now uses one actor/workspace-bound invoker
   RPC with no partial-write fallback. Private durable period claims also stop
   replay when another author's historic salary is hidden by RLS or the original
   payroll/employee is deleted. Existing duplicate history is preserved, posted
   identities/amounts cannot be rewritten, and normal status updates remain
   supported. The existing pending-status accounting behavior is retained.
   Files: `src/lib/api.ts` (only `hr.runPayroll`),
   `supabase/2026-10-04-atomic-payroll.sql`, payroll fixtures and
   `src/lib/__tests__/payroll-cloud.test.ts`.
7. **Shared-browser cloud device identity.** The server device-authority repair
   refuses another user's fingerprint; a global browser install ID consequently
   needs an account-specific cloud identity. The client uses `installID:userID`
   unless the current user owns the legacy base row, including a revoked row.
   Keeping that legacy row prevents an upgrade from evading logout or consuming
   another slot. Captured account/scope/session checks surround awaited reads,
   and explicit Authorization headers pin registry operations to the reviewed
   session. Stale list results cannot return and a late logout check cannot sign
   out a newer login. Freedom's offline install ID remains global. Server ACL,
   ownership and membership changes are owned by the separate cloud data audit.
   Files: `src/lib/license.ts`, `src/lib/__tests__/device-list-errors.test.ts`;
   paired migration: `2026-10-04-workspace-device-authority.sql`.
8. **Concurrent paid entitlement overwrite.** Distinct purchasers locked their
   own pending entitlements but selected the same eligible organization without
   locking it. Both could mark their purchase claimed while the last update
   replaced the first subscription/customer binding. The eligible organization
   is now selected `FOR UPDATE`; eligibility is rechecked after waiting for a
   competing claim. Exactly one purchase is consumed and the other remains
   unclaimed. Freedom claiming retains its existing behavior.
   Repair: `supabase/2026-10-04-subscription-claim-serialization.sql`.

The earlier 3 October wallet payment-reversal/dispute, billing intent and
channel-send repairs were retained and reviewed where relevant. They are not
counted again as new findings above.

## Verification

- **47 focused Deno tests passed** across Dodo request handling, legacy Stripe,
  AI video, managed completion, credit payment reconciliation, license claiming,
  Stripe subscriptions and subscription refunds. All provider, payment and
  database interactions in these endpoint tests use synthetic fixtures.
- **Focused frontend batches of 31, 18 and 36 tests passed.** The last two batches
  overlap in four license polling tests; these counts must not be added as
  unique tests. Coverage includes account acquisition, billing requests,
  subscription/license waits, device identity/session fencing, payroll receipts
  and local transaction preservation.
- **`node scripts/test-rls-local.mjs --payroll` passed** in a fresh disposable
  PostgreSQL cluster. The migration is applied twice. A forced failure on the
  contra ledger leg leaves no payslip, account, claim or transaction. Successful
  postings balance; malformed periods/amounts, wrong actor/workspace/module,
  anonymous execution, claim mutation and identity edits are denied. Hidden
  historic claims and employee delete/recreate attempts cannot repay a period.
  Eight concurrent calls produce one payslip and two balanced ledger entries.
- **`node scripts/test-rls-local.mjs --billing-claims` passed.** The old function
  first reproduces two distinct purchases consumed for one workspace. Applying
  the repair twice leaves exactly one claimed purchase, keeps the loser
  unclaimed, preserves the winner's subscription/customer pair and denies
  anonymous execution. Both focused blocks are included in the full DB runner.
- The coordinating agent additionally reported **215 consolidated Deno tests
  and the complete disposable database suite passing**. The consolidated
  frontend run initially loaded the earlier transport code while the final patch
  was being saved. A frozen-source rerun subsequently passed all 2,543 tests in
  345 files; no additional source change was needed for those two failures.

## Pending deployment and limits

Apply `2026-10-04-atomic-payroll.sql` before releasing the matching cloud payroll
client; an older schema fails closed and posts nothing. Apply
`2026-10-04-subscription-claim-serialization.sql` after billing integrity. Both
are mirrored in `schema.sql` and documented as pending in `MIGRATIONS.md`.
The cloud-device client pairs with the data audit's pending device-authority
migration. Existing paid benefits and version 3.0.10 are preserved.

No live Supabase migration, credential change, provider inference, checkout,
payment/refund, customer message, deployment, release or commit was performed.
Provider receipts, cost/usage validation, reservation/settlement/release,
idempotency and account boundaries were traced through source and synthetic
tests; live gateway configuration and historical production reconciliation were
not exercised. The public checkout ceiling is a finite availability bound, not
a comprehensive abuse-defense certification. Payroll keeps current cash-posting
semantics; redesigning pending/paid accounting and reversing erroneous historic
runs remain separate product workflows.

The legacy Stripe invoice settlement RPC still calculates paid status from its
older document-wide subtotal/discount/tax formula. Parity with newer line
discounts, tax categories and charges was not established in this wave. Public
`pay_invoice` remains HTTP 410; reviewing historical settlement amount/status
parity is a follow-up, not a claim of a newly demonstrated exploit here.

The manifest records this audit's frozen working-tree snapshot. Subsequent
changes need their own review; line-count and hash metadata are not evidence
that an unlisted file or every execution path was examined.
