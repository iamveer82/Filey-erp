-- RLS performance: evaluate auth.uid() / current_org() / is_org_admin() ONCE
-- per query instead of once per row.
--
-- Postgres re-evaluates a bare function call in a USING clause for every row it
-- scans. Wrapping the call in a scalar subquery — (select auth.uid()) — lets the
-- planner hoist it into an InitPlan that runs a single time. This is Supabase's
-- documented first recommendation for RLS performance and the difference grows
-- with table size: on a list query touching thousands of rows it is the
-- dominant cost, because current_org() and is_org_admin() are SECURITY DEFINER
-- functions that each run their own query.
--
-- The PREDICATES ARE UNCHANGED. Every policy below is the same expression as
-- the one it replaces, with the three function calls parenthesised. Read this
-- diff against the matching block in schema.sql — nothing about who can see
-- what should differ, and the cross-tenant guards (org_id must match
-- current_org on any branch that is not the caller's own row) are preserved
-- exactly.

do $$
declare
  t text;
  tables text[] := array[
    'products','orders','order_items',
    'employees','attendance','payroll',
    'accounts','expenses','transactions',
    'app_users','app_settings','audit_log',
    'crm_leads','crm_customers','crm_opportunities','crm_activities',
    'company_profile','invoice_docs','invoice_doc_items','invoice_payments',
    'quotations','quotation_items','quotation_templates','tool_runs',
    'suppliers','purchase_orders','purchase_order_items','stock_movements',
    'advances','po_payments','payment_receipts'
  ];
  org_only text[] := array[
    'company_profile','app_settings','audit_log','app_users'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on %I;', t || '_org', t);
    execute format('drop policy if exists %I on %I;', t || '_access', t);

    if t = any(org_only) then
      execute format(
        'create policy %I on %I for all '
        || 'using (org_id = (select public.current_org())) '
        || 'with check (org_id = (select public.current_org()));',
        t || '_org', t
      );
    else
      execute format(
        'create policy %I on %I for all '
        || 'using (user_id = (select auth.uid()) '
        || 'or (org_id = (select public.current_org()) '
        || 'and ((select public.is_org_admin()) or shared = true))) '
        || 'with check (user_id = (select auth.uid()) '
        || 'or (org_id = (select public.current_org()) and (select public.is_org_admin())));',
        t || '_access', t
      );
    end if;
  end loop;
end $$;

-- ---------- hand-written policies ----------

drop policy if exists org_members_select on org_members;
create policy org_members_select on org_members for select
  using (org_id = (select public.current_org()) or user_id = (select auth.uid()));

drop policy if exists org_members_self_leave on org_members;
create policy org_members_self_leave on org_members for delete
  using (user_id = (select auth.uid()));

drop policy if exists org_members_create_own on org_members;
create policy org_members_create_own on org_members for insert
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.organizations o
      where o.id::text = org_members.org_id
        and o.owner_id = (select auth.uid())
    )
  );

drop policy if exists org_members_admin on org_members;
create policy org_members_admin on org_members for all
  using (org_id = (select public.current_org()) and (select public.is_org_admin()))
  with check (org_id = (select public.current_org()) and (select public.is_org_admin()));

drop policy if exists profiles_org_read on profiles;
create policy profiles_org_read on profiles for select
  using (org_id = (select public.current_org()));

drop policy if exists invitations_admin on invitations;
create policy invitations_admin on invitations for all
  using (org_id = (select public.current_org()) and (select public.is_org_admin()))
  with check (org_id = (select public.current_org()) and (select public.is_org_admin()));
