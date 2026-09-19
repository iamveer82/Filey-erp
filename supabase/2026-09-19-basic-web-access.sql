-- Basic includes the web. Authentication, organization/record permissions and
-- existing service limits still apply. Only NEW invoices use the monthly cap.
begin;

create or replace function public.filey_cloud_access() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.organizations o where o.id::text = public.current_org()
  )
$$;
revoke all on function public.filey_cloud_access() from public, anon;
grant execute on function public.filey_cloud_access() to authenticated;

-- One counter per workspace/month. Atomic increments close the concurrent
-- insert race; deleting/backdating an invoice cannot buy another creation.
create table if not exists public.invoice_monthly_usage (
  org_id uuid not null references public.organizations(id) on delete cascade,
  month date not null,
  used integer not null default 0 check (used >= 0),
  primary key (org_id, month)
);
alter table public.invoice_monthly_usage enable row level security;
revoke all on public.invoice_monthly_usage from public, anon, authenticated;

-- Initialize usage from existing invoices without changing those invoices.
-- Reapplying the migration must never reset a counter.
lock table public.invoice_docs in share row exclusive mode;
insert into public.invoice_monthly_usage(org_id, month, used)
select d.org_id::uuid, date_trunc('month', now() at time zone 'UTC')::date, count(*)::integer
from public.invoice_docs d join public.organizations o on o.id::text = d.org_id
where d.created_at >= (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')
group by d.org_id
on conflict (org_id, month) do nothing;

create or replace function public.filey_invoice_usage() returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select used from public.invoice_monthly_usage
    where org_id = public.current_org()::uuid and auth.uid() is not null
      and month = date_trunc('month', now() at time zone 'UTC')::date), 0)
$$;
revoke all on function public.filey_invoice_usage() from public, anon;
grant execute on function public.filey_invoice_usage() to authenticated;

create or replace function public.enforce_free_invoice_cap() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org text := new.org_id;
  v_count integer;
  v_unlimited boolean;
begin
  if tg_op <> 'INSERT' then return new; end if;
  if v_org is null or v_org = '' then
    select id::text into v_org from public.organizations
    where owner_id = new.user_id order by created_at, id limit 1;
  end if;
  if v_org is null then raise exception 'An invoice requires a workspace'; end if;

  -- Runs AFTER INSERT: conflict-updates and ordinary edits never count.
  -- The increment rolls back with any rejected/failed transaction.
  insert into public.invoice_monthly_usage(org_id, month, used)
  values (v_org::uuid, date_trunc('month', now() at time zone 'UTC')::date, 1)
  on conflict (org_id, month) do update
    set used = invoice_monthly_usage.used + 1
  returning used into v_count;

  select cloud_grandfathered or
    (plan is not null and plan <> 'free' and plan_status in ('active','trialing','past_due'))
    or public.filey_org_owner_licensed(v_org)
  into v_unlimited from public.organizations where id::text = v_org;

  if (select value from public.platform_config where key = 'licensing_enforced') = 'true'
    and not coalesce(v_unlimited, false) and v_count > 5 then
    raise exception 'Basic plan limit reached (5 new invoices this month). Editing existing invoices is unlimited. Upgrade in Settings → Billing for unlimited invoices.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists invoice_docs_free_cap on public.invoice_docs;
create trigger invoice_docs_free_cap after insert on public.invoice_docs
  for each row execute function public.enforce_free_invoice_cap();
notify pgrst, 'reload schema';
commit;
