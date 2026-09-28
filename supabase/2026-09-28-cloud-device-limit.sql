-- Raise cloud workspace login slots from 5 to 20; preserve registrations and permissions.
BEGIN;
alter table public.org_devices add column if not exists session_id text;
alter table public.org_devices add column if not exists revoked_at timestamptz;

create or replace function public.register_device(p_fingerprint text, p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org text := public.current_org();
  v_id uuid;
  v_active int;
  v_device public.org_devices;
  v_session text:=auth.jwt()->>'session_id';
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if p_fingerprint is null or length(trim(p_fingerprint)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'missing_fingerprint');
  end if;

  -- SECURITY: serialize per-org registrations — two devices racing the
  -- count check below could both pass and exceed the slot limit (TOCTOU).
  perform pg_advisory_xact_lock(hashtext('org_devices:' || v_org));

  select * into v_device
    from org_devices
   where org_id = v_org and fingerprint = p_fingerprint;

  v_id:=v_device.id;
  if v_id is not null and v_device.revoked_at is not null
     and (v_session is null or v_device.session_id is not distinct from v_session
       or (v_device.session_id is null and coalesce((select created_at<=v_device.revoked_at
         from auth.sessions where id::text=v_session and user_id=auth.uid()),true))) then
    return jsonb_build_object('ok',false,'reason','logged_out');
  end if;
  if v_id is not null and v_device.revoked_at is null then
    update org_devices
       set last_seen = now(),
           user_id = auth.uid(),
           session_id = v_session,
           device_name = coalesce(nullif(p_name, ''), device_name)
     where id = v_id;
    return jsonb_build_object('ok', true, 'existing', true);
  end if;

  select count(*) into v_active from org_devices where org_id = v_org and revoked_at is null;
  if v_active >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'limit', 'limit', 20);
  end if;

  insert into org_devices (org_id, user_id, fingerprint, device_name,session_id)
  values (v_org, auth.uid(), p_fingerprint, nullif(p_name, ''),v_session)
  on conflict(org_id,fingerprint) do update set user_id=excluded.user_id,device_name=excluded.device_name,
    session_id=excluded.session_id,revoked_at=null,last_seen=now();
  return jsonb_build_object('ok', true);
end $fn$;

revoke all on function public.register_device(text, text) from public, anon;
grant execute on function public.register_device(text, text) to authenticated;

create or replace function public.filey_logout_device(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.org_devices set revoked_at=now() where id=p_id and org_id=public.current_org()
    and (user_id=auth.uid() or public.is_org_admin());
  if not found then raise exception 'This device could not be logged out. Refresh and try again'; end if;
end $$;
create or replace function public.filey_device_logged_out(p_fingerprint text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.org_devices where org_id=public.current_org() and fingerprint=p_fingerprint
    and user_id=auth.uid() and revoked_at is not null
    and (session_id is not distinct from (auth.jwt()->>'session_id') or (auth.jwt()->>'session_id') is null
      or (session_id is null and coalesce((select created_at<=org_devices.revoked_at
        from auth.sessions where id::text=(auth.jwt()->>'session_id') and user_id=auth.uid()),true))))
$$;
revoke all on function public.filey_logout_device(uuid),public.filey_device_logged_out(text) from public,anon;
grant execute on function public.filey_logout_device(uuid),public.filey_device_logged_out(text) to authenticated;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='org_devices') then
    alter publication supabase_realtime add table public.org_devices;
  end if;
end $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
