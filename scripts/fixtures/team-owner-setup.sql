create or replace function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
create table org_members(id bigint generated always as identity primary key,org_id text,user_id uuid,role text,unique(org_id,user_id));
create function is_org_admin() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from org_members where org_id=current_org() and user_id=auth.uid() and role in ('owner','admin'));
$$;
alter table org_members enable row level security;
create policy org_members_read on org_members for select to authenticated using(org_id=current_org());
create policy org_members_admin on org_members for all to authenticated using(org_id=current_org() and is_org_admin()) with check(org_id=current_org() and is_org_admin());
create policy org_members_self_leave on org_members for delete to authenticated using(user_id=auth.uid());
grant select,insert,update,delete on org_members to authenticated,service_role;
grant usage on sequence org_members_id_seq to authenticated,service_role;
insert into org_members(org_id,user_id,role) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','admin'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','staff');
-- Prove the old policy actually permits API admin takeover, then roll back.
begin;
set local role authenticated;
set local test.claims='{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}';
set local test.org='10000000-0000-0000-0000-000000000001';
update org_members set role='viewer' where user_id='00000000-0000-0000-0000-000000000001';
select assert_equal((select role from org_members where user_id='00000000-0000-0000-0000-000000000001'),'viewer'::text,'Old admin API demotes actual owner');
delete from org_members where user_id='00000000-0000-0000-0000-000000000001';
select assert_equal((select count(*) from org_members where user_id='00000000-0000-0000-0000-000000000001'),0::bigint,'Old admin API removes actual owner');
rollback;
