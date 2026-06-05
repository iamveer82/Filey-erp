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
3. `verify-rls.sql` — run last to assert RLS is enabled everywhere (check, not a change).

## Prod state — verified 2026-06-05

All of the above are **applied** to prod project `voyrjqgaypiylwskkwpr`. Verified via
`information_schema` (tables: `follow_ups`, `tool_jobs`, `invoice_recurrence`,
`user_assets`, `user_files`, `invoice_payments`; columns: `crm_customers.trn`,
`invoice_docs.{doc_type,stamp,custom_columns}`, `invoice_doc_items.unit`,
`products.custom_fields`).

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
