-- Add customer columns used by the UI/codebase but missing from older DBs.
-- Idempotent and safe to re-run.
alter table public.crm_customers add column if not exists trn text;
alter table public.crm_customers add column if not exists phone_e164 text;
alter table public.crm_customers add column if not exists custom_fields jsonb default '{}';
alter table public.crm_customers add column if not exists shared boolean not null default false;

-- Backfill existing rows with sane defaults so app queries don't see nulls.
update public.crm_customers set custom_fields = coalesce(custom_fields, '{}') where custom_fields is null;
update public.crm_customers set shared = coalesce(shared, false) where shared is null;
