-- A scheduled service-role job must retain its original workspace authority
-- before publishing private data. One statement checks both active workspace
-- and membership; this helper grants no authority to client roles.
begin;
create or replace function public.filey_agent_workspace_allowed(p_owner uuid,p_org text)
returns boolean language sql stable security invoker
set search_path=public,pg_temp as $$
  select exists(select 1 from public.profiles p
    join public.org_members m on m.org_id=p.org_id and m.user_id=p.id
    where p.id=p_owner and p.org_id=p_org and m.role in ('owner','admin'))
$$;
revoke all on function public.filey_agent_workspace_allowed(uuid,text)
  from public,anon,authenticated;
grant execute on function public.filey_agent_workspace_allowed(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
