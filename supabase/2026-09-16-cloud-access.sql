-- Cloud is the paid plan now.
--
-- The model this enforces:
--   • no plan      → local only, 5 invoices a month (the client caps locally;
--                    the cloud simply refuses their writes)
--   • Cloud $5/mo  → full cloud: sync, unlimited hosted invoices
--   • Freedom      → full local: unlimited, offline, verified without a network
--
-- Two safety rails, both deliberate:
--
--   1. SELECT is never gated. Someone who stops paying keeps reading — and
--      exporting — every row they already created. Their books are not
--      hostage; only new cloud writes stop.
--   2. The whole gate is behind platform_config.licensing_enforced, the same
--      switch the invoice cap already uses. Until that reads 'true' this
--      migration changes nothing at all, so it can ship well before the day
--      you decide to charge.
--
-- Everyone already using the cloud is grandfathered. They signed up when cloud
-- was free, and taking it away from a working business to sell them a paid
-- plan is not a trade worth making.

begin;

alter table public.organizations
  add column if not exists cloud_grandfathered boolean not null default false;

-- Every organisation that exists today keeps free cloud forever. New orgs
-- created after this migration default to false and fall under the new rules.
update public.organizations set cloud_grandfathered = true where cloud_grandfathered = false;

-- SECURITY: billing columns are webhook-only (see billing-columns-lockdown.sql).
-- A member who could set this flag would grant themselves the paid plan.
revoke update (cloud_grandfathered) on public.organizations from authenticated, anon;

/* ---------------- who may write to the cloud ---------------- */

create or replace function public.filey_cloud_access() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select
    -- Kill switch: unenforced means the old behaviour, exactly.
    coalesce((select value from public.platform_config where key = 'licensing_enforced'), '')
      is distinct from 'true'
    or exists (
      select 1
      from public.organizations o
      where o.id::text = public.current_org()
        and (
          o.cloud_grandfathered
          -- Same test as resolveTier() in the app: any plan other than free,
          -- with a live or grace status. past_due stays in so a failed $5
          -- renewal does not lock a business out mid-retry.
          or (o.plan is not null and o.plan <> 'free'
              and o.plan_status in ('active', 'trialing', 'past_due'))
        )
    )
$$;

revoke all on function public.filey_cloud_access() from public, anon;
grant execute on function public.filey_cloud_access() to authenticated;

/* ---------------- the gate itself ---------------- */
-- Restrictive, so it intersects the existing org/ownership policies rather
-- than widening anything: a row still has to pass every other policy first.

do $$
declare
  t text;
  tables text[] := array[
    'products','orders','order_items','stock_movements',
    'invoice_docs','invoice_doc_items','invoice_payments','invoice_recurrence',
    'quotations','quotation_items','quotation_templates',
    'purchase_orders','purchase_order_items','po_payments','payment_receipts',
    'suppliers','crm_customers','crm_leads','crm_people','crm_opportunities',
    'crm_activities','crm_notes','crm_tasks','follow_ups','entity_links',
    'employees','attendance','payroll','advances',
    'accounts','expenses','transactions',
    'work_items','campaigns','email_optouts',
    'user_files','user_folders','user_assets',
    'org_channels','org_messages','email_messages','call_logs','tool_runs'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists filey_cloud_insert on public.%I', t);
    execute format('drop policy if exists filey_cloud_update on public.%I', t);
    execute format('drop policy if exists filey_cloud_delete on public.%I', t);
    execute format(
      'create policy filey_cloud_insert on public.%I as restrictive for insert to authenticated '
      || 'with check (public.filey_cloud_access())', t);
    execute format(
      'create policy filey_cloud_update on public.%I as restrictive for update to authenticated '
      || 'using (public.filey_cloud_access()) with check (public.filey_cloud_access())', t);
    execute format(
      'create policy filey_cloud_delete on public.%I as restrictive for delete to authenticated '
      || 'using (public.filey_cloud_access())', t);
  end loop;
end $$;

/* ---------------- the invoice cap follows the same rule ---------------- */
-- A grandfathered org keeps FULL cloud, not capped cloud: it was uncapped in
-- practice before this change and dropping someone to 5 invoices a month is
-- the same broken promise as cutting them off. Recreated rather than altered
-- so the whole rule is readable in one place.

create or replace function public.enforce_free_invoice_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enforced text;
  v_org text;
  v_plan text;
  v_status text;
  v_grandfathered boolean;
  v_count int;
begin
  select value into v_enforced
  from public.platform_config
  where key = 'licensing_enforced';
  if v_enforced is distinct from 'true' then
    return new;
  end if;

  -- The organisation this invoice belongs to; older rows may not carry one,
  -- in which case fall back to the oldest org this user owns (deterministic).
  v_org := new.org_id;
  if v_org is null or v_org = '' then
    select o.id::text into v_org
    from public.organizations o
    where o.owner_id = new.user_id
    order by o.created_at, o.id
    limit 1;
  end if;

  select o.plan, o.plan_status, o.cloud_grandfathered
    into v_plan, v_status, v_grandfathered
  from public.organizations o
  where o.id::text = v_org;

  -- Any paid plan with a live/grace status → no cap (matches resolveTier).
  if v_plan is not null and v_plan <> 'free'
     and v_status in ('active', 'trialing', 'past_due') then
    return new;
  end if;

  -- Grandfathered from the era when cloud was free and uncapped.
  if coalesce(v_grandfathered, false) then
    return new;
  end if;

  select count(*) into v_count
  from public.invoice_docs
  where org_id = v_org
    and created_at >= date_trunc('month', now());

  if v_count >= 5 then
    raise exception 'Free plan limit reached (5 invoices this month). Filey Cloud is $5/month, or buy Freedom once for unlimited local use.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_docs_free_cap on public.invoice_docs;
create trigger invoice_docs_free_cap
  before insert on public.invoice_docs
  for each row execute function public.enforce_free_invoice_cap();

commit;
