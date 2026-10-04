-- Reproduce the deployed read policies before the membership repair.
-- Only synthetic identities and records in a disposable PostgreSQL database.
set client_min_messages=warning;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid',true),'')::uuid
$$;
create table profiles(id uuid primary key,org_id text,name text,email text);
create table organizations(id uuid primary key,owner_id uuid,name text);
create table org_members(org_id text,user_id uuid,role text,modules text[],primary key(org_id,user_id));
create table company_profile(id bigint primary key,org_id text,name text,bank_details text);
create table invoice_monthly_usage(org_id uuid,month date,used integer,primary key(org_id,month));
create table audit_log(id bigint primary key,org_id text,user_id uuid default auth.uid(),entity text,changes jsonb);
create table app_users(id bigint primary key,org_id text,user_id uuid,username text,full_name text,active boolean default true);
insert into profiles values
 ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Owner','owner@example.invalid'),
 ('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Former member','former@example.invalid'),
 ('00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Current member','member@example.invalid'),
 ('00000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002','Other company','other@example.invalid');
insert into organizations values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Team'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','Personal');
insert into org_members values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','owner',null),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','staff',array['team']),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','staff',array['team','invoicing']),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','owner',null),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004','staff',null);
insert into company_profile values(1,'10000000-0000-0000-0000-000000000001','Team','Synthetic bank details'),
 (2,'10000000-0000-0000-0000-000000000002','Personal','Synthetic personal bank');
insert into invoice_monthly_usage values('10000000-0000-0000-0000-000000000001',date_trunc('month',now() at time zone 'UTC')::date,19);
insert into audit_log values
 (1,'10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','invoice_docs','{"_created":{"shared":false,"customer_name":"Private customer","total":9000}}'),
 (2,'10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','payroll','{"_created":{"employee":"Private employee","salary":8000}}');
insert into app_users values(1,'10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','legacy','Synthetic user',true);
create function current_org() returns text language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select org_id from profiles where id=auth.uid()),'default')
$$;
create function is_org_admin() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from org_members where org_id=current_org() and user_id=auth.uid() and role in('owner','admin'))
$$;
create function filey_can_use(p_module text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from org_members where org_id=current_org() and user_id=auth.uid()
    and(role in('owner','admin') or modules is null or p_module=any(modules)))
$$;
alter table profiles enable row level security;
alter table organizations enable row level security;
alter table org_members enable row level security;
alter table company_profile enable row level security;
alter table invoice_monthly_usage enable row level security;
alter table audit_log enable row level security;
alter table app_users enable row level security;
create policy profiles_self_select on profiles for select to authenticated using(id=auth.uid());
create policy profiles_org_read on profiles for select to authenticated using(org_id=current_org());
create policy org_members_select on org_members for select to authenticated using(org_id=current_org() or user_id=auth.uid());
create policy org_members_self_leave on org_members for delete to authenticated using(user_id=auth.uid());
create policy organizations_read on organizations for select to authenticated using(id::text=current_org() or owner_id=auth.uid());
create policy company_profile_read on company_profile for select to authenticated using(org_id=current_org());
create policy company_profile_write on company_profile for all to authenticated
  using(org_id=current_org() and is_org_admin()) with check(org_id=current_org() and is_org_admin());
create policy audit_log_select on audit_log for select to authenticated using(org_id=current_org());
create policy audit_log_insert on audit_log for insert to authenticated with check(org_id=current_org());
create policy app_users_org on app_users for all to authenticated using(org_id=current_org()) with check(org_id=current_org());
create function filey_cloud_access() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and exists(select 1 from organizations where id::text=current_org())
$$;
create function filey_invoice_usage() returns integer language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select used from invoice_monthly_usage where org_id=current_org()::uuid
    and auth.uid() is not null and month=date_trunc('month',now() at time zone 'UTC')::date),0)
$$;
grant usage on schema public,auth to authenticated;
grant select on profiles,organizations,org_members,company_profile to authenticated;
grant delete on org_members to authenticated;
grant update on company_profile to authenticated;
grant select,insert,update,delete on audit_log,app_users to authenticated;
revoke all on invoice_monthly_usage from public,anon,authenticated;

-- A real removal leaves the profile's selected workspace unchanged.
delete from org_members where org_id='10000000-0000-0000-0000-000000000001'
  and user_id='00000000-0000-0000-0000-000000000002';
set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000002';
do $$ begin
  assert current_org()='10000000-0000-0000-0000-000000000001';
  assert (select count(*) from org_members where org_id=current_org())=2,'Prior roster leak did not reproduce';
  assert (select count(*) from profiles where id<>auth.uid())=2,'Prior profile leak did not reproduce';
  assert (select bank_details from company_profile where org_id=current_org())='Synthetic bank details','Prior company identity leak did not reproduce';
  assert (select count(*) from organizations)=2,'Prior organization leak did not reproduce';
  assert filey_cloud_access(),'Prior stale cloud allowance did not reproduce';
  assert filey_invoice_usage()=19,'Prior activity counter leak did not reproduce';
  assert (select changes->'_created'->>'customer_name' from audit_log where id=1)='Private customer','Former member private audit disclosure did not reproduce';
  assert (select count(*) from app_users)=1,'Prior legacy-user disclosure did not reproduce';
  update app_users set active=false where id=1;
  assert (select active from app_users where id=1)=false,'Prior removed-member legacy-user edit did not reproduce';
end $$;
set test.uid='00000000-0000-0000-0000-000000000003';
do $$ begin
  assert not filey_can_use('people'),'Restricted test member unexpectedly has payroll access';
  assert (select changes->'_created'->>'salary' from audit_log where id=2)='8000','Restricted member private payroll disclosure did not reproduce';
end $$;
reset role;
update app_users set active=true where id=1;
select 'PASS: reproduced removed-member identity/activity reads and legacy-user edits, plus restricted-member private invoice/payroll audit disclosures.';
