-- Ultra includes Filey on the web.
--
-- Filey on the web (app.gofiley.com) is a cloud workspace, so whoever may use
-- it must be allowed to save to the cloud and must not meet the Basic invoice
-- cap there. Until now only a paid org plan (Pro) or a grandfathered org
-- could. This adds the third door: the org's OWNER holds an active Ultra
-- licence. Org-level on purpose, like Pro — the owner's team works in the
-- same workspace and would otherwise be read-only in it.
--
-- Mirrors: resolveCloudAccess()/cloudAccess() in src/lib/license.ts (the
-- client asks filey_cloud_access() itself when its own read says no).
--
-- Rollback: re-run supabase/2026-09-16-cloud-access.sql.

begin;

create or replace function public.filey_org_owner_licensed(p_org text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.organizations o
    join public.licenses l on l.user_id = o.owner_id
    where o.id::text = p_org
      and l.status = 'active'
  )
$$;

revoke all on function public.filey_org_owner_licensed(text) from public, anon;
grant execute on function public.filey_org_owner_licensed(text) to authenticated;

create or replace function public.filey_cloud_access() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select
    coalesce((select value from public.platform_config where key = 'licensing_enforced'), '')
      is distinct from 'true'
    or exists (
      select 1
      from public.organizations o
      where o.id::text = public.current_org()
        and (
          o.cloud_grandfathered
          or (o.plan is not null and o.plan <> 'free'
              and o.plan_status in ('active', 'trialing', 'past_due'))
        )
    )
    -- Ultra: the workspace owner bought the licence.
    or public.filey_org_owner_licensed(public.current_org())
$$;

revoke all on function public.filey_cloud_access() from public, anon;
grant execute on function public.filey_cloud_access() to authenticated;

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

  -- Pro: any paid plan with a live/grace status (matches resolveTier).
  if v_plan is not null and v_plan <> 'free'
     and v_status in ('active', 'trialing', 'past_due') then
    return new;
  end if;

  if coalesce(v_grandfathered, false) then
    return new;
  end if;

  -- Ultra: unlimited invoicing wherever the owner works, the web included.
  if public.filey_org_owner_licensed(v_org) then
    return new;
  end if;

  select count(*) into v_count
  from public.invoice_docs
  where org_id = v_org
    and created_at >= date_trunc('month', now());

  if v_count >= 5 then
    raise exception 'Basic plan limit reached (5 invoices this month). Pro is $5/month, or buy Ultra once for unlimited invoicing.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

commit;
