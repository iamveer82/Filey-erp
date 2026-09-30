-- Additive only. Local collections preserve these JSON fields without a
-- SQLite migration; cloud sync requires these columns before app deployment.
begin;
-- Include the original field migration for installations that missed it.
alter table invoice_docs add column if not exists invoice_type_code text;
alter table invoice_docs add column if not exists transaction_type text;
alter table invoice_docs add column if not exists payment_means_code text;
alter table invoice_docs add column if not exists buyer_city text;
alter table invoice_docs add column if not exists buyer_country_subdivision text;  -- emirate
alter table invoice_docs add column if not exists buyer_country_code text;         -- default AE
alter table invoice_docs add column if not exists seller_city text;
alter table invoice_docs add column if not exists seller_country_subdivision text;  -- emirate
alter table invoice_docs add column if not exists seller_legal_id text;
alter table invoice_docs add column if not exists seller_legal_id_type text;         -- TL / EID / PAS / CD
alter table invoice_docs add column if not exists original_invoice_number text;
alter table invoice_docs add column if not exists original_invoice_date date;
alter table invoice_docs add column if not exists aed_exchange_rate numeric;
alter table invoice_doc_items add column if not exists tax_category text;
alter table company_profile add column if not exists legal_id text;             -- trade-license / EID / passport / cabinet-decision no.
alter table company_profile add column if not exists legal_id_type text;        -- TL / EID / PAS / CD
alter table company_profile add column if not exists country_subdivision text;  -- emirate
alter table crm_customers add column if not exists city text;
alter table crm_customers add column if not exists country_subdivision text;    -- emirate
alter table crm_customers add column if not exists country_code text;           -- default AE
alter table public.invoice_docs add column if not exists einvoice jsonb;
alter table public.company_profile add column if not exists einvoice jsonb;
comment on column public.invoice_docs.einvoice is 'PINT-AE document UUID and seller/buyer identity snapshots. Never store provider credentials here.';
comment on column public.company_profile.einvoice is 'Corporate Tax identity and registered electronic address, separate from VAT TRN.';

-- Protect identity through all cloud writers, including stale clients/sync.
create or replace function public.preserve_einvoice_uuid() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.einvoice is not null and jsonb_typeof(new.einvoice) <> 'object' then
    raise exception 'E-invoice details must be an object.';
  end if;
  if tg_op = 'UPDATE' and old.einvoice->>'uuid' is not null then
    new.einvoice := coalesce(new.einvoice, old.einvoice) || jsonb_build_object('uuid', old.einvoice->>'uuid');
  end if;
  return new;
end;
$$;
drop trigger if exists invoice_einvoice_identity on public.invoice_docs;
create trigger invoice_einvoice_identity before insert or update on public.invoice_docs
for each row execute function public.preserve_einvoice_uuid();
notify pgrst, 'reload schema';
commit;
