-- ============================================================
--  Filey ERP — org_devices: cloud (Pro) device registry, 5 per org
--  Run in:  Supabase Dashboard → SQL Editor → New query
--  Safe to re-run (idempotent).
--  Each cloud device registers on launch via register_device(); the 6th
--  device is refused until a member (or admin) releases one. Release = row
--  delete (frees the slot immediately).
-- ============================================================

create table if not exists org_devices (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  device_name text,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_org_devices_unique
  on org_devices(org_id, fingerprint);
create index if not exists idx_org_devices_org on org_devices(org_id);

alter table org_devices enable row level security;

-- Members see their org's devices; a member may release their own device,
-- an org admin may release any. Inserts/updates happen only through the
-- register_device() RPC (security definer) so the 5-slot limit can't be
-- bypassed with a direct insert.
drop policy if exists org_devices_select on org_devices;
create policy org_devices_select on org_devices for select
  using (org_id = public.current_org());

drop policy if exists org_devices_delete on org_devices;
create policy org_devices_delete on org_devices for delete
  using (org_id = public.current_org()
         and (user_id = auth.uid() or public.is_org_admin()));

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
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if p_fingerprint is null or length(trim(p_fingerprint)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'missing_fingerprint');
  end if;

  select id into v_id
    from org_devices
   where org_id = v_org and fingerprint = p_fingerprint;

  if v_id is not null then
    update org_devices
       set last_seen = now(),
           user_id = auth.uid(),
           device_name = coalesce(nullif(p_name, ''), device_name)
     where id = v_id;
    return jsonb_build_object('ok', true, 'existing', true);
  end if;

  select count(*) into v_active from org_devices where org_id = v_org;
  if v_active >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'limit', 'limit', 5);
  end if;

  insert into org_devices (org_id, user_id, fingerprint, device_name)
  values (v_org, auth.uid(), p_fingerprint, nullif(p_name, ''));
  return jsonb_build_object('ok', true);
end $fn$;

revoke all on function public.register_device(text, text) from public;
grant execute on function public.register_device(text, text) to authenticated;
