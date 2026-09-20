-- Disposable local fixtures only. Roll back profile removal/recreation.
begin;
alter table public.profiles alter column org_id set default 'default';
delete from public.profiles where id='00000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000003',true);
do $$ begin
  begin
    insert into public.profiles(id,org_id,name) values(auth.uid(),'10000000-0000-0000-0000-000000000001','Stranger');
    raise exception 'Profile accepted an unrelated workspace';
  exception when insufficient_privilege then null; end;
  insert into public.profiles(id,name) values(auth.uid(),'Restored profile');
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000001',true);
insert into public.profiles(id,name) values(auth.uid(),'Owner profile')
  on conflict(id) do update set name=excluded.name;
rollback;
select 'PASS: profile recreation rejects unrelated workspaces; normal onboarding/upserts still work.';
