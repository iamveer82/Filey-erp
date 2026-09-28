-- Private images/documents shared only through readable team messages.
begin;
alter table public.org_messages add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.org_messages add column if not exists recipient_id uuid references auth.users(id) on delete cascade;
create index if not exists idx_org_messages_recipient on public.org_messages(org_id,recipient_id,id);
-- Even workspace administrators cannot read somebody else's direct conversation.
drop policy if exists team_message_participants on public.org_messages;
create policy team_message_participants on public.org_messages as restrictive for all to authenticated
  using(recipient_id is null or user_id=auth.uid() or recipient_id=auth.uid())
  with check(recipient_id is null or user_id=auth.uid());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('team-attachments','team-attachments',false,10485760,array[
  'image/jpeg','image/png','image/webp','image/gif','application/pdf','text/plain','text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists team_attachments_read on storage.objects;
create policy team_attachments_read on storage.objects for select to authenticated using (
  bucket_id='team-attachments' and (storage.foldername(name))[1]=public.current_org()
  and public.filey_can_use('team') and (
    (storage.foldername(name))[2]=auth.uid()::text or exists (
      select 1 from public.org_messages m where m.org_id=public.current_org()
      and m.attachments @> jsonb_build_array(jsonb_build_object('path',storage.objects.name))
    )
  )
);
drop policy if exists team_attachments_upload on storage.objects;
create policy team_attachments_upload on storage.objects for insert to authenticated with check (
  bucket_id='team-attachments' and (storage.foldername(name))[1]=public.current_org()
  and (storage.foldername(name))[2]=auth.uid()::text and public.filey_can_use('team')
);
-- Uploads are immutable once sent. Failed sends can remove their own unreferenced
-- uploads; an uncertain network response must never delete a committed attachment.
drop policy if exists team_attachments_remove on storage.objects;
create policy team_attachments_remove on storage.objects for delete to authenticated using (
  bucket_id='team-attachments' and (storage.foldername(name))[1]=public.current_org()
  and (storage.foldername(name))[2]=auth.uid()::text and public.filey_can_use('team')
  and not exists(select 1 from public.org_messages m where m.org_id=public.current_org()
    and m.attachments @> jsonb_build_array(jsonb_build_object('path',storage.objects.name)))
);

create or replace function public.filey_validate_message() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare a jsonb; v_metadata jsonb; v_paths text[]:='{}';
begin
  if auth.uid() is not null then new.org_id:=public.current_org(); new.user_id:=auth.uid(); end if;
  if new.body is null or length(trim(new.body))>10000 then raise exception 'Messages must contain at most 10,000 characters'; end if;
  if new.attachments is null or jsonb_typeof(new.attachments)<>'array' then raise exception 'Invalid attachments'; end if;
  if jsonb_array_length(new.attachments)>5 then raise exception 'Choose up to 5 attachments'; end if;
  if length(trim(new.body))=0 and jsonb_array_length(new.attachments)=0 then raise exception 'Add a message or attachment'; end if;
  if new.channel is null or new.channel !~ '^[a-z0-9][a-z0-9_-]{0,79}$' then raise exception 'Invalid channel name'; end if;
  if new.recipient_id is not null and (new.recipient_id=new.user_id or not exists(
    select 1 from public.org_members where org_id=new.org_id and user_id=new.recipient_id
      and (role in ('owner','admin') or modules is null or 'team'=any(modules)))) then
    raise exception 'Choose a teammate with chat access in this workspace';
  end if;
  if new.parent_id is not null and not exists(select 1 from public.org_messages p
    where p.id=new.parent_id and p.org_id=new.org_id and p.channel=new.channel and p.parent_id is null
      and ((new.recipient_id is null and p.recipient_id is null) or
        (p.user_id=new.user_id and p.recipient_id=new.recipient_id) or (p.user_id=new.recipient_id and p.recipient_id=new.user_id))) then
    raise exception 'Reply must belong to a conversation in this channel';
  end if;
  for a in select value from jsonb_array_elements(new.attachments) loop
    if jsonb_typeof(a)<>'object' or jsonb_typeof(a->'name') is distinct from 'string'
      or length(a->>'name') not between 1 and 240 or jsonb_typeof(a->'size') is distinct from 'number'
      or jsonb_typeof(a->'mime') is distinct from 'string' or jsonb_typeof(a->'path') is distinct from 'string'
      or split_part(a->>'path','/',1)<>new.org_id or split_part(a->>'path','/',2)<>new.user_id::text
      or split_part(a->>'path','/',3) !~ '^[a-f0-9-]{36}\.(png|jpg|jpeg|webp|gif|pdf|txt|csv|docx|xlsx|pptx)$'
      or array_length(string_to_array(a->>'path','/'),1)<>3 or (a->>'path')=any(v_paths)
    then raise exception 'Invalid attachment'; end if;
    select metadata into v_metadata from storage.objects where bucket_id='team-attachments' and name=a->>'path';
    if not found or (a->>'size')::numeric not between 1 and 10485760
      or (a->>'size')::numeric is distinct from (v_metadata->>'size')::numeric
      or (a->>'mime') is distinct from (v_metadata->>'mimetype')
      or not ((a->>'mime')=any(array['image/jpeg','image/png','image/webp','image/gif','application/pdf','text/plain','text/csv',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation']))
    then raise exception 'Upload this attachment again'; end if;
    v_paths:=array_append(v_paths,a->>'path');
  end loop;
  return new;
end $$;
drop trigger if exists trg_validate_message on public.org_messages;
create trigger trg_validate_message before insert or update of body,attachments,parent_id,channel,recipient_id on public.org_messages
  for each row execute function public.filey_validate_message();

create or replace function public.filey_message_page(p_channel text,p_before bigint default null,p_limit integer default 30)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  with activity as (select coalesce(parent_id,id) as root,max(id) as latest from public.org_messages where channel=p_channel and recipient_id is null group by coalesce(parent_id,id)),
  page as (select * from activity where p_before is null or latest<p_before order by latest desc limit greatest(1,least(p_limit,50))),
  roots as (select m.* from public.org_messages m join page p on p.root=m.id where m.channel=p_channel and m.parent_id is null and m.recipient_id is null),
  messages as (select * from roots union all select m.* from public.org_messages m join roots r on m.parent_id=r.id where m.channel=p_channel and m.recipient_id is null)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(m) order by m.id desc) from messages m),'[]'::jsonb),
    'next',case when (select count(*) from page)=greatest(1,least(p_limit,50)) then (select min(latest) from page) else null end)
$$;
create or replace function public.filey_direct_message_page(p_person uuid,p_before bigint default null,p_limit integer default 30)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  with visible as (select * from public.org_messages where (user_id=auth.uid() and recipient_id=p_person) or (user_id=p_person and recipient_id=auth.uid())),
  activity as (select coalesce(parent_id,id) as root,max(id) as latest from visible group by coalesce(parent_id,id)),
  page as (select * from activity where p_before is null or latest<p_before order by latest desc limit greatest(1,least(p_limit,50))),
  messages as (select m.* from visible m join page p on coalesce(m.parent_id,m.id)=p.root)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(m) order by m.id desc) from messages m),'[]'::jsonb),
    'next',case when (select count(*) from page)=greatest(1,least(p_limit,50)) then (select min(latest) from page) else null end)
$$;
create or replace function public.filey_unread_channels() returns table(channel text,unread bigint)
language sql stable security definer set search_path=public,pg_temp as $$
  select m.channel,count(*) from public.org_messages m left join public.org_channel_reads r
    on r.org_id=m.org_id and r.user_id=auth.uid() and r.channel=m.channel
    where public.filey_can_use('team') and m.org_id=public.current_org() and m.user_id<>auth.uid() and m.recipient_id is null
      and m.id>coalesce(r.last_message_id,0) group by m.channel
$$;
create or replace function public.filey_unread_direct_messages() returns table(person uuid,unread bigint)
language sql stable security invoker set search_path=public,pg_temp as $$
  select m.user_id,count(*) from public.org_messages m left join public.org_channel_reads r
    on r.org_id=m.org_id and r.user_id=auth.uid() and r.channel='dm:'||m.user_id::text
    where m.recipient_id=auth.uid() and m.id>coalesce(r.last_message_id,0) group by m.user_id
$$;
-- Only the caller's read positions, needed by the invoker-scoped unread query.
drop policy if exists org_channel_reads_own on public.org_channel_reads;
create policy org_channel_reads_own on public.org_channel_reads for select to authenticated
  using(org_id=public.current_org() and user_id=auth.uid() and public.filey_can_use('team'));
grant select on public.org_channel_reads to authenticated;
create or replace function public.filey_mark_direct_read(p_person uuid,p_last bigint) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.filey_can_use('team') then raise exception 'Team access is required'; end if;
  if p_last<0 or p_last>(select coalesce(max(id),0) from public.org_messages where org_id=public.current_org()
    and ((user_id=auth.uid() and recipient_id=p_person) or (user_id=p_person and recipient_id=auth.uid()))) then raise exception 'Invalid message position'; end if;
  insert into public.org_channel_reads(org_id,user_id,channel,last_message_id) values(public.current_org(),auth.uid(),'dm:'||p_person::text,p_last)
    on conflict(org_id,user_id,channel) do update set last_message_id=greatest(org_channel_reads.last_message_id,excluded.last_message_id);
end $$;

create or replace function public.notify_mentions() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_name text;
begin
  select coalesce(nullif(name,''),'Team member') into actor_name from public.profiles where id=new.user_id;
  insert into public.notifications(org_id,user_id,actor,kind,body,link)
  select new.org_id,m.user_id,actor_name,case when new.recipient_id is null then 'mention' else 'message' end,
    case when new.recipient_id is null then left(new.body,140) else 'Sent you a private message' end,
    case when new.recipient_id is null then '/team?channel='||new.channel else '/team?person='||new.user_id::text end
      ||'&message='||coalesce(new.parent_id,new.id)::text
    from public.org_members m join public.profiles p on p.id=m.user_id
    where m.org_id=new.org_id and m.user_id<>new.user_id and (m.role in ('owner','admin') or m.modules is null or 'team'=any(m.modules))
      and ((new.recipient_id=m.user_id) or (new.recipient_id is null
        and lower(split_part(p.name,' ',1)) in (select lower(t[1]) from regexp_matches(new.body,'@([[:alnum:]_.\-]+)','g') t)));
  return new;
end $$;
revoke all on function public.filey_direct_message_page(uuid,bigint,integer),public.filey_unread_direct_messages(),public.filey_mark_direct_read(uuid,bigint) from public,anon;
grant execute on function public.filey_direct_message_page(uuid,bigint,integer),public.filey_unread_direct_messages(),public.filey_mark_direct_read(uuid,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
