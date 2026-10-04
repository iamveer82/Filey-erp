create or replace function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('session_id',coalesce(nullif(current_setting('test.session',true),''),'session-a')) $$;
create table if not exists auth.sessions(id text primary key,user_id uuid,created_at timestamptz);
create or replace function public.filey_is_workspace_member(p_org text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and exists(select 1 from public.org_members m where m.org_id=p_org and m.user_id=auth.uid())
$$;
insert into org_members(org_id,user_id,role) values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','staff');
update profiles set org_id='10000000-0000-0000-0000-000000000001' where id in ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');
grant select,delete on org_devices to authenticated;
set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000001';
select register_device('owner-browser');
set test.uid='00000000-0000-0000-0000-000000000002';
do $$ begin
  assert exists(select 1 from org_devices where fingerprint='owner-browser'),'Baseline exposes another member device credential';
  assert (register_device('owner-browser')->>'ok')::boolean,'Baseline allows fingerprint takeover';
end $$;
-- This account has no membership but retains the old workspace profile.
set test.uid='00000000-0000-0000-0000-000000000003';
do $$ begin
  assert exists(select 1 from org_devices),'Baseline exposes former workspace devices';
  assert (register_device('former-member-browser')->>'ok')::boolean,'Baseline allows former-member slot occupation';
end $$;
reset role;
delete from org_devices;
select 'PASS: baseline device registry exposes credentials, permits staff takeover and former-member registration.';
