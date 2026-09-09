-- Apply before publishing the international-business update.
-- Nullable snapshots preserve pre-existing documents exactly; no inferred backfill.
begin;
alter table public.company_profile add column if not exists country_code text;
alter table public.invoice_docs add column if not exists tax_country_code text;
alter table public.quotations add column if not exists tax_country_code text;
alter table public.purchase_orders add column if not exists tax_country_code text;
alter table public.purchase_orders add column if not exists fx_rate numeric;
alter table public.payment_receipts add column if not exists tax_country_code text;
-- Existing organization/owner RLS and permissions continue to apply.
comment on column public.company_profile.country_code is 'Explicit business registration country (ISO 3166-1 alpha-2), independent of currency';
comment on column public.invoice_docs.tax_country_code is 'Jurisdiction snapshot; null means legacy currency-based labels';
notify pgrst, 'reload schema';
commit;
