-- Run via the management API or psql as the database owner. All test rows roll back.
begin;
select set_config('request.jwt.claim.sub', (select user_id::text from public.org_members where role = 'owner' order by created_at limit 1), true);
set local role authenticated;
do $$
declare
  lead_id bigint;
  deal_id bigint;
  again bigint;
  test_company_id bigint;
  test_person_id bigint;
begin
  if auth.uid() is null then raise exception 'Test needs an existing organization owner'; end if;
  insert into public.crm_leads(name, company, est_value) values ('CRM transactional verification', 'CRM verification only', 12500) returning id into lead_id;
  deal_id := public.filey_convert_lead(lead_id);
  again := public.filey_convert_lead(lead_id);
  if deal_id is distinct from again then raise exception 'Conversion is not idempotent'; end if;
  select d.customer_id, d.person_id into test_company_id, test_person_id from public.crm_opportunities d where d.id = deal_id;
  if test_company_id is null or test_person_id is null then raise exception 'Conversion did not link its records'; end if;
  if not exists(select 1 from public.crm_people p where p.id = test_person_id and p.company_id = test_company_id) then raise exception 'Contact has the wrong company'; end if;
  if not exists(select 1 from public.crm_leads l where l.id = lead_id and l.status = 'converted' and l.converted_deal_id = deal_id) then raise exception 'Lead state is inconsistent'; end if;
  begin
    perform public.filey_convert_lead(-1);
    raise exception 'Missing lead unexpectedly converted';
  exception when others then
    if sqlerrm = 'Missing lead unexpectedly converted' then raise; end if;
  end;
end;
$$;
reset role;
do $$ begin
  if has_function_privilege('anon', 'public.filey_convert_lead(bigint)', 'execute') then raise exception 'Anonymous conversion must be denied'; end if;
end $$;
rollback;
