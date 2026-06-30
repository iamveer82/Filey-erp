-- ============================================================
--  2026-06-30 — Audit trail hardening
--
--  Two changes, both Tier-A "trust" requirements:
--    1. log_audit() now records a before->after diff (the `changes`
--       jsonb column), not just "something happened on table X".
--    2. audit_log is APPEND-ONLY — members may read their org's trail
--       and append rows, but no one (not even an admin) may update or
--       delete an audit row. An editable audit log is worthless.
--    3. Coverage extends to money movements (invoice/PO payments).
--
--  Idempotent. Run in Supabase Dashboard -> SQL Editor.
--  Mirrors schema.sql; verify afterwards with verify-rls.sql (Section 1c).
-- ============================================================

-- 1. before->after capture column ---------------------------------------------
alter table public.audit_log add column if not exists changes jsonb;

-- 2. diff-capturing trigger function ------------------------------------------
create or replace function public.log_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor_name text;
  rid text;
  diff jsonb;
  old_j jsonb;
  new_j jsonb;
begin
  begin
    select coalesce(name, email, 'system') into actor_name
      from public.profiles where id = auth.uid();

    if (TG_OP = 'DELETE') then
      rid  := old.id::text;
      diff := jsonb_build_object('_deleted', to_jsonb(old));
    elsif (TG_OP = 'INSERT') then
      rid  := new.id::text;
      diff := jsonb_build_object('_created', to_jsonb(new));
    else
      -- UPDATE: record only the columns that actually changed (old -> new),
      -- ignoring updated_at noise. A no-op update writes no audit row.
      rid   := new.id::text;
      old_j := to_jsonb(old);
      new_j := to_jsonb(new);
      select coalesce(
               jsonb_object_agg(k, jsonb_build_object('old', old_j -> k, 'new', new_j -> k)),
               '{}'::jsonb)
        into diff
        from jsonb_object_keys(new_j) as k
       where (new_j -> k) is distinct from (old_j -> k)
         and k <> 'updated_at';
      if diff = '{}'::jsonb then
        return new;
      end if;
    end if;

    insert into public.audit_log (actor, action, entity, details, changes, org_id, user_id)
    values (
      coalesce(actor_name, 'system'),
      lower(TG_OP),
      TG_TABLE_NAME,
      TG_TABLE_NAME || ' #' || coalesce(rid, '?'),
      diff,
      public.current_org(),
      auth.uid()
    );
  exception when others then
    null; -- never let auditing break the real write
  end;
  if (TG_OP = 'DELETE') then return old; else return new; end if;
end $$;

-- 3. (re)attach audit triggers, now including money movements -----------------
do $$
declare
  t text;
  audited text[] := array[
    'products','orders','invoice_docs','quotations','crm_customers',
    'crm_leads','crm_opportunities','expenses','suppliers',
    'purchase_orders','employees','payroll',
    'invoice_payments','po_payments'
  ];
begin
  foreach t in array audited loop
    -- skip tables that don't exist in this database
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists %I on public.%I;', 'trg_audit_'||t, t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I '
      || 'for each row execute function public.log_audit();',
      'trg_audit_'||t, t
    );
  end loop;
end $$;

-- 4. audit_log is append-only (immutable) -------------------------------------
-- Replace the generic for-all policy with explicit select + insert. No
-- update/delete policy => RLS denies those operations by default.
drop policy if exists audit_log_org on audit_log;
drop policy if exists audit_log_select on audit_log;
drop policy if exists audit_log_insert on audit_log;
create policy audit_log_select on audit_log for select
  using (org_id = public.current_org());
create policy audit_log_insert on audit_log for insert
  with check (org_id = public.current_org());
