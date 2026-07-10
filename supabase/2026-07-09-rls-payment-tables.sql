-- ============================================================
--  Filey ERP — SECURITY FIX: RLS on po_payments + payment_receipts
--  Run in:  Supabase Dashboard → SQL Editor → New query
--  Safe to re-run (idempotent).
--
--  Both tables shipped WITHOUT row level security. In Supabase that means
--  ANY authenticated user could read and write EVERY org's rows through
--  PostgREST (cross-tenant leak of customer names, TRNs and amounts).
--  This applies the same org/privacy policy the other business tables get
--  from schema.sql's RLS loop: own rows always; org rows for admins or
--  when shared = true; org_id pinned + frozen by force_org_id().
-- ============================================================

do $$
declare
  t text;
  tables text[] := array['po_payments','payment_receipts'];
begin
  foreach t in array tables loop
    execute format(
      'alter table %I add column if not exists org_id text not null default public.current_org();',
      t
    );
    execute format('alter table %I add column if not exists shared boolean not null default false;', t);
    execute format('alter table %I enable row level security;', t);

    execute format('drop trigger if exists %I on %I;', 'trg_' || t || '_org', t);
    execute format(
      'create trigger %I before insert or update on %I for each row execute function public.force_org_id();',
      'trg_' || t || '_org', t
    );

    execute format('drop policy if exists %I on %I;', t || '_access', t);
    execute format(
      'create policy %I on %I for all '
      || 'using (user_id = auth.uid() '
      || 'or (org_id = public.current_org() '
      || 'and (public.is_org_admin() or shared = true))) '
      || 'with check (user_id = auth.uid() '
      || 'or (org_id = public.current_org() and public.is_org_admin()));',
      t || '_access', t
    );

    -- Backfill org_id from each row owner's profile (pre-fix rows default
    -- to whatever current_org() resolved to in admin context).
    execute format(
      'update public.%I x set org_id = p.org_id
         from public.profiles p
        where x.user_id = p.id
          and x.org_id is distinct from p.org_id;',
      t
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- register_device: close the TOCTOU race on the 5-device slot
-- limit (two devices racing the count check could both pass).
-- Same body as schema.sql, plus the per-org advisory lock.
-- ------------------------------------------------------------
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

  -- SECURITY: serialize per-org registrations — two devices racing the
  -- count check below could both pass and exceed the slot limit (TOCTOU).
  perform pg_advisory_xact_lock(hashtext('org_devices:' || v_org));

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
