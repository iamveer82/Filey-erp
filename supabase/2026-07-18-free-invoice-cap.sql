-- 2026-07-18 — Server-side free-tier invoice cap (20 invoices/month).
--
-- Mirrors the client check (src/lib/license.ts checkFreeInvoiceCap) so the
-- cap cannot be bypassed by calling the PostgREST API directly in cloud mode.
-- Local/offline mode stays client-enforced by design (the paid Offline plan
-- is the intended upgrade path there).
--
-- The trigger is gated by a platform_config flag so this migration can be
-- deployed any time; enforcement starts only when flipped:
--     update public.platform_config set value = 'true' where key = 'licensing_enforced';
--
-- IMPORTANT (launch runbook): before flipping, exempt the platform owner's
-- own org so the real company account is never capped:
--     update public.organizations set plan = 'enterprise', plan_status = 'active'
--     where owner_id = '<owner-auth-user-uuid>';

create table if not exists public.platform_config (
  key text primary key,
  value text not null default ''
);

insert into public.platform_config (key, value)
values ('licensing_enforced', 'false')
on conflict (key) do nothing;

-- Locked down from clients entirely; only security-definer functions read it.
alter table public.platform_config enable row level security;

create or replace function public.enforce_free_invoice_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enforced text;
  v_plan text;
  v_status text;
  v_count int;
begin
  select value into v_enforced
  from public.platform_config
  where key = 'licensing_enforced';
  if v_enforced is distinct from 'true' then
    return new;
  end if;

  -- The inserting user's own org (owner-provisioned personal org).
  select o.plan, o.plan_status
    into v_plan, v_status
  from public.organizations o
  where o.owner_id = new.user_id
  limit 1;

  -- Any paid plan with a live/grace status → no cap (matches resolveTier).
  if v_plan is not null and v_plan <> 'free'
     and v_status in ('active', 'trialing', 'past_due') then
    return new;
  end if;

  select count(*) into v_count
  from public.invoice_docs
  where user_id = new.user_id
    and created_at >= date_trunc('month', now());

  if v_count >= 20 then
    raise exception 'Free plan limit reached (20 invoices this month). Upgrade to Filey Offline (one-time) or Pro in Settings → Billing.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_docs_free_cap on public.invoice_docs;
create trigger invoice_docs_free_cap
  before insert on public.invoice_docs
  for each row execute function public.enforce_free_invoice_cap();
