-- Actual installed policies/RPCs with synthetic accounts only; all rolled back.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('b7000000-0000-4000-8000-000000000001','owner@membership.invalid',now()),
 ('b7000000-0000-4000-8000-000000000002','member@membership.invalid',now()),
 ('b7000000-0000-4000-8000-000000000003','other@membership.invalid',now()),
 ('b7000000-0000-4000-8000-000000000004','already-removed@membership.invalid',now()),
 ('b7000000-0000-4000-8000-000000000005','no-owned-workspace@membership.invalid',now());
create temp table membership_fixture as select id,org_id from profiles where id::text like 'b7000000-%';
grant select on membership_fixture to authenticated;
insert into organizations(id,name,owner_id,created_at) values
 ('b7200000-0000-4000-8000-000000000001','Additional owned workspace','b7000000-0000-4000-8000-000000000002',now()+interval '1 day');
insert into org_members(org_id,user_id,role) values
 ('b7200000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000002','owner');
insert into org_members(org_id,user_id,role,modules)
 select org_id,'b7000000-0000-4000-8000-000000000002','staff',array['invoicing'] from membership_fixture where id='b7000000-0000-4000-8000-000000000001';
insert into org_members(org_id,user_id,role,modules)
 select org_id,'b7000000-0000-4000-8000-000000000002','staff',array['invoicing'] from membership_fixture where id='b7000000-0000-4000-8000-000000000003';
insert into invoice_docs(id,user_id,org_id,number,status,customer_name,notes)
 select 970001,'b7000000-0000-4000-8000-000000000002',org_id,'KEEP-TEAM','draft','Team customer','Do not move' from membership_fixture where id='b7000000-0000-4000-8000-000000000001';
insert into invoice_docs(id,user_id,org_id,number,status,customer_name,notes)
 select 970002,'b7000000-0000-4000-8000-000000000002',org_id,'KEEP-PERSONAL','draft','Personal customer','Keep own data' from membership_fixture where id='b7000000-0000-4000-8000-000000000002';
create temp table membership_documents as select jsonb_agg(to_jsonb(d) order by id) rows from invoice_docs d where id in (970001,970002);

-- Simulate the old failure: membership is gone but the profile still points
-- to the company. A missing owned workspace must not create unauthorized access.
alter table org_members disable trigger filey_restore_removed_member_workspace;
update profiles set org_id=(select org_id from membership_fixture where id='b7000000-0000-4000-8000-000000000001')
 where id in ('b7000000-0000-4000-8000-000000000002','b7000000-0000-4000-8000-000000000004','b7000000-0000-4000-8000-000000000005');
delete from org_members where user_id='b7000000-0000-4000-8000-000000000005';
alter table org_members enable trigger filey_restore_removed_member_workspace;

-- Exercise historical table grants, inherited PUBLIC column grants and a
-- limited-grant installation. Preserve every effective non-org capability.
grant update on profiles to authenticated;
revoke update on profiles from anon;
do $$ declare columns text; begin
  select string_agg(quote_ident(attname),', ') into columns from pg_attribute
    where attrelid='public.profiles'::regclass and attnum>0 and not attisdropped;
  execute format('revoke update (%s) on profiles from anon',columns);
end $$;
grant update (org_id,phone) on profiles to public,anon;
create temp table membership_profile_grants as
 select r.role,a.attname,has_column_privilege(r.role,'public.profiles',a.attnum,'UPDATE') allowed
 from (values('anon'),('authenticated'),('service_role')) r(role),pg_attribute a
 where a.attrelid='public.profiles'::regclass and a.attnum>0 and not a.attisdropped and a.attname<>'org_id';

-- APPLY RECOVERY UPGRADE

do $$ begin
  if has_column_privilege('authenticated','public.profiles','org_id','UPDATE')
    or has_column_privilege('anon','public.profiles','org_id','UPDATE')
    or not has_column_privilege('service_role','public.profiles','org_id','UPDATE') then
    raise exception 'Direct workspace column authority or service-role grant is incorrect';
  end if;
  if exists(select 1 from membership_profile_grants g where
      has_column_privilege(g.role,'public.profiles',g.attname,'UPDATE') is distinct from g.allowed) then
    raise exception 'Profile workspace authority changed unrelated or limited profile-column grants';
  end if;
  if (select org_id from profiles where id='b7000000-0000-4000-8000-000000000004') is distinct from
      (select org_id from membership_fixture where id='b7000000-0000-4000-8000-000000000004') then
    raise exception 'Already removed account did not recover its owned workspace';
  end if;
  if (select org_id from profiles where id='b7000000-0000-4000-8000-000000000002') is distinct from
      (select org_id from membership_fixture where id='b7000000-0000-4000-8000-000000000001') then
    raise exception 'Valid team workspace changed during backfill';
  end if;
  if (select org_id from profiles where id='b7000000-0000-4000-8000-000000000005') is distinct from
      (select org_id from membership_fixture where id='b7000000-0000-4000-8000-000000000001') then
    raise exception 'Account without owned membership received inferred access';
  end if;
  if has_function_privilege('authenticated','public.filey_restore_removed_member_workspace()','EXECUTE')
      or has_function_privilege('anon','public.filey_restore_removed_member_workspace()','EXECUTE')
      or has_function_privilege('service_role','public.filey_restore_removed_member_workspace()','EXECUTE') then
    raise exception 'Recovery trigger can be invoked directly';
  end if;
end $$;

-- Actual authenticated team owner removes someone else: definer profile update
-- must work without giving the actor direct access to edit that person's profile.
set role authenticated;
set request.jwt.claim.sub='b7000000-0000-4000-8000-000000000001';
set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
delete from org_members where user_id='b7000000-0000-4000-8000-000000000002' and org_id=public.current_org();
set request.jwt.claim.sub='b7000000-0000-4000-8000-000000000002';
do $$ declare access jsonb:=public.filey_module_access(); expected text; failed boolean:=false; begin
  select org_id into expected from membership_fixture where id=auth.uid();
  if public.current_org() is distinct from expected or access->>'org_id' is distinct from expected
      or access->>'allowed'<>'true' or access->>'admin'<>'true' then
    raise exception 'Removed member did not regain scoped personal-owner access';
  end if;
  if exists(select 1 from invoice_docs where id=970001) or not exists(select 1 from invoice_docs where id=970002) then
    raise exception 'Former-team data leaked or personal data became unavailable';
  end if;
  if exists(select 1 from public.filey_workspaces() where id=(select org_id from membership_fixture where id='b7000000-0000-4000-8000-000000000001')) then
    raise exception 'Removed membership reappeared';
  end if;
  begin
    perform public.filey_switch_workspace((select org_id from membership_fixture where id='b7000000-0000-4000-8000-000000000001'));
  exception when others then
    if sqlerrm<>'You are not a member of this workspace' then raise; end if;
    failed:=true;
  end;
  if not failed or public.current_org()<>expected then raise exception 'Removed member switched back into former team'; end if;
  failed:=false;
  begin delete from org_members where user_id=auth.uid() and org_id=expected;
  exception when insufficient_privilege then failed:=true; end;
  if not failed then raise exception 'Recovery weakened workspace-owner removal protection'; end if;
  failed:=false;
  begin update profiles set org_id=expected where id=auth.uid();
  exception when insufficient_privilege then failed:=true; end;
  if not failed then raise exception 'Direct profile org change bypassed locking workspace RPC'; end if;
  update profiles set name='Updated personal name',company='Updated company',phone='+971500000001',language='English (US)' where id=auth.uid();
  if not found then raise exception 'Editable personal profile fields lost update access'; end if;
  insert into profiles(id,email,name,company) values(auth.uid(),'member@membership.invalid','Completed profile','Completed company')
    on conflict(id) do update set email=excluded.email,name=excluded.name,company=excluded.company;
  if not exists(select 1 from profiles where id=auth.uid() and name='Completed profile' and org_id=expected) then
    raise exception 'Profile completion upsert changed workspace or lost access';
  end if;
end $$;

-- Leaving one's other team follows the same recovery, with no admin required.
select public.filey_switch_workspace((select org_id from membership_fixture where id='b7000000-0000-4000-8000-000000000003'));
delete from org_members where user_id=auth.uid() and org_id=public.current_org();
do $$ begin
  if public.current_org()<>(select org_id from membership_fixture where id=auth.uid()) then
    raise exception 'Self-leaving team did not return to own workspace';
  end if;
end $$;
select public.filey_switch_workspace('b7200000-0000-4000-8000-000000000001');
set request.jwt.claim.sub='b7000000-0000-4000-8000-000000000005';
do $$ declare access jsonb:=public.filey_module_access(); begin
  if access->>'allowed'<>'false' or access->>'admin'<>'false' or access->>'org_id' is distinct from public.current_org() then
    raise exception 'Missing owned membership did not fail closed with authoritative scope';
  end if;
end $$;
reset role;
reset request.jwt.claim.sub;
reset request.jwt.claims;

-- Deleting an inactive membership preserves the currently selected workspace.
insert into org_members(org_id,user_id,role)
 select org_id,'b7000000-0000-4000-8000-000000000002','staff' from membership_fixture where id='b7000000-0000-4000-8000-000000000001';
delete from org_members where user_id='b7000000-0000-4000-8000-000000000002'
 and org_id=(select org_id from membership_fixture where id='b7000000-0000-4000-8000-000000000001');
do $$ begin
  if (select org_id from profiles where id='b7000000-0000-4000-8000-000000000002') is distinct from
      'b7200000-0000-4000-8000-000000000001' then
    raise exception 'Inactive membership removal changed current workspace';
  end if;
  if (select jsonb_agg(to_jsonb(d) order by id) from invoice_docs d where id in (970001,970002)) is distinct from
      (select rows from membership_documents) then raise exception 'Recovery moved or changed saved business records'; end if;
end $$;

-- A recovery failure aborts the removal instead of partially changing access.
create function pg_temp.reject_recovery_profile() returns trigger language plpgsql as $$ begin
  if new.id='b7000000-0000-4000-8000-000000000002' then raise exception 'fixture recovery failure'; end if;
  return new;
end $$;
insert into org_members(org_id,user_id,role)
 select org_id,'b7000000-0000-4000-8000-000000000002','staff' from membership_fixture where id='b7000000-0000-4000-8000-000000000001';
update profiles set org_id=(select org_id from membership_fixture where id='b7000000-0000-4000-8000-000000000001')
 where id='b7000000-0000-4000-8000-000000000002';
create trigger fixture_reject_profile before update on profiles for each row execute function pg_temp.reject_recovery_profile();
do $$ declare failed boolean:=false; begin
  begin
    delete from org_members where user_id='b7000000-0000-4000-8000-000000000002'
      and org_id=(select org_id from membership_fixture where id='b7000000-0000-4000-8000-000000000001');
  exception when others then
    if sqlerrm<>'fixture recovery failure' then raise; end if;
    failed:=true;
  end;
  if not failed or not exists(select 1 from org_members where user_id='b7000000-0000-4000-8000-000000000002'
      and org_id=(select org_id from membership_fixture where id='b7000000-0000-4000-8000-000000000001')) then
    raise exception 'Failed recovery committed partial membership removal';
  end if;
end $$;
drop trigger fixture_reject_profile on profiles;

-- Account deletion must not recreate a deleted profile or owner membership.
delete from auth.users where id='b7000000-0000-4000-8000-000000000004';
do $$ begin
  if exists(select 1 from profiles where id='b7000000-0000-4000-8000-000000000004')
    or exists(select 1 from org_members where user_id='b7000000-0000-4000-8000-000000000004') then
    raise exception 'Account deletion resurrected personal identity';
  end if;
end $$;
rollback;
select 'PASS: stale profile repair, admin removal/self-leave, personal access, former-team privacy, scope binding, owner protection, inactive membership preservation, rollback, account deletion, PUBLIC/limited/service grant preservation and profile edit/upsert compatibility.';
