-- Disposable PostgreSQL only. Production functions and indices are unchanged.
begin;
insert into app_settings(id,user_id,org_id,key,value) values
  (5101,'00000000-0000-0000-0000-000000000001','a','packaging_lists','original-a'),
  (5102,'00000000-0000-0000-0000-000000000001','b','packaging_lists','original-b'),
  (5103,'00000000-0000-0000-0000-000000000001','a','packaging_fixture_other','original-other'),
  (5107,'00000000-0000-0000-0000-000000000001','a','packaging_list_number_format','PL-CUSTOM-{001}');
do $$ begin
  begin
    insert into app_settings(id,user_id,org_id,key,value) values
      (5104,'00000000-0000-0000-0000-000000000002','a','packaging_lists','duplicate');
    raise exception 'Two users created separate packaging collections in one org';
  exception when unique_violation then null; end;
  begin
    insert into app_settings(id,user_id,org_id,key,value) values
      (5105,'00000000-0000-0000-0000-000000000001','b','packaging_fixture_other','duplicate');
    raise exception 'Legacy user/key uniqueness was broadened for other settings';
  exception when unique_violation then null; end;
  if (select count(*) from app_settings where key='packaging_lists') <> 2 then
    raise exception 'Same user cannot retain packaging lists in separate orgs'; end if;
end $$;

update org_members set modules=array['inventory'] where user_id in
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
set local role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000001',true);
do $$ declare n integer; begin
  if exists(select 1 from app_settings where key='packaging_lists') then raise exception 'Denied module exposed packaging lists'; end if;
  if exists(select 1 from app_settings where key='packaging_list_number_format') then raise exception 'Denied module exposed packaging numbering'; end if;
  update app_settings set value='forbidden' where id=5101; get diagnostics n=row_count;
  if n <> 0 then raise exception 'Denied module updated packaging lists'; end if;
  delete from app_settings where id=5101; get diagnostics n=row_count;
  if n <> 0 then raise exception 'Denied module deleted packaging lists'; end if;
  begin
    insert into app_settings(id,key,value) values(5106,'packaging_lists','forbidden');
    raise exception 'Denied module inserted packaging lists';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update org_members set modules=array['packaging-list'] where user_id='00000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$ declare n integer; outcome jsonb; begin
  if not exists(select 1 from app_settings where id=5101) or exists(select 1 from app_settings where id=5102) then
    raise exception 'Packaging access failed org isolation'; end if;
  if exists(select 1 from app_settings where key='bank_accounts') then raise exception 'Packaging permission exposed another module'; end if;
  if not exists(select 1 from app_settings where id=5107 and value='PL-CUSTOM-{001}') then raise exception 'Packaging staff cannot read saved numbering'; end if;
  update app_settings set value='staff-changed-numbering' where id=5107; get diagnostics n=row_count;
  if n <> 0 then raise exception 'Packaging staff changed admin numbering'; end if;
  update app_settings set value='edited-a' where id=5101 and sync_revision=1; get diagnostics n=row_count;
  if n <> 1 then raise exception 'Permitted packaging CAS update failed'; end if;
  update app_settings set value='stale-overwrite' where id=5101 and sync_revision=1; get diagnostics n=row_count;
  if n <> 0 or (select value from app_settings where id=5101) <> 'edited-a' then raise exception 'Stale CAS replaced packaging data'; end if;
  update app_settings set value='forbidden' where id=5102; get diagnostics n=row_count;
  if n <> 0 then raise exception 'Cross-org packaging update allowed'; end if;
  outcome := public.sync_record('app_settings','{"id":5121,"key":"packaging_lists","value":"offline-version"}',null,false);
  if outcome->>'conflict' is distinct from 'true' or (select value from app_settings where id=5101) <> 'edited-a' then
    raise exception 'Offline packaging setting did not preserve the existing cloud collection as a reviewable conflict'; end if;
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  if not exists(select 1 from app_settings where id=5101) then raise exception 'Admin packaging access denied'; end if;
end $$;
reset role;
do $$ begin
  if (select value from app_settings where id=5102) <> 'original-b'
    or (select value from app_settings where id=5103) <> 'original-other' then raise exception 'Unrelated data changed'; end if;
end $$;
rollback;
select 'PASS: Packaging settings preserve org isolation, module permissions, CAS and legacy uniqueness; migration is repeatable.';
