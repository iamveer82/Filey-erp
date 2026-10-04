-- A profile's active org can outlive its membership after removal or leaving.
-- Require current membership on shared identity reads, not just current_org().
-- Apply after the team and Basic-web migrations. No records are rewritten.
begin;

-- Definer avoids recursion when used by the org_members SELECT policy.
create or replace function public.filey_is_workspace_member(p_org text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.org_members m
    where m.org_id=p_org and m.user_id=auth.uid())
$$;
revoke all on function public.filey_is_workspace_member(text) from public,anon;
grant execute on function public.filey_is_workspace_member(text) to authenticated;

drop policy if exists organizations_read on public.organizations;
create policy organizations_read on public.organizations for select to authenticated
  using (owner_id=auth.uid() or (id::text=public.current_org()
    and public.filey_is_workspace_member(id::text)));

drop policy if exists org_members_select on public.org_members;
create policy org_members_select on public.org_members for select to authenticated
  using (user_id=auth.uid() or (org_id=public.current_org()
    and public.filey_is_workspace_member(org_id)));

drop policy if exists profiles_org_read on public.profiles;
create policy profiles_org_read on public.profiles for select to authenticated
  using (org_id=public.current_org() and public.filey_is_workspace_member(org_id));

drop policy if exists company_profile_read on public.company_profile;
create policy company_profile_read on public.company_profile for select to authenticated
  using (org_id=public.current_org() and public.filey_is_workspace_member(org_id));

-- Audit diffs include complete private invoice/payroll records. A module gate
-- on the original row cannot protect that copied data; reserve reads to admins.
drop policy if exists audit_log_org on public.audit_log;
drop policy if exists audit_log_select on public.audit_log;
drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (org_id=public.current_org() and public.is_org_admin());
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check (org_id=public.current_org() and user_id=auth.uid()
    and public.filey_is_workspace_member(org_id));

-- Legacy local-user entries are still exposed by the cloud API. A stale active
-- workspace must not permit reading, creating or editing these rows either.
drop policy if exists filey_member_required on public.app_users;
create policy filey_member_required on public.app_users as restrictive for all to authenticated
  using (public.filey_is_workspace_member(org_id))
  with check (public.filey_is_workspace_member(org_id));

create or replace function public.filey_cloud_access() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.filey_is_workspace_member(public.current_org())
    and exists(select 1 from public.organizations o where o.id::text=public.current_org())
$$;
revoke all on function public.filey_cloud_access() from public,anon;
grant execute on function public.filey_cloud_access() to authenticated;

-- This definer RPC must not reveal a former company's activity counter, or
-- bypass a restricted member's missing Invoicing permission.
create or replace function public.filey_invoice_usage() returns integer
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select used from public.invoice_monthly_usage
    where org_id::text=public.current_org() and public.filey_can_use('invoicing')
      and month=date_trunc('month',now() at time zone 'UTC')::date),0)
$$;
revoke all on function public.filey_invoice_usage() from public,anon;
grant execute on function public.filey_invoice_usage() to authenticated;

notify pgrst,'reload schema';
commit;
