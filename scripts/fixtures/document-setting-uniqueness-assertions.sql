-- Synthetic data inside the disposable PostgreSQL runner only.
begin;
do $$ begin
  if to_regclass('public.app_settings_user_id_key_key') is not null
    or to_regclass('public.app_settings_user_id_key') is not null
    or to_regclass('public.fixture_legacy_settings_pair') is not null then
    raise exception 'Legacy global user/key uniqueness remains'; end if;
  if to_regclass('public.fixture_unrelated_settings_index') is null then
    raise exception 'Repair removed an unrelated index'; end if;
  if not (select relrowsecurity from pg_class where oid='public.app_settings'::regclass) then
    raise exception 'Repair disabled settings RLS'; end if;
end $$;

insert into app_settings(id,user_id,org_id,key,value) values
  (5301,'00000000-0000-0000-0000-000000000001','a','packaging_lists','workspace-a'),
  (5302,'00000000-0000-0000-0000-000000000001','b','packaging_lists','workspace-b'),
  (5303,'00000000-0000-0000-0000-000000000001','a','letters','[{"form":{"blocks":[],"body":"workspace-a"}}]'),
  (5304,'00000000-0000-0000-0000-000000000001','b','letters','[{"form":{"blocks":[],"body":"workspace-b"}}]'),
  (5305,'00000000-0000-0000-0000-000000000001','a','uniqueness_regular_setting','original'),
  (5306,'00000000-0000-0000-0000-000000000002','a','uniqueness_regular_setting','another-user');
do $$ begin
  begin
    insert into app_settings(id,user_id,org_id,key,value) values
      (5307,'00000000-0000-0000-0000-000000000002','a','packaging_lists','duplicate');
    raise exception 'Repair allowed two Packing List collections in one org';
  exception when unique_violation then null; end;
  begin
    insert into app_settings(id,user_id,org_id,key,value) values
      (5308,'00000000-0000-0000-0000-000000000002','a','letters','[]');
    raise exception 'Repair allowed two Letter collections in one org';
  exception when unique_violation then null; end;
  begin
    insert into app_settings(id,user_id,org_id,key,value) values
      (5309,'00000000-0000-0000-0000-000000000001','b','uniqueness_regular_setting','duplicate');
    raise exception 'Repair broadened ordinary settings uniqueness';
  exception when unique_violation then null; end;
  if (select count(*) from app_settings where key='packaging_lists')<>2
    or (select count(*) from app_settings where key='letters')<>2 then
    raise exception 'Same user cannot retain documents across orgs'; end if;
end $$;
rollback;
select 'PASS: repaired legacy user/key uniqueness allows separate document orgs while retaining one collection per org and ordinary per-user uniqueness.';
