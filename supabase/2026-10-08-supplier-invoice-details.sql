-- Optional saved supplier location and electronic invoicing identity. Existing
-- supplier rows, tenant policies, module access and table grants stay intact.
begin;
alter table public.suppliers add column if not exists custom_fields jsonb default '{}';
comment on column public.suppliers.custom_fields is
  'Optional string-valued fields including city, country_subdivision, country_code and serialized einvoice_identity.';
notify pgrst, 'reload schema';
commit;
