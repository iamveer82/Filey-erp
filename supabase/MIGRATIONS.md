# Supabase migrations — apply order & convention

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

Applied to the configured Filey cloud project on 13 September 2026. Both expense RPCs were verified as SECURITY INVOKER with authenticated-only execution. Behavioral checks ran against a disposable PostgreSQL database; production business records were not changed for testing.

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

## Staff access gate (2026-09-12; deployment pending)

Apply `2026-09-12-module-access.sql` after shared-record and sync-conflict migrations and all feature migrations. Deploy the integrations edge function alongside the frontend. See [business permissions](../docs/business-permissions.md). Disposable PostgreSQL tests do not deploy production policies.
