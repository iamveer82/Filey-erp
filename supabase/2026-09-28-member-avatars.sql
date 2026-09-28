-- Workspace avatars do not change a colleague's personal profile photo.
begin;
alter table public.org_members add column if not exists avatar text;
alter table public.org_members drop constraint if exists org_members_avatar_preset;
alter table public.org_members add constraint org_members_avatar_preset check (
  avatar is null or avatar in (
    '/avatars/sun.svg','/avatars/mint.svg','/avatars/coral.svg','/avatars/sky.svg',
    '/avatars/lilac.svg','/avatars/peach.svg','/avatars/slate.svg','/avatars/sage.svg'
  )
);

-- A changed return type needs a transactional replacement.
drop function if exists public.filey_team_members();
create function public.filey_team_members()
returns table(id bigint,org_id text,user_id uuid,role text,modules text[],name text,email text,avatar text,avatar_override text)
language sql stable security definer set search_path=public,pg_temp as $$
  select m.id,m.org_id,m.user_id,m.role,m.modules,p.name,u.email::text,
    coalesce(m.avatar,nullif(p.avatar,'')),m.avatar
  from public.org_members m join public.profiles p on p.id=m.user_id join auth.users u on u.id=m.user_id
  where m.org_id=public.current_org() and exists (
    select 1 from public.org_members me where me.org_id=m.org_id and me.user_id=auth.uid()
  ) order by m.id
$$;

create or replace function public.filey_set_member_avatar(p_member_id bigint,p_org_id text,p_avatar text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare member_user uuid;
begin
  if auth.uid() is null or p_org_id is distinct from public.current_org() then
    raise exception 'Reopen your workspace and try again' using errcode='42501';
  end if;
  select user_id into member_user from public.org_members
    where id=p_member_id and org_id=p_org_id for update;
  if member_user is null or not (member_user=auth.uid() or public.is_org_admin()) then
    raise exception 'Only this member or a workspace admin can change their avatar' using errcode='42501';
  end if;
  update public.org_members set avatar=nullif(p_avatar,'') where id=p_member_id and org_id=p_org_id;
end $$;
revoke all on function public.filey_team_members() from public,anon;
revoke all on function public.filey_set_member_avatar(bigint,text,text) from public,anon;
grant execute on function public.filey_team_members(),public.filey_set_member_avatar(bigint,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
