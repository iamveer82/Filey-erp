reset role;
update org_members set modules=array['inventory'] where user_id='00000000-0000-0000-0000-000000000001';
set role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
do $$ declare n integer; outcome jsonb; begin
  if not public.filey_can_use('inventory') or public.filey_can_use('people') then raise exception 'module grants incorrect'; end if;
  if (public.filey_module_access()->>'admin')::boolean then raise exception 'staff is not an admin'; end if;
  if exists(select 1 from employees) or exists(select 1 from invoice_docs) or exists(select 1 from invoice_payments) then raise exception 'forbidden records visible'; end if;
  if exists(select 1 from app_settings where key='bank_accounts') then raise exception 'bank settings visible'; end if;
  if not exists(select 1 from app_settings where key='modules.disabled') then raise exception 'module UI settings unavailable'; end if;
  update employees set name='forbidden' where id=1; get diagnostics n=row_count;
  if n<>0 then raise exception 'forbidden update'; end if;
  delete from payroll where id=1; get diagnostics n=row_count;
  if n<>0 then raise exception 'forbidden delete'; end if;
  begin
    insert into employees(id,name) values(999,'forbidden');
    raise exception 'forbidden insert succeeded';
  exception when insufficient_privilege then null; end;
  if (public.share_invoice(1,true,'[]')->>'ok')::boolean then raise exception 'sharing RPC bypass'; end if;
  begin
    outcome := public.sync_record('employees','{"id":999,"name":"forbidden"}',null,false);
    if outcome->>'status'='ok' then raise exception 'sync RPC bypass'; end if;
  exception when insufficient_privilege then null; end;
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000004',false);
do $$ begin
  if not public.filey_can_use('people') then raise exception 'admin blocked'; end if;
  if not exists(select 1 from employees) then raise exception 'admin cannot read'; end if;
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000009',false);
do $$ begin
  if public.filey_can_use('people') or (public.filey_module_access()->>'allowed')::boolean then raise exception 'missing member allowed'; end if;
end $$;
reset role;
select 'PASS: module restrictions apply to reads, writes, sharing and sync RPC; missing membership denied.';
