# Supabase migrations — apply order & convention

## Fresh installer and current upgrade distinction

For an empty Supabase application database, run the complete current
`schema.sql` as one transaction. It now includes the historical feature chain,
workspace/channel RPCs, `org_channel_reads` and current authority definitions.
See [BOOTSTRAP.md](BOOTSTRAP.md) for prerequisites, generated-source maintenance,
repeatability and disposable PostgreSQL validation. This installation repair is
local; no cloud project was changed for these tests.

For an existing Filey database, apply only the missing reviewed dated upgrades.
The canonical fresh installer intentionally refuses an existing untracked
database. The older apply-order list below documents the upgrade history; do
not replay the baseline or older authority functions over customer data.

Final disposable fresh-install evidence on 4 October: **93 tables, 1,192
columns, 143 named functions, zero checked issues**. The actual entire file
committed from an empty public schema with Supabase-compatible prerequisites.
Existing Auth accounts were provisioned once; later signups used the real
trigger. Repeated installation and all 12 current upgrades applied twice preserved
all saved fixture rows, ownership and funded wallet state. A deliberately
deleted profile stayed deleted, a changed historical-source receipt failed
closed, final-stage failure left no app objects, and both full and partial
legacy installations were refused without altering their saved data. Evidence:
`output/bootstrap-complete-tests.log` and `output/bootstrap-catalog.json`.
This is local evidence, not a live-project readback.

## Atomic workflows and numbering — pending, not applied

For an existing database with the documented historical dependencies already
installed, apply these current upgrades in order after the child, tool-job,
device and public-document authority repairs documented here:

1. `2026-10-04-atomic-document-save.sql`
2. `2026-10-04-document-number-authority.sql`
3. `2026-10-04-atomic-lead-setup.sql`
4. `2026-10-04-atomic-business-workflows.sql`
5. `2026-10-04-atomic-recurrence.sql`
6. `2026-10-04-stripe-invoice-total-parity.sql`

Publish the matching clients/handlers with their RPC contracts. The business
upgrade adds scoped immutable replay receipts and atomic document, payment,
stock, sales-order, advance and journal operations. Its narrow non-login,
non-superuser, non-BYPASSRLS executor inherits authenticated RLS and cannot be
assumed by API clients. Overdrawn historical author-specific advance pools cannot
fund new allocations or deposit reductions; note-only edits and safe allocation
release/cancellation remain available for reconciliation. Recurrence generation
commits one numbered draft and
schedule advance together; malformed hidden legacy lines require reconciliation
instead of a partial copy. The Stripe parity upgrade requires the business
calculator and changes settlement of existing checkouts to the current totals,
including advances; it creates no new public checkout capability.

The catalog checker now verifies 32 explicit new RPC signatures, source bodies,
role/ACL contracts and private replay ledger permissions, including both safe
advance overloads and the protected receipt-cost integrity helper. Twelve
internal helper signatures are executable only by the dispatcher role; clients
and the service role cannot call them directly to bypass replay receipts. Its 21
regressions include the actual catalog export's source whitelist. Keep the
separate payroll and subscription-claim serialization upgrades in the release
chain too. Do not infer that the live schema or Edge deployments already match
this list.

## Atomic inquiry setup — pending, not applied

Apply `2026-10-04-atomic-lead-setup.sql` after lead-requests, vouchers,
lead-coupons and their lockdown migrations, then publish the matching
`lead-contact` handler and request-ID client. The service-only invoker RPC
validates bounded input and commits the inquiry, optional Freedom voucher,
coupon and configured-owner notification together. A coupon failure leaves
none of those rows behind. Stable request IDs replay the original saved
coupon/expiry and reject a changed form. Enterprise inquiries create no
license voucher. Repeated email delivery uses the saved lead ID as its provider
idempotency key; accepted delivery is never automatically resent.

The notification recipient is `platform_config.owner_uid`, not the first
customer to sign up. On a new self-hosted installation, configure this marker
to the actual platform administrator's Auth UUID using the database owner;
never derive it from editable profile text or arbitrary signup order.
Private contact replay records have no client grants. Existing leads, coupons
and voucher redemptions are retained. Local PostgreSQL tests prove rollback,
eight-way identical-request serialization, replay and role restrictions; no
customer inquiry, email or cloud migration was performed for verification.

## Public document privacy — pending, not applied

Apply `2026-10-04-public-document-privacy.sql` after the generic document and
customer-portal migrations and their organization columns. It replaces both
active `get_shared_doc` and legacy `get_shared_invoice`. Public share-token
output excludes member sharing IDs and ownership/share-token fields. Invoice,
quotation and purchase-order lines must match their parent organization even
when old/admin-created rows are malformed; missing organization identity fails
closed. All other customer document fields, line calculation/format metadata
and receipt output are preserved. These two token gates remain callable by
anonymous and signed-in viewers; unshared and targeted-only documents remain
private. No existing rows are rewritten. Disposable fixtures reproduce the
original exact functions' leaks before checking repeat application and repaired
customer-facing output. This upgrade and its canonical mirrors are local only.

## Canonical invitation identity repair — local, not applied

`schema.sql` now uses the verified `auth.users` email, expiring row-locked
acceptance and existing-member role preservation from the current team
migration. A forged editable profile email cannot join as an invited recipient
on a fresh bootstrap. The canonical fragment is tested directly in disposable
PostgreSQL. The subsequent fresh-installer reconciliation now embeds the
team-workspaces, channel paging and channel-read migrations. Existing databases
still need their documented missing upgrades; a local fixture does not verify
the state of the deployed cloud project.

## Document child authority — pending, not applied

Apply `2026-10-04-document-child-authority.sql` after the shared-record and
module permissions migrations. Order, quotation and purchase-order lines and
purchase payments now inherit parent visibility. Only the parent author or a
current workspace admin can mutate linked child rows; independently shared
children cannot expose private or foreign-workspace parents. Existing nullable
unattached rows remain private owner data. No saved rows are changed.

## Tool job authority — pending, not applied

Apply `2026-10-04-tool-job-authority.sql` after `tool-jobs.sql` and
`2026-09-20-edge-rate-limits.sql`, and deploy its matching `run-tool` handler.
Clients can create only pending, bounded specifications for supported engines
without forged outputs. The database atomically admits 15 new jobs per user
per hour for both engines; running a job does not count it again. Only trusted
servers can update specifications, claims and results. Users can still read
their own jobs and cancel pending jobs. Claimed jobs/results remain intact.
The edge handler claims once and finishes only the exact active claim, with
separate output paths per claim. Existing queue rows are not rewritten.

## Atomic document save — pending, not applied

Apply `2026-10-04-atomic-document-save.sql` after shared-record, module and
document-child authority permissions and workspace membership read integrity.
It extends the existing quote/PO
transactional save contract to `invoice_docs` and its items, retains all allowed
document/formatting/tax columns and strips caller-supplied ownership/sharing.
A rejected line rolls back its header and all replacement lines. Updating a
shared document requires its author or current workspace admin, including when
the replacement header is empty. The invoker RPC remains subject to RLS,
MFA/module gates and existing invoice creation limits. Install before publishing
the matching MCP atomic save client; no existing records are rewritten.

Replacement lines now retain the original parent author and workspace, including
an administrator editing a staff member's draft. The private boolean integrity
helper rejects hidden foreign/null-workspace lines and nondeletable historic
creators before any destructive replacement. Same-workspace admins may
reconcile old creators. Ordinary generic invoice and purchase-order saves are
limited to draft-to-draft changes; finalized saves use the trusted transactional
business dispatcher. Quotes retain their existing status workflow. This RPC
restriction is not a blanket prohibition of authorized table REST/import/sync
writes; those still use the existing RLS and trigger contracts.

## Workspace device authority — pending, not applied

Apply `2026-10-04-workspace-device-authority.sql` after cloud-device-limit and
workspace-membership-read-integrity. Raw device fingerprints/session IDs are
visible only to their owner or a current workspace administrator. All registry
operations require actual membership; stale profiles cannot occupy old team
slots. A known fingerprint cannot be reassigned to another user. The existing
20-slot lock, same-owner renewals and revoked-session check remain intact.
Publish the matching account-specific cloud fingerprint client at the same
time, retaining each user's existing legacy device registrations.

## AI credit payment safety — pending, not applied

Apply `2026-10-03-ai-credit-payment-safety.sql` after the AI credit, top-up fee
and video migrations. It adds atomic payment snapshot reconciliation, an ordered
dispute timestamp and the final wallet definition. Known reversals are debited
in the same transaction as their top-up, and malformed later reversals roll
back the entire snapshot. Older or equal-time resolution events cannot clear a payment
dispute; only a newer verified won event can restore spending. Provider reversal
bookkeeping and failed AI hold releases remain supported. This adds no user
refund, withdrawal or transfer endpoint.

The same pending upgrade retires personal task/day spending budgets without
rewriting stored limits or balances. Coin reservations still require available
funds and retain request caps, rate limits, dispute blocks and replay protection.
The public limits action is retired; funded videos do not enable Coin purchases.

Deploy the matching `dodo` and `ai-credits` handlers with this migration.
Checkout and published readiness now require both the Dodo API key and webhook
verification key; secret presence does not prove webhook subscriptions, merchant
identity, bank payout configuration or a completed real payment.

## Current document and stocktake schema — applied 3 October 2026

Applied to `voyrjqgaypiylwskkwpr` using the signed-in Dashboard SQL editor:

1. `2026-10-01-packaging-lists.sql`
2. `2026-10-03-letters.sql`
3. `2026-10-03-stocktake-reliability.sql`
4. `2026-10-03-document-setting-uniqueness.sql`

The first three committed together. Apply Packaging before Letters: the latest
settings access function must include both modules. The final corrective
transaction removes the legacy unconditional `(user_id,key)` constraint or
index regardless of its autogenerated name. It retains ordinary settings'
per-user uniqueness and document collections' per-workspace uniqueness, with
bounded lock/statement timeouts and no cascading drops. It fixes the production
constraint named `app_settings_user_id_key_key`, which the earlier name-only
drop missed. No business rows, ownership, grants or RLS policies were changed by
this corrective migration.

Final live readback passed: **88 tables, 1,155 columns, 85 functions, zero checked
issues**. The runtime checker verifies current RPC/column requirements, all
45 synced tables' RLS/revisions/realtime publication, exact current feature
function bodies, document uniqueness, Letter validation and scoped stocktake
receipt grants/policies. The strengthened checker reproduced the legacy-index
failure before repair and passed afterward. Metadata-only evidence:
`output/cloud-schema-2026-10-03.json` and
`output/cloud-schema-check-2026-10-03.log`.

**9 checker regressions and the full disposable PostgreSQL suite passed**,
including both legacy constraint names, renamed/reversed standalone indexes,
repeat application, unchanged stored rows, same-user documents in separate
workspaces and retained ordinary-setting uniqueness. The stocktake tests also
verify eight simultaneous retries produce one adjustment and one movement.
No document or stocktake business RPC was called in production for testing.

Local storage already supports the current collections in its existing
JSON/SQLite key-value schema. **51 local tests and 20 disposable SQLite checks
passed**, including upgrade/reopen preservation and current document/receipt
formats. The customer store was inspected read-only; it required no column,
`user_version`, or record rewrite. This schema update does not publish the
pending app, web, desktop, hosted handler or sidecar changes.

## 23 September 2026 batch (voyrjqgaypiylwskkwpr)

Applied with `supabase db query --linked -f <file>` (this CLI has no `db execute`):

- `2026-09-23-receipt-stamp-signature.sql` — `payment_receipts.stamp` / `signature`
- `2026-09-20-ai-credits.sql` — hosted AI wallet ledger (+ `expires_at`, re-run safe)
- `2026-09-21-ai-credit-topup-fee.sql` — `ai_credit_orders.service_fee_cents`
- `2026-09-21-ai-video.sql` — video wallet columns/end-state wallet shape
- `tool-jobs.sql` — `tool_jobs` queue for the run-tool worker

Verified in `information_schema`: `payment_receipts.stamp`, `payment_receipts.signature`, `ai_credit_orders.service_fee_cents`, `tool_jobs.status`.

Edge secrets for this batch: `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_ENVIRONMENT=live_mode`, `DODO_AI_CREDIT_PACKS` (live one-time products). Functions already deployed: `dodo`, `ai-credits`, `lead-contact`, `run-tool`, `overdue-reminders`, `agent-jobs`. Still required before enabling paid AI chat: `FILEY_AI_OPENROUTER_KEY` (or HF pair). Product IDs are listed in [`docs/ai-credits.md`](../docs/ai-credits.md).

## September 22 sync batches

Apply `2026-09-22-batched-sync.sql` after `2026-09-12-sync-conflict-protection.sql`
and before the 3.0.1 desktop client. It adds an authenticated, SECURITY INVOKER
wrapper for up to 50 rows with a savepoint per row. The existing `sync_record`
still enforces RLS, optimistic revisions and idempotency. No business rows change.
Older servers remain compatible through single-row fallback. Verify using
`npm run test:rls:local`. Applied and read back from production on 22 September:
body hash `d4ee83cc2755bbde1f4636c4059bbbcc`, invoker security, authenticated-only execution.

## AI credits and subscription refunds

`2026-09-20-ai-credits.sql` adds the hosted wallet ledger and service-only accounting
RPC. `2026-09-20-subscription-refunds.sql` adds service-only subscription refund
requests after `organizations` exists. Both are additive and idempotent; neither
changes customer ERP records or desktop sync tables. Deploy `ai-credits` and
`dodo` after these migrations. Activation secrets and verification steps are in
[`docs/ai-credits.md`](../docs/ai-credits.md).

## September 20 live reconciliation

Applied and read back from `voyrjqgaypiylwskkwpr`:
`migrations/2026-07-17-followup-repeat.sql`, `2026-09-20-team-workspaces.sql`,
`2026-09-20-edge-rate-limits.sql`, `2026-09-20-profile-insert-scope.sql`,
`2026-09-20-realtime-coverage.sql`, and `2026-09-20-sync-manifest.sql`.
Apply the team changes after module/shared-record/team-comms migrations, and the
manifest/publication changes after all 45 sync tables and revision triggers exist.
Deploy the manifest before the new sync client. No customer rows were rewritten.

The runtime catalog guard reports 78 tables, 1,041 columns, 53 functions and no
missing checked requirements. Use `verify-runtime-schema.sql` with
`scripts/check-cloud-schema.mjs` before a release; see the
[cloud audit](../docs/2026-09-20-cloud-sync-audit.md). Do not replay the entire
historical baseline on production: it contains legacy data backfills/deduplication.

This project applies schema as a **baseline + additive idempotent migrations**.
Replay migrations only in their reviewed order. Earlier migrations can replace
newer function bodies or policies, even when individual statements are
idempotent. Inspect production first and apply only the missing changes; never
replay the historical baseline over an existing customer database.

## Historical apply order (existing database upgrade reference)

Run in the Supabase Dashboard → SQL Editor (or `supabase db execute --file <f>`):

1. The old baseline established the core tables, RLS, triggers, RPCs,
   `force_org_id` and atomic counters. Current fresh databases use only the
   complete canonical installer above. Do not replay its baseline over an
   existing untracked database.
2. Feature migrations (additive; order among these does not matter):
   - `follow-ups.sql` — `follow_ups`
   - `tool-jobs.sql` — `tool_jobs`
   - `recurring-invoices.sql` — `invoice_recurrence`
   - `customers-trn.sql` — `crm_customers.trn`
   - `invoice-doc-type.sql` — `invoice_docs.doc_type`
   - `invoice-missing-columns.sql` — `invoice_docs` stamp/signature/custom_columns/doc_title/po_number, `invoice_doc_items` unit/custom
   - `product-missing-columns.sql` — `products` batch_number/expiry_date/barcode/warehouse/is_serialized/custom_fields
   - `billing-columns-lockdown.sql` — billing column hardening
   - `stripe-billing.sql` — Stripe subscription tables
   - `customer-portal.sql` — customer portal access
   - `2026-06-16-sms-otp-templates.sql` — SMS/OTP/template + CRM/ERP custom fields (`sms_providers`, `sms_templates`, `sms_logs`, `otp_codes`, `custom_entity_fields`, `custom_entity_values`) and `products.unit`
   - `2026-07-26-agent-memories.sql` — `agent_memories`: durable long-term memory for the channel agent (remember/recall tools), per-user RLS
   - `2026-07-26-payroll-paid-on.sql` — `payroll.paid_on`: the date a salary was actually paid (status alone couldn't say when); backfills paid rows from `updated_at`
   - `2026-07-26-crm-objects.sql` — CRM relational layer: `crm_people`, `crm_notes`, `crm_tasks` (org RLS like every app table); `customer_id`/`person_id`/`pipeline` on `crm_opportunities`; `target_type`/`target_id` on `crm_activities`; backfills deal→customer links and promotes contact names to people
3. Apply all subsequent dated feature migrations in date order (see the deployment log).
4. `2026-09-12-shared-record-permissions.sql` — apply after the feature migrations, including when re-running older policy migrations. Splits shared reads from owner/admin writes and scopes invoice sharing to the current organization. No record contents are changed.
5. `2026-09-12-sync-conflict-protection.sql` — revision-checked sync RPC and offline ID sequence separation. Deploy before shipping the matching desktop update; the client deliberately refuses unsafe legacy upserts.
6. `verify-rls.sql` — structural checks. Also run `npm run test:rls:local` against a disposable PostgreSQL cluster to verify denied writes/deletes and stale-write rejection; policy presence alone does not prove isolation.
7. `2026-09-13-expense-entry.sql` — itemized expense details and receipt references, atomic expense/ledger save and deletion, and submission retry protection. Apply before shipping the purchase-entry page. Existing business rows are not rewritten.
8. `2026-09-15-dodo-payments.sql` — `licenses.dodo_payment_id` plus the partial unique index the Dodo webhook uses for idempotency. Apply before deploying the `dodo` function, or a retried webhook can grant a second licence. See [Dodo Payments](../docs/dodo-payments.md).
9. `2026-09-16-cloud-subscription.sql` — `organizations.dodo_customer_id` / `dodo_subscription_id` for the $5/month Cloud plan, with a unique index on the subscription and UPDATE revoked from app users (same rule as `billing-columns-lockdown.sql`). No plan values change: every "is this paid?" check already reads `plan <> 'free'` with a live status.
10. `2026-09-16-cloud-access.sql` — makes cloud the paid tier: `filey_cloud_access()` plus restrictive INSERT/UPDATE/DELETE policies on every business table, `organizations.cloud_grandfathered` (backfilled true for every org that exists when it runs), and the invoice cap exempting grandfathered orgs. SELECT is deliberately never gated, and the whole gate is inert until `platform_config.licensing_enforced = 'true'`. Apply last, after every other migration. See [Dodo Payments](../docs/dodo-payments.md).
11. `2026-09-18-pending-entitlements.sql` — lets someone buy on the website before they have an account: the webhook parks the purchase against their email in `pending_entitlements` (RLS on, zero policies, service-role only) and `filey_claim_entitlements()` turns it into a licence or a paid plan at first sign-in, using the caller's own Supabase-verified email. Also adds `filey_users_by_email`, a two-column view of auth.users granted to service_role alone.
12. `2026-09-19-ultra-cloud-access.sql` — Ultra includes Filey on the web: `filey_org_owner_licensed(org)` and a third door in `filey_cloud_access()` and `enforce_free_invoice_cap()` — a workspace whose OWNER holds an active licence may save to the cloud, uncapped. The cap's error text now names Basic, Pro and Ultra. **Applied 2026-09-19** through the management API and verified by reading all three function bodies back. Rollback: re-run `2026-09-16-cloud-access.sql`.

Applied to the configured Filey cloud project on 13 September 2026. Both expense RPCs were verified as SECURITY INVOKER with authenticated-only execution. Behavioral checks ran against a disposable PostgreSQL database; production business records were not changed for testing.

13. `2026-09-19-basic-web-access.sql` — Basic can use web/cloud workspaces. Keeps tenant/record restrictions, replaces the paid-only gate, and counts new invoice INSERTs atomically per workspace/month (UTC). Edits/upserts do not count. Paid and Ultra exemptions remain; historic Basic accounts use the same five-creation allowance. Apply after the Ultra migration. Seeds a private usage counter from current-month invoices without altering business records. Test with `npm run test:rls:local` (includes eight concurrent requests for one slot). **Applied 2026-09-19** through the management API; verified the live gate, AFTER INSERT trigger, usage RPC and private counter permissions.

## Prod state — verified 2026-09-18

Migrations 4 through 11 are **applied** to `voyrjqgaypiylwskkwpr`, through the
management API, and verified by reading the live catalogue back rather than by
trusting the exit codes:

- F01 is fixed where it matters: each business table now carries `<table>_read`
  (SELECT, allowing `shared` and `shared_with`) separately from `<table>_write`
  (ALL, owner-or-admin only), so a member can no longer edit or delete another
  member's shared record.
- `sync_record`, `filey_cloud_access`, `filey_can_use`, `filey_module_access`,
  `filey_record_expense` and `filey_claim_entitlements` all exist.
- 43 tables carry the restrictive `filey_cloud_*` gates.
- All 11 organisations have `cloud_grandfathered = true` — nobody using the
  cloud today loses it.
- The website purchase path was exercised end to end against production and the
  test rows were removed afterwards: parked by email, claimed at sign-in into a
  real licence row, replay refused by the unique index, a second claim a no-op,
  and a purchase for one email left untouched by a different account.

**`platform_config.licensing_enforced` is `'true'`,** so the cloud write gate is
live. That predates this work; the grandfather flag is what keeps existing orgs
unaffected.

## Prod state — verified 2026-07-28

The three `2026-07-26-*` migrations were **not** applied when the features that
need them shipped (v2.3.16/v2.3.17), so in cloud mode the contacts panel, notes
and tasks, deal→customer links, activity targets, `payroll.paid_on` and agent
memories were all hitting tables and columns that did not exist. Applied
2026-07-28 and verified present via `information_schema`, with RLS enabled and
policies on `crm_people`, `crm_notes`, `crm_tasks` and `agent_memories`.

The section below was last checked 2026-06-16 — note that a dated "verified"
line only covers what existed on that date. **Re-verify against
`information_schema` when shipping, not against this file.**

## Earlier prod state — verified 2026-06-16

All of the above are **applied** to prod project `voyrjqgaypiylwskkwpr`. Verified via
`information_schema` (tables: `follow_ups`, `tool_jobs`, `invoice_recurrence`,
`user_assets`, `user_files`, `invoice_payments`, `sms_providers`, `sms_templates`,
`sms_logs`, `otp_codes`, `custom_entity_fields`, `custom_entity_values`;
columns: `crm_customers.trn`, `invoice_docs.{doc_type,stamp,custom_columns}`,
`invoice_doc_items.unit`, `products.{custom_fields,unit}`).

## Convention — prevents the recurring drift bug

Twice now a column was added to a TypeScript interface but never to the DB, so
inserts failed in production with PostgREST `PGRST204` (`invoice-missing-columns`,
`product-missing-columns`). **Rule:**

> When you add a field to a `src/lib/api.ts` interface (or any persisted type),
> in the **same change** you must:
> 1. add `alter table … add column if not exists …` to `schema.sql` (baseline parity), **and**
> 2. add a dated, idempotent migration file here, **and**
> 3. apply it to prod before the feature ships.

A column referenced by the app but absent in the DB is a silent production failure
— it does not show up in `npm run build` or local tests if local DB is ahead.

## Staff access gate (applied 2026-09-17)

`2026-09-12-module-access.sql` is applied, and the `integrations` edge function
is deployed alongside it. See [business permissions](../docs/business-permissions.md).
Disposable PostgreSQL tests do not prove production policy state — re-read
`pg_policies` when in doubt.
# Optional AI credits — 20 September 2026

Apply `2026-09-20-ai-credits.sql` before deploying `ai-credits` and the updated
`dodo`. This adds four account-isolated cloud billing tables and the service-only
`filey_ai_wallet` transaction function. These tables must **not** be added to the
desktop synchronization allowlist. See [AI credits setup](../docs/ai-credits.md)
for provider secrets, Dodo products, webhook events and release checks.

## Workspace sync recovery — 25 September 2026

Apply `2026-09-25-workspace-sync-recovery.sql` before shipping the expanded
device/cloud choice. Installation changes no business records. The explicit
choice can reconnect the signed-in owner's records from a retired workspace
they also own, only when no profiles and no other members remain there. It
preserves IDs, content, links and archived company profiles. Nullable invoice
lines/payments are preserved as private owner data; linked-row permissions and
revision checks remain enforced. `node scripts/test-rls-local.mjs` exercises
these guards on disposable PostgreSQL data.

Applied to `voyrjqgaypiylwskkwpr` on 25 September 2026. Read-back verified
the recovery RPC, authenticated-only execution, private eligibility helper,
and both owner-only unlinked-row policies. The recovery RPC was **not called**
against customer data; the 12 legacy workspace settings remained in place.

## CRM custom fields — verified present 1 October 2026

Apply `2026-09-28-crm-custom-fields.sql` before releasing the expanded CRM field
editor. Adds `custom_fields` JSONB to leads, opportunities, tasks, notes and
activities; company/contact columns already exist. Definitions remain in scoped
app settings. No permissions or record values are removed. The schema snapshot
includes the same migration; disposable PostgreSQL tests apply it twice and
verify stored values survive another application. Production catalog inspection
confirmed all five new columns in `voyrjqgaypiylwskkwpr` on 1 October 2026.

## Avatar shape and colour choices — applied 30 September 2026

`2026-09-30-avatar-choices.sql` is applied to `voyrjqgaypiylwskkwpr` before the
web picker rollout. The constraint accepts ten legacy presets and exactly 100
local Blobatar shape/colour SVG paths. Read-back confirmed the new constraint,
authenticated RPC execution, and denied anonymous execution. No customer
records or RPC permissions were changed. Disposable RLS tests cover self/admin
updates and reject arbitrary URLs and cross-workspace updates.

## Security boundaries — applied 30 September 2026

Applied to `voyrjqgaypiylwskkwpr` in this order:

1. `2026-09-30-tool-path-integrity.sql`: canonical owner-scoped tool paths.
2. `2026-09-30-stripe-payment-integrity.sql`: service-only atomic paid-checkout settlement.
3. `2026-09-30-workspace-billing-acl.sql`: protected billing columns and owner-only workspace deletion.
4. `2026-09-30-mfa-enforcement.sql`: verified-factor assurance checks in RLS, Storage and the PostgREST pre-request hook.

These migrations change permissions and add settlement receipts; they do not
rewrite customer records or reconcile historical payments. The matching edge
functions retain their existing JWT gateway settings and verify users, provider
signatures or server trigger secrets inside their handlers. Disposable PostgreSQL
checks reproduce the old billing exploit, test denial and normal workspace
creation, and deliver eight concurrent Stripe callbacks to prove one settlement.

## E-invoice document identity — applied 30 September 2026

Apply `2026-09-29-einvoice-identity.sql` before releasing the expanded e-invoice
save/export workflow. It adds the document and company e-invoice JSON fields,
retains the existing UAE invoice columns and preserves an existing document
UUID during updates from stale clients or sync. It rewrites no customer rows.
This does not enable automatic provider submission or store provider credentials.
Production catalog inspection confirmed the invoice JSON field on 1 October 2026.

## Hosted agent draft transactions — applied 30 September 2026

Apply `2026-09-30-channel-agent-drafts.sql` before deploying the hardened
`channel-webhook`. The service-only RPC verifies the current owner/admin
workspace and saves invoice, quotation or purchase-order headers, lines and
audit entries in one transaction. It changes no existing customer records.
`schema.sql` includes the same function. Disposable PostgreSQL checks cover
role/workspace rejection, field allowlists and rollback after a failed line.
Missing migration fails closed. Production catalog inspection confirmed
`filey_channel_create_draft` on 1 October 2026.

## Scheduled jobs and license write integrity — applied 1 October 2026

Apply `2026-09-30-scheduled-write-integrity.sql` before deploying `dodo`, `stripe` and `agent-jobs`. The service-only RPCs serialize device slot claims and commit scheduled PO headers, lines and audit together. Existing rows are not rewritten. Repeatability, denied callers, rollback, retry and concurrent claims/jobs are checked by `node scripts/test-channel-agent-local.mjs`. Deploy `overdue-reminders`, `send-email`, `team-invite` and `channel-webhook` for provider-receipt validation and truthful failure reporting. No new secrets are required.

Applied to `voyrjqgaypiylwskkwpr`. Catalog read-back verified both RPCs are
security-definer functions executable only by `service_role`; authenticated and
anonymous clients cannot call them.

## Team owner membership integrity — applied 1 October 2026

Apply `2026-10-01-team-owner-integrity.sql` after `2026-09-30-workspace-billing-acl.sql` (the migration refuses insecure ownership grants) to protect actual owner memberships against API demotion, removal or identity replacement. The trigger also denies manufacturing another owner role. Normal member administration and non-owner leaving remain supported; trusted service-role account cleanup is unchanged. Existing rows are not rewritten. `node scripts/test-mfa-local.mjs` reproduces the old admin takeover, applies the migration twice and proves denial plus compatibility. There is currently no user-facing ownership transfer flow; any future transfer must be a trusted transaction that changes `organizations.owner_id` with the memberships.

Applied to `voyrjqgaypiylwskkwpr`. Catalog read-back verified the enabled
membership trigger and denied client updates to `organizations.owner_id`.

## Stripe subscription ordering integrity — applied 1 October 2026

Apply `2026-10-01-stripe-subscription-integrity.sql` after the deployed workspace billing ACL and before deploying `stripe`. It adds nullable subscription delivery timestamps and a service-only transaction; existing customer rows are not rewritten. The verified Stripe webhook retrieves current subscription state, matches the bound customer/workspace and rejects older events and replaced subscription IDs. Independent Dodo, Ultra and permanent license grants remain protected. Current active subscriptions require billing management rather than a second checkout; terminal subscriptions can renew. A missing migration or failed retrieval returns a retryable webhook error.

`node scripts/test-mfa-local.mjs` applies the migration twice and checks authority, ordering, replacement, entitlement protection and concurrent delivery. Pure fake-provider Deno checks verify current-state retrieval and failures without Stripe calls. Existing event subscriptions and Stripe secrets remain sufficient. No historical payment reconciliation or provider subscription cancellation is performed. The unsupported legacy public `pay_invoice` action returns HTTP 410 with contact-seller guidance; verified historical settlement webhooks and authenticated plan/license actions remain supported. Seller invoice checkout requires a future configured seller payment destination.

Applied to `voyrjqgaypiylwskkwpr`. Read-back verified the added observation
column, denied client writes and service-only RPC execution.

## Removed-member read integrity — pending 3 October 2026

Apply `2026-10-03-workspace-membership-read-integrity.sql` after the team,
Basic-web and workspace billing ACL migrations. A removed or departed member's
profile can still select the former workspace; that stale selection must not
authorize its roster, colleague profiles, organization or company/bank identity.
The repaired read policies require actual membership. Personal profiles and
the caller's other memberships/owned organizations remain readable. Current
members retain shared identity access; only permitted Invoicing members see
the monthly invoice counter. The cloud-access helper also checks membership.
The audit trail includes complete private record snapshots, so reading it is
reserved to current owners/admins. Members may still append events attributed
to their own authenticated identity; removed members cannot append. Legacy
`app_users` reads and writes require current membership as well. The audit trail
remains append-only, and server audit triggers keep their existing authority.

The migration is additive and repeatable, changes no customer rows and is
included in `schema.sql`. `npm run test:rls:local` reproduces the prior disclosures
in a disposable database, applies the repair twice and checks denied reads after
removal/self-leaving, private invoice/payroll audit denial, own-event attribution,
legacy-user writes, normal member/owner access, module restrictions and helper
grants. This migration has **not been applied to production**; publishing and
live schema changes remain on hold.

## Atomic payroll posting — pending 4 October 2026

Apply `2026-10-04-atomic-payroll.sql` before releasing the matching `hr.runPayroll`
client. One invoker RPC now saves the payslip, both ledger entries and account
balances in one transaction, bound to the reviewed account and workspace.
It retains the existing pending-status posting behavior. A failed ledger leg
rolls back the whole run, and competing runs cannot pay the same employee/period
twice. Private period claims preserve existing duplicate history and remain
reserved after payroll/employee deletion; authenticated users cannot rewrite
claims or a posted payroll's identity/amounts. Status updates remain supported.

`node scripts/test-rls-local.mjs --payroll` uses a disposable PostgreSQL cluster
to check rollback, balances, concurrent attempts, hidden historic duplicates,
actor/workspace/module boundaries, malformed periods and claim mutation denial.
The migration is repeatable and included in `schema.sql`. No live schema changes
have been made. Older cloud schemas fail closed instead of partially posting.

## Paid entitlement claim serialization — pending 4 October 2026

Apply `2026-10-04-subscription-claim-serialization.sql` after the billing integrity
migration. Claiming distinct parked Pro purchases now locks and rechecks the
eligible workspace before changing its subscription/customer binding. Concurrent
admins cannot consume both paid entitlements for one workspace: the winning
purchase is bound and the other remains unclaimed. Freedom claims retain their
existing behavior. The migration is repeatable, changes no stored business rows
and is included in `schema.sql`.

`node scripts/test-rls-local.mjs --billing-claims` reproduces the old two-purchase
race in a disposable PostgreSQL cluster and verifies the repair after applying
it twice, including matching subscription/customer identity and denied anonymous
execution. This migration has not been applied to production.

## Cloud storage and scheduled-delivery privacy — pending 4 October 2026

Apply `2026-10-04-cloud-storage-privacy.sql` after the storage/tool pipeline and
`2026-09-30-tool-path-integrity.sql`. It forces the four intended-private buckets
(`files`, `tool-inputs`, `tool-outputs`, `team-attachments`) to `public=false`,
preserving object data, file limits and unrelated buckets. Retention is
service-only, and cleanup verifies that each client-supplied run path belongs
to that run's owner before deleting the output. This repairs both managed
default client grants and a forged-path service-cleanup attack.

Apply `2026-10-04-scheduled-agent-privacy.sql` after workspace membership helpers
and before deploying the matching `agent-jobs` and `overdue-reminders` endpoints.
Their final delivery check uses one service-only statement to confirm the
original owner is still an admin of the original active workspace. Revocation,
workspace changes and lookup failure stop delivery; no provider message is
sent. The helper is intentionally inaccessible to anonymous/authenticated RPCs.

Both migrations are repeatable and included in the canonical fresh installer.
`node scripts/test-cloud-privacy-local.mjs` reproduces the old failures using
synthetic users, applies the repairs twice, verifies private storage, direct
attachments, job outputs, secret columns, MFA and public-share boundaries, and
checks that repeated installation preserves the objects. The runtime catalog
now includes private bucket flags and effective service-function grants. No
production schema, Storage configuration or Edge deployment was changed or
independently inspected during this review; release remains on hold.

## 2026-10-04 AI completion delivery recovery

Apply `2026-10-04-ai-completion-recovery.sql` before deploying the updated
`ai-credits` function and web frontend. The canonical fresh installer includes
it. Cloud Filey AI requests atomically reserve a private request receipt, return
immediately, and run inference with `EdgeRuntime.waitUntil`. The verified result
and Coin charge commit together; a reconnect only reads the original receipt.
Request UUIDs cannot be reused with different content, ownership or workspace.

Only service-role RPCs may read/write response receipts. Every user read checks
current profile and organization membership after JWT/MFA authentication.
Responses expire after 30 minutes. On hosted databases with pg_cron, the
`filey-ai-completion-purge` job clears expired content each minute; installations
without pg_cron reject expired reads and clear content on the next account read.
No prompts are persisted by this cache. Local mode and BYOK requests retain
their existing storage behavior. Account/workspace changes and Stop cannot
execute late tool output. Disposable SQL and transport tests use synthetic data
and do not call a paid provider.
