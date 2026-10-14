-- 2026-10-14: change feed — a device downloads only what changed since it last asked.
-- Idempotent: safe to re-run. Apply after 2026-09-12-sync-conflict-protection.sql.
--
-- Every write to a synchronized table appends one small row to public.sync_changes
-- (table, row id, operation, revision, owner). A device keeps a cursor and calls
-- filey_sync_changes(cursor): when nothing changed that is one tiny request, and
-- otherwise it returns only the changed rows' ids and revisions, so the device
-- fetches only rows it does not already hold. No whole-app scans after the first copy.
--
-- Cursor: pg_snapshot_xmin at read time. Every transaction that commits later has
-- an id at or above it, so nothing is skipped; rows near the cursor may come back
-- twice, which is harmless.
--
-- Privacy: clients cannot read sync_changes. The feed is SECURITY INVOKER and
-- re-checks every changed row against the caller's own RLS; rows the caller can
-- no longer see are reported as removed. Only deletions are reported from the log
-- itself, to the row's owner and members of its organization (ids only).
begin;

create schema if not exists filey_private;
revoke all on schema filey_private from public, anon;
grant usage on schema filey_private to authenticated;

create table if not exists public.sync_changes (
  seq bigint generated always as identity primary key,
  table_name text not null,
  row_id text not null,
  op "char" not null check (op in ('u', 'd')),
  revision bigint,
  org_id text,
  user_id uuid,
  txid xid8 not null default pg_current_xact_id(),
  changed_at timestamptz not null default now()
);
create index if not exists sync_changes_txid_idx on public.sync_changes (txid);
create index if not exists sync_changes_changed_at_idx on public.sync_changes (changed_at);
alter table public.sync_changes enable row level security;
revoke all on public.sync_changes from public, anon, authenticated;

-- Oldest position still answerable; a cursor at or below it must copy everything once.
create table if not exists filey_private.sync_change_watermark (
  id boolean primary key default true check (id),
  pruned_through xid8 not null default '0'::xid8
);
insert into filey_private.sync_change_watermark default values on conflict do nothing;
revoke all on filey_private.sync_change_watermark from public, anon, authenticated;
-- One transaction id, read by the feed (which runs as the caller).
grant select on filey_private.sync_change_watermark to authenticated;

-- TG_ARGV: 'org' when the table has org_id, 'user' when it has user_id.
create or replace function public.filey_log_sync_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org text; v_user uuid; v_old_org text; v_old_user uuid;
begin
  if TG_ARGV[0] = 'org' then
    if TG_OP <> 'INSERT' then v_old_org := old.org_id::text; end if;
    if TG_OP <> 'DELETE' then v_org := new.org_id::text; end if;
  end if;
  if TG_ARGV[1] = 'user' then
    if TG_OP <> 'INSERT' then v_old_user := old.user_id::uuid; end if;
    if TG_OP <> 'DELETE' then v_user := new.user_id::uuid; end if;
  end if;
  if TG_OP = 'DELETE' then
    insert into public.sync_changes (table_name, row_id, op, org_id, user_id)
      values (TG_TABLE_NAME, old.id::text, 'd', v_old_org, v_old_user);
    return null;
  end if;
  -- Moving a row to another owner removes it from the previous owner's devices.
  if TG_OP = 'UPDATE' and (v_old_org is distinct from v_org or v_old_user is distinct from v_user) then
    insert into public.sync_changes (table_name, row_id, op, org_id, user_id)
      values (TG_TABLE_NAME, old.id::text, 'd', v_old_org, v_old_user);
  end if;
  insert into public.sync_changes (table_name, row_id, op, revision, org_id, user_id)
    values (TG_TABLE_NAME, new.id::text, 'u', new.sync_revision, v_org, v_user);
  return null;
end $$;
revoke all on function public.filey_log_sync_change() from public, anon, authenticated;

do $$ declare t text; has_org boolean; has_user boolean; begin
  foreach t in array array[
    'company_profile','app_settings','suppliers','crm_customers','products','orders','order_items',
    'invoice_docs','invoice_doc_items','work_items','invoice_payments','invoice_recurrence',
    'quotations','quotation_items','quotation_templates','purchase_orders','purchase_order_items',
    'po_payments','payment_receipts','accounts','expenses','transactions','advances','stock_movements',
    'employees','attendance','payroll','crm_leads','crm_people','crm_opportunities','crm_activities',
    'crm_notes','crm_tasks','follow_ups','entity_links','org_channels','org_messages','email_messages',
    'call_logs','tool_runs','user_folders','user_files','user_assets','email_optouts','campaigns'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    select exists(select 1 from pg_attribute where attrelid = to_regclass('public.' || t) and attname = 'org_id' and attnum > 0 and not attisdropped),
           exists(select 1 from pg_attribute where attrelid = to_regclass('public.' || t) and attname = 'user_id' and attnum > 0 and not attisdropped)
      into has_org, has_user;
    execute format('drop trigger if exists filey_sync_change on public.%I', t);
    execute format('create trigger filey_sync_change after insert or update or delete on public.%I for each row execute function public.filey_log_sync_change(%L, %L)',
      t, case when has_org then 'org' else '-' end, case when has_user then 'user' else '-' end);
  end loop;
end $$;

-- The newest log entry per row since the cursor, for the caller's account and organization.
create or replace function filey_private.sync_entries(p_since xid8, p_limit integer)
returns table (table_name text, row_id text, op "char")
language sql stable security definer set search_path = public, pg_temp as $$
  select e.table_name, e.row_id, e.op from (
    select distinct on (c.table_name, c.row_id) c.table_name, c.row_id, c.op
    from public.sync_changes c
    where c.txid >= p_since
      and (c.user_id = auth.uid() or (c.org_id <> 'default' and c.org_id = public.current_org()))
    order by c.table_name, c.row_id, c.seq desc
  ) e
  limit p_limit
$$;
revoke all on function filey_private.sync_entries(xid8, integer) from public, anon;
grant execute on function filey_private.sync_entries(xid8, integer) to authenticated;

-- Where a device stands right now: take this BEFORE a complete copy, then ask from it.
-- The workspace comes back too: a cursor only describes a copy of that workspace.
drop function if exists public.filey_sync_cursor();
create function public.filey_sync_cursor() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'cursor', pg_snapshot_xmin(pg_current_snapshot())::text, 'org', public.current_org()) end
$$;
revoke all on function public.filey_sync_cursor() from public, anon;
grant execute on function public.filey_sync_cursor() to authenticated;

create or replace function public.filey_sync_changes(p_since text, p_limit integer default 2000)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_cursor xid8 := pg_snapshot_xmin(pg_current_snapshot());
  v_since xid8;
  v_entries jsonb;
  v_out jsonb := '[]'::jsonb;
  v_visible jsonb;
  v_type text;
  r record;
begin
  if auth.uid() is null then raise insufficient_privilege; end if;
  if p_since is null or p_since !~ '^[0-9]{1,20}$' or p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'Invalid sync change request';
  end if;
  v_since := p_since::xid8;
  if exists (select 1 from filey_private.sync_change_watermark w where w.pruned_through >= v_since) then
    return jsonb_build_object('stale', true, 'cursor', v_cursor::text, 'org', public.current_org());
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('t', e.table_name, 'id', e.row_id, 'op', e.op)), '[]'::jsonb)
    into v_entries from filey_private.sync_entries(v_since, p_limit + 1) e;
  -- Away too long: one complete copy is cheaper than a huge list.
  if jsonb_array_length(v_entries) > p_limit then
    return jsonb_build_object('stale', true, 'cursor', v_cursor::text, 'org', public.current_org());
  end if;
  for r in
    select x->>'t' as t,
      array_agg(x->>'id') filter (where x->>'op' = 'u') as ups,
      array_agg(x->>'id') filter (where x->>'op' = 'd') as downs
    from jsonb_array_elements(v_entries) x group by 1
  loop
    if to_regclass('public.' || r.t) is null then continue; end if;
    if r.downs is not null then
      v_out := v_out || (select jsonb_agg(jsonb_build_object('t', r.t, 'id', d, 'op', 'd')) from unnest(r.downs) d);
    end if;
    if r.ups is not null then
      select format_type(a.atttypid, a.atttypmod) into v_type from pg_attribute a
        where a.attrelid = to_regclass('public.' || r.t) and a.attname = 'id' and not a.attisdropped;
      -- The caller's own RLS decides; rows it cannot see now leave its devices.
      execute format('select coalesce(jsonb_object_agg(id::text, sync_revision), ''{}''::jsonb) from public.%I where id = any($1::%s[])', r.t, v_type)
        into v_visible using r.ups;
      v_out := v_out || (select jsonb_agg(case when v_visible ? u
        then jsonb_build_object('t', r.t, 'id', u, 'op', 'u', 'rev', v_visible -> u)
        else jsonb_build_object('t', r.t, 'id', u, 'op', 'd') end) from unnest(r.ups) u);
    end if;
  end loop;
  return jsonb_build_object('cursor', v_cursor::text, 'org', public.current_org(), 'changes', v_out);
end $$;
revoke all on function public.filey_sync_changes(text, integer) from public, anon;
grant execute on function public.filey_sync_changes(text, integer) to authenticated;

-- Keeps the log small. Devices away longer than p_keep copy everything once.
create or replace function filey_private.prune_sync_changes(p_keep interval default interval '30 days')
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_last xid8; v_count integer;
begin
  select c.txid into v_last from public.sync_changes c
    where c.changed_at < now() - p_keep order by c.txid desc limit 1;
  if v_last is null then return 0; end if;
  update filey_private.sync_change_watermark set pruned_through = v_last where pruned_through < v_last;
  delete from public.sync_changes where txid <= v_last;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function filey_private.prune_sync_changes(interval) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('filey-prune-sync-changes', '17 3 * * *', 'select filey_private.prune_sync_changes()');
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
