-- Additive CRM upgrade. Preserve existing records and their row-level policies.
begin;
alter table public.crm_people add column if not exists telegram text;
alter table public.crm_leads add column if not exists converted_company_id bigint references public.crm_customers(id) on delete set null;
alter table public.crm_leads add column if not exists converted_person_id bigint references public.crm_people(id) on delete set null;
alter table public.crm_leads add column if not exists converted_deal_id bigint references public.crm_opportunities(id) on delete set null;

-- A row lock makes retries and simultaneous conversions return the same deal.
-- SECURITY INVOKER keeps the caller's existing RLS/tenant permissions in force.
create or replace function public.filey_convert_lead(p_lead_id bigint)
returns bigint language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  lead public.crm_leads%rowtype;
  company_id bigint;
  person_id bigint;
  deal_id bigint;
begin
  if auth.uid() is null then raise exception 'Sign in to convert a lead'; end if;
  select * into lead from public.crm_leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found or access denied'; end if;
  if lead.converted_deal_id is not null then return lead.converted_deal_id; end if;
  if lead.status = 'converted' then raise exception 'This lead was already converted. Find its company and deal in CRM.'; end if;
  if nullif(trim(lead.name), '') is null then raise exception 'A lead needs a name'; end if;
  insert into public.crm_customers(name, company, email, phone, segment)
    values(lead.name, coalesce(nullif(lead.company, ''), lead.name), lead.email, lead.phone, 'Converted lead') returning id into company_id;
  insert into public.crm_people(company_id, name, email, phone, owner, is_primary)
    values(company_id, lead.name, lead.email, lead.phone, lead.owner, true) returning id into person_id;
  insert into public.crm_opportunities(title, customer_name, customer_id, person_id, stage, value, probability, owner)
    values(coalesce(nullif(lead.company, ''), lead.name) || ' — new opportunity', coalesce(nullif(lead.company, ''), lead.name), company_id, person_id, 'qualification', greatest(lead.est_value, 0), 20, lead.owner) returning id into deal_id;
  update public.crm_leads set status = 'converted', converted_company_id = company_id, converted_person_id = person_id, converted_deal_id = deal_id where id = p_lead_id;
  if not found then raise exception 'Lead update denied'; end if;
  return deal_id;
end;
$$;
revoke all on function public.filey_convert_lead(bigint) from public, anon;
grant execute on function public.filey_convert_lead(bigint) to authenticated;

create index if not exists crm_leads_status_created_idx on public.crm_leads (org_id, status, created_at);
create index if not exists crm_opportunities_stage_close_idx on public.crm_opportunities (org_id, stage, expected_close);
create index if not exists crm_people_org_company_idx on public.crm_people (org_id, company_id);
notify pgrst, 'reload schema';
commit;
