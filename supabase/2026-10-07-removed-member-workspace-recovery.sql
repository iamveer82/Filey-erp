-- Removing team access must not strand an account in its former workspace.
-- Reuse the signup-owned workspace; never move records or restore membership.
begin;

create or replace function public.filey_switch_workspace(p_id text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- Hold membership until the profile update commits. Without this lock a
  -- concurrent removal can recover the profile before this switch overwrites it.
  perform 1 from public.org_members where org_id=p_id and user_id=auth.uid() for share;
  if not found then raise exception 'You are not a member of this workspace'; end if;
  update public.profiles set org_id=p_id where id=auth.uid();
  if not found then raise exception 'Profile not found'; end if;
end $$;
revoke all on function public.filey_switch_workspace(text) from public,anon;
grant execute on function public.filey_switch_workspace(text) to authenticated;

create or replace function public.accept_invitation(invite uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare inv public.invitations; v_email text:=public.my_email();
begin
  if auth.uid() is null or v_email is null then raise exception 'Verify your account email before joining'; end if;
  select * into inv from public.invitations where id=invite for update;
  if inv.id is null or lower(inv.email)<>v_email then raise exception 'Sign in with the email address this invitation was sent to'; end if;
  if inv.status<>'pending' or inv.expires_at<=now() then raise exception 'This invitation has expired or is no longer available. Ask for a new invitation'; end if;
  if inv.role not in ('admin','manager','accountant','staff') then raise exception 'Ask the owner to replace this invitation'; end if;
  -- An old invite cannot change an existing member's permissions.
  insert into public.org_members(org_id,user_id,role,modules) values(inv.org_id,auth.uid(),inv.role,inv.modules)
    on conflict(org_id,user_id) do nothing;
  perform public.filey_switch_workspace(inv.org_id);
  update public.invitations set status=case when id=inv.id then 'accepted' else 'revoked' end,updated_at=now()
    where org_id=inv.org_id and lower(invitations.email)=v_email and status='pending';
end $$;
revoke all on function public.accept_invitation(uuid) from public,anon;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- Bind permission responses to their authoritative workspace. Older clients
-- ignore the additive field; current clients cannot apply recovered owner
-- access to cached records from the former team while their profile catches up.
create or replace function public.filey_module_access() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select jsonb_build_object('allowed',true,'org_id',m.org_id,
      'admin',m.role in ('owner','admin'),'modules',m.modules)
    from public.org_members m where m.org_id=public.current_org() and m.user_id=auth.uid() limit 1),
    jsonb_build_object('allowed',false,'org_id',public.current_org(),'admin',false,'modules','[]'::jsonb))
$$;
revoke all on function public.filey_module_access() from public,anon;
grant execute on function public.filey_module_access() to authenticated;

create or replace function public.filey_restore_removed_member_workspace()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org text;
begin
  -- Account deletion must not provision or resurrect any workspace/profile.
  if not exists(select 1 from auth.users where id=old.user_id) then return old; end if;
  select o.id::text into v_org from public.organizations o join public.org_members m
    on m.org_id=o.id::text and m.user_id=o.owner_id and m.role='owner'
    where o.owner_id=old.user_id and o.id::text<>old.org_id
    order by o.created_at,o.id limit 1 for share of m for key share of o;
  if v_org is not null then
    update public.profiles p set org_id=v_org
      where p.id=old.user_id and p.org_id=old.org_id
        and not exists(select 1 from public.org_members m where m.org_id=old.org_id and m.user_id=old.user_id);
  end if;
  return old;
end $$;
revoke all on function public.filey_restore_removed_member_workspace() from public,anon,authenticated,service_role;
drop trigger if exists filey_restore_removed_member_workspace on public.org_members;
create trigger filey_restore_removed_member_workspace after delete on public.org_members
  for each row execute function public.filey_restore_removed_member_workspace();

-- Repair earlier removals, using only a real owned workspace and owner role.
-- A valid active workspace is preserved; missing owner workspaces stay denied.
with recovery as (
  select distinct on (p.id) p.id,p.org_id as previous_org,o.id::text as org_id
    from public.profiles p join auth.users u on u.id=p.id
    join public.organizations o on o.owner_id=p.id
    join public.org_members m on m.org_id=o.id::text and m.user_id=p.id and m.role='owner'
    where p.org_id is not null and p.org_id<>'default'
      and not exists(select 1 from public.org_members active where active.org_id=p.org_id and active.user_id=p.id)
    order by p.id,o.created_at,o.id
)
update public.profiles p set org_id=r.org_id from recovery r
  where p.id=r.id and p.org_id=r.previous_org
    and not exists(select 1 from public.org_members active where active.org_id=p.org_id and active.user_id=p.id);

notify pgrst,'reload schema';
commit;
