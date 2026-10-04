-- Registry fingerprints/session IDs are device credentials, not public team
-- identity. Removed members cannot inspect, occupy or release workspace slots.
-- Requires 2026-10-03-workspace-membership-read-integrity.sql.
begin;
drop policy if exists org_devices_select on public.org_devices;
create policy org_devices_select on public.org_devices for select to authenticated
  using(org_id=public.current_org() and public.filey_is_workspace_member(org_id)
    and (user_id=auth.uid() or public.is_org_admin()));
drop policy if exists filey_device_member on public.org_devices;
create policy filey_device_member on public.org_devices as restrictive for all to authenticated
  using(public.filey_is_workspace_member(org_id)) with check(public.filey_is_workspace_member(org_id));
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
  if not public.filey_is_workspace_member(v_org) then
    return jsonb_build_object('ok',false,'reason','workspace_access');
  end if;
  if p_fingerprint is null or length(trim(p_fingerprint)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'missing_fingerprint');
  end if;

  if length(p_fingerprint)>256 or length(coalesce(p_name,''))>200 then
    return jsonb_build_object('ok',false,'reason','invalid_device');
  end if;

  -- SECURITY: serialize per-org registrations — two devices racing the
  -- count check below could both pass and exceed the slot limit (TOCTOU).
  perform pg_advisory_xact_lock(hashtext('org_devices:' || v_org));

  select * into v_device
    from org_devices
   where org_id = v_org and fingerprint = p_fingerprint;

  v_id:=v_device.id;
  if v_id is not null and v_device.user_id is distinct from auth.uid() then
    return jsonb_build_object('ok',false,'reason','device_in_use');
  end if;
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
  if not public.filey_is_workspace_member(public.current_org()) then raise exception 'Workspace access denied' using errcode='42501'; end if;
  update public.org_devices set revoked_at=now() where id=p_id and org_id=public.current_org()
    and (user_id=auth.uid() or public.is_org_admin());
  if not found then raise exception 'This device could not be logged out. Refresh and try again'; end if;
end $$;
create or replace function public.filey_device_logged_out(p_fingerprint text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.filey_is_workspace_member(public.current_org()) and exists(select 1 from public.org_devices where org_id=public.current_org() and fingerprint=p_fingerprint
    and user_id=auth.uid() and revoked_at is not null
    and (session_id is not distinct from (auth.jwt()->>'session_id') or (auth.jwt()->>'session_id') is null
      or (session_id is null and coalesce((select created_at<=org_devices.revoked_at
        from auth.sessions where id::text=(auth.jwt()->>'session_id') and user_id=auth.uid()),true))))
$$;
revoke all on function public.filey_logout_device(uuid),public.filey_device_logged_out(text) from public,anon;
grant execute on function public.filey_logout_device(uuid),public.filey_device_logged_out(text) to authenticated;
notify pgrst,'reload schema';
commit;
