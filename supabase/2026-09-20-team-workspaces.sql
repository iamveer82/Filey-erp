-- Team onboarding and chat. Additive: no existing business records are changed.
begin;

alter table public.invitations add column if not exists expires_at timestamptz not null default (now() + interval '7 days');
alter table public.invitations add column if not exists email_status text not null default 'not_sent';
alter table public.invitations add column if not exists email_send_id uuid;
alter table public.invitations add column if not exists last_sent_at timestamptz;
alter table public.invitations add column if not exists email_error text;
alter table public.invitations alter column org_id set default public.current_org();

-- Profile fields are editable display data, never proof of email ownership.
create or replace function public.my_email() returns text
language sql stable security definer set search_path=public,pg_temp as $$
  select lower(email) from auth.users where id=auth.uid() and email_confirmed_at is not null
$$;
revoke all on function public.my_email() from public,anon;
grant execute on function public.my_email() to authenticated;
drop policy if exists invitations_admin on public.invitations;
create policy invitations_admin on public.invitations for select to authenticated
  using (org_id=public.current_org() and public.is_org_admin());
revoke insert,update,delete on public.invitations from anon,authenticated;

-- Serialize per workspace so retries cannot create duplicate invitations or
-- exceed the email budget. A retry reuses the same Resend idempotency key.
create or replace function public.filey_prepare_invitation(
  p_email text default null, p_role text default 'staff', p_modules text[] default null,
  p_invite uuid default null, p_resend boolean default false
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.invitations; v_org text:=public.current_org(); v_email text:=lower(trim(p_email)); v_name text;
begin
  if auth.uid() is null or public.my_email() is null or not public.is_org_admin() then
    raise exception 'Only a verified workspace owner or administrator can invite members';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('filey-invite:'||v_org,0));
  select name into v_name from public.organizations where id::text=v_org;
  if v_name is null then raise exception 'Choose a workspace first'; end if;
  if p_invite is not null then
    select * into v from public.invitations where id=p_invite and org_id=v_org and status='pending' for update;
    if v.id is null then raise exception 'Invitation is no longer pending'; end if;
    v_email:=v.email;
  else
    if v_email is null or length(v_email)>320 or v_email !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$' then
      raise exception 'Enter a valid email address';
    end if;
    if p_role not in ('admin','manager','accountant','staff') or p_role is null then raise exception 'Invalid member role'; end if;
    if cardinality(p_modules)>100 then raise exception 'Too many module permissions'; end if;
    select * into v from public.invitations where org_id=v_org and lower(email)=v_email and status='pending'
      order by created_at desc limit 1 for update;
  end if;
  if exists(select 1 from public.org_members m join auth.users u on u.id=m.user_id
    where m.org_id=v_org and lower(u.email)=v_email and u.email_confirmed_at is not null) then
    raise exception 'This person is already a workspace member';
  end if;
  if v.id is not null and not p_resend and v.email_send_id is not null and v.last_sent_at>now()-interval '23 hours' then
    return to_jsonb(v)||jsonb_build_object('workspace_name',v_name);
  end if;
  if v.last_sent_at>now()-interval '1 minute' then raise exception 'Wait a minute before resending'; end if;
  if (select count(*) from public.audit_log where action='team_invite_email'
    and details=v_org and created_at>now()-interval '1 day')>=50 then
    raise exception 'Workspace invitation limit reached. Try again tomorrow';
  end if;
  if v.id is null then
    insert into public.invitations(org_id,email,role,modules,invited_by)
      values(v_org,v_email,p_role,p_modules,auth.uid()) returning * into v;
  end if;
  update public.invitations set expires_at=now()+interval '7 days',email_status='sending',
    email_send_id=gen_random_uuid(),last_sent_at=now(),email_error=null where id=v.id returning * into v;
  insert into public.audit_log(user_id,actor,action,entity,details)
    values(auth.uid(),'user','team_invite_email','invitation',v_org);
  return to_jsonb(v)||jsonb_build_object('workspace_name',v_name);
end $$;

create or replace function public.filey_revoke_invitation(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_org_admin() then raise exception 'Only an administrator can revoke invitations'; end if;
  update public.invitations set status='revoked',updated_at=now()
    where id=p_id and org_id=public.current_org() and status='pending';
  if not found then raise exception 'Invitation is no longer pending'; end if;
end $$;

create or replace function public.accept_invitation(invite uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare inv public.invitations; v_email text:=public.my_email();
begin
  if auth.uid() is null or v_email is null then raise exception 'Verify your account email before joining'; end if;
  select * into inv from public.invitations where id=invite for update;
  if inv.id is null or lower(inv.email)<>v_email then raise exception 'Sign in with the email address this invitation was sent to'; end if;
  if inv.status<>'pending' or inv.expires_at<=now() then raise exception 'This invitation has expired or is no longer available. Ask for a new invitation'; end if;
  if inv.role not in ('admin','manager','accountant','staff') then raise exception 'Ask the owner to replace this invitation'; end if;
  -- Accepting an old invite must never change an existing member's role.
  insert into public.org_members(org_id,user_id,role,modules) values(inv.org_id,auth.uid(),inv.role,inv.modules)
    on conflict(org_id,user_id) do nothing;
  update public.profiles set org_id=inv.org_id where id=auth.uid();
  if not found then raise exception 'Complete your account profile before joining'; end if;
  update public.invitations set status=case when id=inv.id then 'accepted' else 'revoked' end,updated_at=now()
    where org_id=inv.org_id and lower(invitations.email)=v_email and status='pending';
end $$;

create or replace function public.filey_workspaces() returns table(id text,name text,role text)
language sql stable security definer set search_path=public,pg_temp as $$
  select o.id::text,o.name,m.role from public.organizations o join public.org_members m on m.org_id=o.id::text
    where m.user_id=auth.uid() order by o.name,o.id
$$;
create or replace function public.filey_my_invitations() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('workspace_name',o.name) order by i.created_at desc),'[]'::jsonb)
    from public.invitations i join public.organizations o on o.id::text=i.org_id
    where lower(i.email)=public.my_email() and i.status='pending' and i.expires_at>now()
$$;
create or replace function public.filey_switch_workspace(p_id text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.org_members where org_id=p_id and user_id=auth.uid()) then
    raise exception 'You are not a member of this workspace';
  end if;
  update public.profiles set org_id=p_id where id=auth.uid();
  if not found then raise exception 'Profile not found'; end if;
end $$;
create or replace function public.filey_create_workspace(p_name text) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id text;
begin
  if public.my_email() is null then raise exception 'Verify your account email first'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 then raise exception 'Use a workspace name of 1 to 120 characters'; end if;
  insert into public.organizations(name,owner_id) values(trim(p_name),auth.uid()) returning id::text into v_id;
  insert into public.org_members(org_id,user_id,role) values(v_id,auth.uid(),'owner');
  return v_id;
end $$;
-- All readable profiles in this workspace, even when a colleague has another
-- workspace active. Only the public team identity fields are returned.
create or replace function public.filey_team_members() returns table(id bigint,org_id text,user_id uuid,role text,modules text[],name text,email text)
language sql stable security definer set search_path=public,pg_temp as $$
  select m.id,m.org_id,m.user_id,m.role,m.modules,p.name,u.email::text
    from public.org_members m join public.profiles p on p.id=m.user_id join auth.users u on u.id=m.user_id
    where m.org_id=public.current_org() and exists(select 1 from public.org_members me where me.org_id=m.org_id and me.user_id=auth.uid())
    order by m.id
$$;

-- Thread pagination fetches roots separately; replies always remain attached.
-- ponytail: each selected thread loads all replies; paginate replies if large
-- conversations become slow rather than silently dropping their history.
create or replace function public.filey_message_page(p_channel text,p_before bigint default null,p_limit integer default 30)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  with activity as (select coalesce(parent_id,id) as root,max(id) as latest from public.org_messages where channel=p_channel group by coalesce(parent_id,id)),
  page as (select * from activity where p_before is null or latest<p_before order by latest desc limit greatest(1,least(p_limit,50))),
  roots as (select m.* from public.org_messages m join page p on p.root=m.id where m.channel=p_channel and m.parent_id is null),
  messages as (select * from roots union all select m.* from public.org_messages m join roots r on m.parent_id=r.id where m.channel=p_channel)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(m) order by m.id desc) from messages m),'[]'::jsonb),
    'next',case when (select count(*) from page)=greatest(1,least(p_limit,50)) then (select min(latest) from page) else null end)
$$;

create table if not exists public.org_channel_reads (
  org_id text not null default public.current_org(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  channel text not null, last_message_id bigint not null default 0, primary key(org_id,user_id,channel)
);
alter table public.org_channel_reads enable row level security;
revoke all on public.org_channel_reads from anon,authenticated;
create or replace function public.filey_mark_channel_read(p_channel text,p_last bigint) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.filey_can_use('team') then raise exception 'Team access is required'; end if;
  if p_last<0 or p_last>(select coalesce(max(id),0) from public.org_messages where org_id=public.current_org() and channel=p_channel) then
    raise exception 'Invalid message position'; end if;
  insert into public.org_channel_reads(org_id,user_id,channel,last_message_id) values(public.current_org(),auth.uid(),p_channel,p_last)
    on conflict(org_id,user_id,channel) do update set last_message_id=greatest(org_channel_reads.last_message_id,excluded.last_message_id);
end $$;
create or replace function public.filey_unread_channels() returns table(channel text,unread bigint)
language sql stable security definer set search_path=public,pg_temp as $$
  select m.channel,count(*) from public.org_messages m left join public.org_channel_reads r
    on r.org_id=m.org_id and r.user_id=auth.uid() and r.channel=m.channel
    where public.filey_can_use('team') and m.org_id=public.current_org() and m.user_id<>auth.uid()
      and m.id>coalesce(r.last_message_id,0) group by m.channel
$$;

create or replace function public.filey_validate_message() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is not null then new.org_id:=public.current_org(); new.user_id:=auth.uid(); end if;
  if length(trim(new.body)) not between 1 and 10000 then raise exception 'Messages must contain 1 to 10,000 characters'; end if;
  if new.channel !~ '^[a-z0-9][a-z0-9_-]{0,79}$' then raise exception 'Invalid channel name'; end if;
  if new.parent_id is not null and not exists(select 1 from public.org_messages p
    where p.id=new.parent_id and p.org_id=new.org_id and p.channel=new.channel and p.parent_id is null) then
    raise exception 'Reply must belong to a conversation in this channel'; end if;
  return new;
end $$;
drop trigger if exists trg_validate_message on public.org_messages;
create trigger trg_validate_message before insert on public.org_messages for each row execute function public.filey_validate_message();

create or replace function public.notify_mentions() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_name text;
begin
  select coalesce(nullif(name,''),'Team member') into actor_name from public.profiles where id=new.user_id;
  insert into public.notifications(org_id,user_id,actor,kind,body,link)
  select new.org_id,m.user_id,actor_name,'mention',left(new.body,140),
    '/team?channel='||new.channel||'&message='||coalesce(new.parent_id,new.id)::text
    from public.org_members m join public.profiles p on p.id=m.user_id
    where m.org_id=new.org_id and m.user_id<>new.user_id and (m.role in ('owner','admin') or m.modules is null or 'team'=any(m.modules))
      and lower(split_part(p.name,' ',1)) in (select lower(t[1]) from regexp_matches(new.body,'@([[:alnum:]_.\-]+)','g') t);
  return new;
end $$;

do $$ declare f record; t text; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('filey_prepare_invitation','filey_revoke_invitation','accept_invitation',
      'filey_workspaces','filey_my_invitations','filey_switch_workspace','filey_create_workspace','filey_team_members','filey_message_page','filey_mark_channel_read','filey_unread_channels') loop
    execute format('revoke all on function %s from public,anon',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
  foreach t in array array['org_channels','org_messages','org_members','invitations','notifications','profiles'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
