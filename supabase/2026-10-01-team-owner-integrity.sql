-- Protect workspace ownership in direct PostgREST and definer RPC writes.
-- Existing memberships are not rewritten. Trusted account/workspace cleanup
-- and future server-managed owner transfers remain available to service role.
begin;
do $$ begin
  if has_column_privilege('authenticated','public.organizations','owner_id','UPDATE')
    or has_column_privilege('anon','public.organizations','owner_id','UPDATE') then
    raise exception 'Apply 2026-09-30-workspace-billing-acl.sql before team owner integrity';
  end if;
end $$;
create or replace function public.filey_guard_team_owner()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid;
begin
  if auth.uid() is null or coalesce(auth.role(),'')='service_role' then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op='UPDATE' and (new.org_id is distinct from old.org_id or new.user_id is distinct from old.user_id) then
    raise exception 'Team membership identity cannot be changed' using errcode='42501';
  end if;
  if tg_op='INSERT' then
    select owner_id into v_owner from public.organizations where id::text=new.org_id for share;
  else
    select owner_id into v_owner from public.organizations where id::text=old.org_id for share;
  end if;
  if tg_op='DELETE' then
    if old.user_id=v_owner then raise exception 'The workspace owner cannot leave or be removed. Delete the workspace instead.' using errcode='42501'; end if;
    return old;
  end if;
  if new.user_id=v_owner and new.role<>'owner' then
    raise exception 'The workspace owner role cannot be changed' using errcode='42501';
  end if;
  if new.role='owner' and (v_owner is null or new.user_id<>v_owner) then
    raise exception 'Only the workspace owner may hold the owner role' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists filey_guard_team_owner on public.org_members;
create trigger filey_guard_team_owner before insert or update or delete on public.org_members
  for each row execute function public.filey_guard_team_owner();
revoke all on function public.filey_guard_team_owner() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
