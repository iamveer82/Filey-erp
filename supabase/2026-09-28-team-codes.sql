-- Account codes identify a workspace; only an admin can approve membership.
-- Requires 2026-09-20-team-workspaces.sql and 2026-09-20-edge-rate-limits.sql.
begin;

create table if not exists public.team_invite_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  org_id uuid references public.organizations(id) on delete set null
);
create table if not exists public.team_join_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  applicant_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','declined','canceled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  unique (org_id, applicant_id)
);
create index if not exists team_join_requests_applicant on public.team_join_requests(applicant_id);
alter table public.team_invite_codes enable row level security;
alter table public.team_join_requests enable row level security;
revoke all on public.team_invite_codes, public.team_join_requests from public, anon, authenticated;
grant select on public.team_invite_codes, public.team_join_requests to authenticated;
drop policy if exists team_code_self on public.team_invite_codes;
create policy team_code_self on public.team_invite_codes for select to authenticated using(user_id=auth.uid());
drop policy if exists team_request_read on public.team_join_requests;
create policy team_request_read on public.team_join_requests for select to authenticated
  using(applicant_id=auth.uid() or (org_id::text=public.current_org() and public.is_org_admin()));

create or replace function public.filey_ensure_team_code(p_user uuid) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_code text;
begin
  -- Serialize generation for the same account, including signup/backfill races.
  perform pg_advisory_xact_lock(hashtextextended('team-code:'||p_user::text,0));
  select code into v_code from team_invite_codes where user_id=p_user;
  if found then return v_code; end if;
  for attempt in 1..100 loop
    select string_agg(substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',1+get_byte(uuid_send(gen_random_uuid()),n)%36,1),'')
      into v_code from generate_series(0,5) n;
    begin
      insert into team_invite_codes(user_id,code) values(p_user,v_code);
      return v_code;
    exception when unique_violation then null;
    end;
  end loop;
  raise exception 'Could not create an invitation code. Please try again.';
end $$;
revoke all on function public.filey_ensure_team_code(uuid) from public,anon,authenticated;

create or replace function public.filey_assign_team_code() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform filey_ensure_team_code(new.id);
  return new;
end $$;
revoke all on function public.filey_assign_team_code() from public,anon,authenticated;
drop trigger if exists filey_profile_team_code on public.profiles;
create trigger filey_profile_team_code after insert on public.profiles
  for each row execute function public.filey_assign_team_code();
do $$ begin perform public.filey_ensure_team_code(id) from auth.users; end $$;

create or replace function public.filey_team_connections() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_code text; v_org text := current_org();
begin
  if auth.uid() is null then raise exception 'Sign in to view your team.'; end if;
  v_code := filey_ensure_team_code(auth.uid());
  return jsonb_build_object(
    'code',v_code,
    'workspace_id',(select org_id from team_invite_codes where user_id=auth.uid()),
    'workspace_name',(select o.name from organizations o join team_invite_codes c on c.org_id=o.id where c.user_id=auth.uid()),
    'requests',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'org_id',r.org_id,'workspace_name',o.name,'incoming',r.applicant_id<>auth.uid(),
      'name',p.name,'email',u.email,'status',case when r.status='pending' and r.expires_at<=now() then 'expired' else r.status end,
      'created_at',r.created_at,'expires_at',r.expires_at
    ) order by r.created_at desc)
    from team_join_requests r join organizations o on o.id=r.org_id
      join auth.users u on u.id=r.applicant_id left join profiles p on p.id=u.id
    where r.applicant_id=auth.uid() or (r.org_id::text=v_org and is_org_admin() and r.status='pending' and r.expires_at>now())), '[]'::jsonb)
  );
end $$;

create or replace function public.filey_link_team_code(p_org_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or my_email() is null then raise exception 'Verify your email before inviting teammates.'; end if;
  perform 1 from org_members where user_id=auth.uid() and org_id=p_org_id::text
    and org_id=current_org() and role in ('owner','admin') for share;
  if not found then raise exception 'Only a workspace owner or admin can invite teammates.'; end if;
  perform filey_ensure_team_code(auth.uid());
  update team_invite_codes set org_id=p_org_id where user_id=auth.uid();
end $$;

create or replace function public.filey_request_team_join(p_code text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_code team_invite_codes; v_request team_join_requests;
begin
  if auth.uid() is null or my_email() is null then raise exception 'Verify your email before joining a team.'; end if;
  -- Return validation errors (rather than raising) so failed guesses consume quota.
  if not filey_take_rate_limit('team-join:'||auth.uid()::text,'team-code',5,3600) then
    return jsonb_build_object('error','Too many attempts. Please try again in an hour.');
  end if;
  if p_code is null or upper(trim(p_code)) !~ '^[A-Z0-9]{6}$' then
    return jsonb_build_object('error','Enter a six-character code using letters and numbers.');
  end if;
  select * into v_code from team_invite_codes where code=upper(trim(p_code)) for share;
  if not found or v_code.org_id is null then
    return jsonb_build_object('error','This code is unavailable. Ask the workspace owner for an invitation.');
  end if;
  perform 1 from org_members where user_id=v_code.user_id and org_id=v_code.org_id::text and role in ('owner','admin') for share;
  if not found then return jsonb_build_object('error','This code is unavailable. Ask the workspace owner for an invitation.'); end if;
  if exists(select 1 from org_members where user_id=auth.uid() and org_id=v_code.org_id::text) then
    return jsonb_build_object('error','You already belong to this workspace. Choose it from your workspace list.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('team-join:'||auth.uid()::text,0));
  select * into v_request from team_join_requests where org_id=v_code.org_id and applicant_id=auth.uid() for update;
  if found and v_request.status='pending' and v_request.expires_at>now() then
    return jsonb_build_object('id',v_request.id);
  end if;
  if found and v_request.created_at>now()-interval '1 day' then
    return jsonb_build_object('error','Please wait a day before requesting to join this workspace again.');
  end if;
  insert into team_join_requests(org_id,inviter_id,applicant_id) values(v_code.org_id,v_code.user_id,auth.uid())
    on conflict(org_id,applicant_id) do update set id=gen_random_uuid(),inviter_id=excluded.inviter_id,
      status='pending',created_at=now(),expires_at=now()+interval '7 days'
    returning * into v_request;
  return jsonb_build_object('id',v_request.id);
end $$;

create or replace function public.filey_review_team_join(p_id uuid,p_org_id uuid,p_approve boolean,p_role text default 'staff',p_modules text[] default array['team']) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_request team_join_requests;
begin
  if auth.uid() is null or my_email() is null then raise exception 'Verify your email before managing your team.'; end if;
  perform 1 from org_members where user_id=auth.uid() and org_id=p_org_id::text
    and org_id=current_org() and role in ('owner','admin') for share;
  if not found then raise exception 'Only a workspace owner or admin can review requests.'; end if;
  select * into v_request from team_join_requests where id=p_id and org_id=p_org_id for update;
  if not found or v_request.status<>'pending' or v_request.expires_at<=now() then
    raise exception 'This request is no longer waiting for approval. Refresh your team.';
  end if;
  if p_approve is null then raise exception 'Choose whether to approve this request.'; end if;
  if p_approve then
    if p_role is null or p_role not in ('admin','manager','accountant','staff') then raise exception 'Choose a valid member role.'; end if;
    if cardinality(p_modules)>100 then raise exception 'Too many app permissions.'; end if;
    if not exists(select 1 from auth.users where id=v_request.applicant_id and email_confirmed_at is not null) then
      raise exception 'This member must verify their email first.';
    end if;
    -- An email invitation may have joined this member while the request was pending.
    insert into org_members(org_id,user_id,role,modules) values(p_org_id::text,v_request.applicant_id,p_role,p_modules)
      on conflict(org_id,user_id) do nothing;
  end if;
  update team_join_requests set status=case when p_approve then 'approved' else 'declined' end where id=p_id;
  -- Approval never changes the applicant's active workspace or personal records.
end $$;

create or replace function public.filey_cancel_team_join(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update team_join_requests set status='canceled' where id=p_id and applicant_id=auth.uid() and status='pending';
end $$;

revoke all on function public.filey_team_connections(),public.filey_link_team_code(uuid),public.filey_request_team_join(text),
  public.filey_review_team_join(uuid,uuid,boolean,text,text[]),public.filey_cancel_team_join(uuid) from public,anon,authenticated;
grant execute on function public.filey_team_connections(),public.filey_link_team_code(uuid),public.filey_request_team_join(text),
  public.filey_review_team_join(uuid,uuid,boolean,text,text[]),public.filey_cancel_team_join(uuid) to authenticated;

do $$ declare t text; begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach t in array array['team_invite_codes','team_join_requests'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
        execute format('alter publication supabase_realtime add table public.%I',t);
      end if;
    end loop;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
