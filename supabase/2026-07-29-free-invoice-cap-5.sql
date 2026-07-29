-- 2026-07-29 — Free-tier invoice cap drops from 20 to 5 per month, and the
-- cap is decided per ORGANISATION rather than per user.
--
-- Pricing moved: cloud is now included on Free, so the free tier is limited by
-- VOLUME rather than by where the data lives. The paid one-time plan (Freedom,
-- AED 499) lifts the cap and adds offline.
--
-- Mirrors src/lib/license.ts FREE_LIMITS.invoicesPerMonth — if the two numbers
-- disagree the client lets an invoice through and the server rejects it, which
-- surfaces as a save that fails for no visible reason.
--
-- TWO BUGS FIXED HERE, both invisible until someone owns more than one org:
--   1. The plan lookup was `where o.owner_id = new.user_id limit 1` with no
--      ORDER BY. A user owning both a paid and a free org got whichever row
--      Postgres happened to return — the paid plan applied at random.
--   2. The usage count was `where user_id = new.user_id`, pooling every org
--      that user owns into one allowance, so invoices raised for one company
--      ate the free quota of another.
-- An invoice belongs to an organisation, so the organisation's plan decides
-- and the organisation's own invoices are what count. Falls back to the
-- owner-org lookup only when a row carries no org_id.
--
-- Still gated by platform_config.licensing_enforced: enforcement only applies
-- when that flag is 'true'.

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

  select o.plan, o.plan_status
    into v_plan, v_status
  from public.organizations o
  where o.id::text = v_org;

  -- Any paid plan with a live/grace status → no cap (matches resolveTier).
  if v_plan is not null and v_plan <> 'free'
     and v_status in ('active', 'trialing', 'past_due') then
    return new;
  end if;

  select count(*) into v_count
  from public.invoice_docs
  where org_id = v_org
    and created_at >= date_trunc('month', now());

  if v_count >= 5 then
    raise exception 'Free plan limit reached (5 invoices this month). Upgrade to Filey Freedom (one-time) or Pro in Settings → Billing.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_docs_free_cap on public.invoice_docs;
create trigger invoice_docs_free_cap
  before insert on public.invoice_docs
  for each row execute function public.enforce_free_invoice_cap();
