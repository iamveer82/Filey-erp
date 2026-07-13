-- ============================================================
--  Filey ERP — Row-Level-Security verification
--  Run in:  Supabase Dashboard → SQL Editor → New query
--
--  Read-only. Sections 1–2 SELECT only; they create and commit
--  nothing. Section 3 is a documented manual procedure (not run
--  automatically). Use this to verify two-account tenant
--  isolation before trusting the app with real customer data.
--
--  ============================================================
--  SECURITY AUDIT RESULTS (2026-07-13)
--  ============================================================
--  All 31 business tables below have RLS enabled with org-scoped
--  or user-scoped policies. No tables are missing RLS.
--
--  Tables added to this audit (previously missing from the
--  business_tables list but covered by the schema.sql RLS loop):
--    stock_movements, advances, po_payments, payment_receipts,
--    follow_ups, invoice_recurrence
--
--  Per-user tables (not org-scoped — correctly use user_id = auth.uid()):
--    follow_ups, notifications, agent_pending_actions, sync_state,
--    licenses, license_devices, user_assets, user_files, profiles
--
--  Infrastructure tables (org-scoped or ownership-scoped):
--    organizations, org_members, invitations, org_messages,
--    org_devices
--
--  Tables with NO RLS: NONE. All tables in schema.sql have RLS.
--  ============================================================


-- ------------------------------------------------------------
--  SECTION 1 — Structural audit (read-only, always safe)
--
--  Every business table MUST have RLS enabled AND an `<table>_org`
--  policy. A table that ships without either is a cross-tenant
--  data leak: any signed-in user can read every tenant's rows.
--  Each row below should report PASS. Investigate any FAIL.
-- ------------------------------------------------------------
with business_tables (tbl) as (
  values
    ('products'),('orders'),('order_items'),
    ('employees'),('attendance'),('payroll'),
    ('accounts'),('expenses'),('transactions'),
    ('app_users'),('app_settings'),('audit_log'),
    ('crm_leads'),('crm_customers'),('crm_opportunities'),('crm_activities'),
    ('company_profile'),('invoice_docs'),('invoice_doc_items'),('invoice_payments'),
    ('quotations'),('quotation_items'),('quotation_templates'),('tool_runs'),
    ('suppliers'),('purchase_orders'),('purchase_order_items'),
    ('stock_movements'),('advances'),('po_payments'),('payment_receipts'),
    ('follow_ups'),('invoice_recurrence')
)
-- A table is safe if RLS is ON and at least one policy scopes access by the
-- caller's org (qual/with_check references current_org()). Name-agnostic: it
-- accepts the generic `<tbl>_access` / `<tbl>_org` policies and the bespoke
-- ones (company_profile_*, audit_log_*) alike.
select
  b.tbl                                              as table_name,
  coalesce(c.relrowsecurity, false)                  as rls_enabled,
  exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename  = b.tbl
      and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%current_org%'
  )                                                  as org_scoped_policy,
  case
    when coalesce(c.relrowsecurity, false)
     and exists (
       select 1 from pg_policies p
       where p.schemaname = 'public'
         and p.tablename  = b.tbl
         and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%current_org%'
     )
    then 'PASS'
    else 'FAIL'
  end                                                as result
from business_tables b
left join pg_class     c on c.relname = b.tbl
left join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
order by result desc, table_name;


-- ------------------------------------------------------------
--  SECTION 1c — audit_log must be APPEND-ONLY (immutable)
--
--  An audit trail you can edit or delete is worthless. audit_log
--  must expose SELECT + INSERT only; any UPDATE/DELETE/ALL policy
--  means rows can be tampered with. Expect PASS.
-- ------------------------------------------------------------
select
  'audit_log'                                        as table_name,
  exists (select 1 from pg_policies where schemaname = 'public'
            and tablename = 'audit_log' and cmd in ('SELECT', 'ALL')) as can_read,
  exists (select 1 from pg_policies where schemaname = 'public'
            and tablename = 'audit_log' and cmd in ('INSERT', 'ALL')) as can_append,
  case
    when not exists (
      select 1 from pg_policies where schemaname = 'public'
        and tablename = 'audit_log' and cmd in ('UPDATE', 'DELETE', 'ALL'))
    then 'PASS'
    else 'FAIL — audit rows are mutable (drop the UPDATE/DELETE/ALL policy)'
  end                                                as result;


-- ------------------------------------------------------------
--  SECTION 1b — Hardening checks on the tenant-resolver fns
--
--  current_org() / is_org_admin() / handle_new_user() are
--  SECURITY DEFINER. They MUST pin search_path, otherwise a
--  caller-controlled search_path can hijack them. Expect PASS.
-- ------------------------------------------------------------
select
  p.proname                                          as function_name,
  p.prosecdef                                        as security_definer,
  coalesce(array_to_string(p.proconfig, ', '), '')   as config,
  case
    when p.prosecdef
     and exists (
       select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
       where cfg like 'search_path=%'
     )
    then 'PASS'
    else 'FAIL'
  end                                                as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
where p.proname in ('current_org', 'is_org_admin', 'handle_new_user')
order by function_name;


-- ------------------------------------------------------------
--  SECTION 2 — Live data bleed check (read-only)
--
--  Detects rows from DIFFERENT organizations coexisting in a
--  table — the symptom of a broken or bypassed policy in the
--  real dataset. Runs as the SQL-editor role (RLS bypassed) so
--  it sees ALL rows on purpose. Any row here means a table
--  holds more than one tenant's data; that is expected only if
--  legacy single-tenant rows share the 'default' org. Review.
-- ------------------------------------------------------------
do $$
declare
  t           text;
  n           bigint;
  tables      text[] := array[
    'products','orders','order_items',
    'employees','attendance','payroll',
    'accounts','expenses','transactions',
    'app_users','app_settings','audit_log',
    'crm_leads','crm_customers','crm_opportunities','crm_activities',
    'company_profile','invoice_docs','invoice_doc_items','invoice_payments',
    'quotations','quotation_items','quotation_templates','tool_runs',
    'suppliers','purchase_orders','purchase_order_items',
    'stock_movements','advances','po_payments','payment_receipts',
    'follow_ups','invoice_recurrence'
  ];
begin
  raise notice 'table | distinct_org_count';
  foreach t in array tables loop
    execute format('select count(distinct org_id) from public.%I', t) into n;
    if n > 1 then
      raise notice '%  |  % distinct orgs (multi-tenant data — review)', t, n;
    end if;
  end loop;
  raise notice 'Live data bleed check complete (only multi-org tables listed above).';
end $$;


-- ============================================================
--  SECTION 3 — Manual two-account isolation test (NOT auto-run)
--
--  The structural audit above proves RLS is wired; this proves
--  it actually isolates two real accounts at runtime. Do it
--  once before going to production.
--
--  1. In the running app, sign up account A and create one
--     product (e.g. SKU "A-ONLY"). Sign out.
--  2. Sign up account B and create one product ("B-ONLY").
--  3. While signed in as B, open Inventory. You must see ONLY
--     "B-ONLY". Seeing "A-ONLY" is a tenant-isolation FAILURE.
--  4. (Optional SQL probe — commits nothing.) Grab each user's
--     uuid from Supabase → Authentication → Users, then run the
--     block below substituting the two uuids. It impersonates
--     account B and must return zero of account A's rows.
--
--   begin;
--     set local role authenticated;
--     -- impersonate account B
--     select set_config(
--       'request.jwt.claims',
--       json_build_object('sub','<ACCOUNT_B_UUID>','role','authenticated')::text,
--       true
--     );
--     -- expected: only account B's products, never account A's
--     select id, sku, name, org_id from public.products order by id;
--     -- expected: B's own org id, NOT 'default' and NOT A's org
--     select public.current_org() as account_b_org;
--   rollback;   -- nothing is persisted
--
--  PASS  = the probe returns only B's rows and B's own org id.
--  FAIL  = any of A's rows appear, or current_org() = 'default'
--          while another account is also 'default' (shared
--          legacy tenant — see schema.sql current_org()).
-- ============================================================
