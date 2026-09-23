# Supabase migrations — apply order & convention

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
Every migration uses `create table if not exists` / `add column if not exists` /
`drop policy if exists … create policy …`, so the whole set is safe to re-run.

## Apply order (fresh DB or to catch up an existing one)

Run in the Supabase Dashboard → SQL Editor (or `supabase db execute --file <f>`):

1. `schema.sql` — baseline: all core tables, RLS, triggers, RPCs, `force_org_id`, atomic counters.
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
