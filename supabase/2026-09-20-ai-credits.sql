-- Optional, account-owned AI credits. No plan checks and no local sync tables.
begin;
create table if not exists public.ai_credit_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance_micros bigint not null default 0,
  reserved_micros bigint not null default 0 check (reserved_micros >= 0),
  task_limit_micros bigint not null default 1000000 check (task_limit_micros between 10000 and 50000000),
  daily_limit_micros bigint not null default 5000000 check (daily_limit_micros between 10000 and 100000000),
  updated_at timestamptz not null default now()
);
create table if not exists public.ai_credit_orders (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  credits_micros bigint not null check (credits_micros > 0),
  payment_id text unique,
  paid_cents bigint,
  refunded_micros bigint not null default 0,
  disputed boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.ai_credit_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null,
  model text not null,
  state text not null check (state in ('reserved','settled','released')),
  reserved_micros bigint not null check (reserved_micros > 0),
  charged_micros bigint not null default 0 check (charged_micros >= 0),
  provider_cost_micros bigint,
  provider_id text,
  input_tokens bigint,
  output_tokens bigint,
  markup_bps integer not null,
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ai_credit_requests_user_date on public.ai_credit_requests(user_id, created_at desc);
create index if not exists ai_credit_requests_run on public.ai_credit_requests(user_id, run_id);
-- Safe to re-run after 2026-09-21-ai-video.sql (which also adds expires_at).
alter table public.ai_credit_requests add column if not exists expires_at timestamptz not null default now() + interval '10 minutes';
create index if not exists ai_credit_requests_expiry on public.ai_credit_requests(user_id, expires_at) where state = 'reserved';
create index if not exists ai_credit_orders_user on public.ai_credit_orders(user_id);
create table if not exists public.ai_credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null unique,
  kind text not null check (kind in ('topup','usage','refund')),
  amount_micros bigint not null,
  description text not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_credit_ledger_user_date on public.ai_credit_ledger(user_id, id desc);

alter table public.ai_credit_accounts enable row level security;
alter table public.ai_credit_orders enable row level security;
alter table public.ai_credit_requests enable row level security;
alter table public.ai_credit_ledger enable row level security;
revoke all on public.ai_credit_accounts, public.ai_credit_orders, public.ai_credit_requests, public.ai_credit_ledger from anon, authenticated;
grant select on public.ai_credit_accounts, public.ai_credit_ledger, public.ai_credit_requests to authenticated;
grant all on public.ai_credit_accounts, public.ai_credit_orders, public.ai_credit_requests, public.ai_credit_ledger to service_role;
grant usage, select on sequence public.ai_credit_ledger_id_seq to service_role;
drop policy if exists ai_credit_account_read on public.ai_credit_accounts;
create policy ai_credit_account_read on public.ai_credit_accounts for select to authenticated using (user_id = auth.uid());
drop policy if exists ai_credit_ledger_read on public.ai_credit_ledger;
create policy ai_credit_ledger_read on public.ai_credit_ledger for select to authenticated using (user_id = auth.uid());
drop policy if exists ai_credit_request_read on public.ai_credit_requests;
create policy ai_credit_request_read on public.ai_credit_requests for select to authenticated using (user_id = auth.uid());

-- All money changes serialize on the account row. Only a verified edge handler
-- can call this function; clients cannot grant credit, settle usage or edit money.
create or replace function public.filey_ai_wallet(p_action text, p_user uuid, p_args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.ai_credit_accounts%rowtype;
  r public.ai_credit_requests%rowtype;
  o public.ai_credit_orders%rowtype;
  amount bigint; released bigint; spent bigint; run_spent bigint;
  event_id text; request_id uuid; task_id uuid;
begin
  if p_user is null then raise exception 'Account required'; end if;
  insert into ai_credit_accounts(user_id) values(p_user) on conflict do nothing;
  select * into strict a from ai_credit_accounts where user_id = p_user for update;

  -- An interrupted edge worker must not lock funds forever. No uncertain usage
  -- is charged to the customer; Filey absorbs it. Chat holds last 10 minutes;
  -- accepted asynchronous video jobs extend their hold to 24 hours via expires_at.
  -- Uses expires_at (same as 2026-09-21-ai-video.sql) so re-running either file
  -- keeps one expiry rule and never reverts video holds to created_at.
  with expired as (
    update ai_credit_requests set state='released', finished_at=now()
    where user_id=p_user and state='reserved' and expires_at < now()
    returning reserved_micros
  ) select coalesce(sum(reserved_micros),0) into released from expired;
  a.reserved_micros := a.reserved_micros - released;

  if p_action = 'limits' then
    a.task_limit_micros := (p_args->>'task_limit_micros')::bigint;
    a.daily_limit_micros := (p_args->>'daily_limit_micros')::bigint;
    if a.task_limit_micros is null or a.daily_limit_micros is null then raise exception 'Both limits are required'; end if;
  elsif p_action = 'reserve' then
    request_id := (p_args->>'request_id')::uuid;
    task_id := (p_args->>'run_id')::uuid;
    amount := (p_args->>'amount_micros')::bigint;
    if amount is null or amount < 1 or amount > 50000000 or task_id is null or request_id is null
      or coalesce(length(p_args->>'model'),0) not between 1 and 200
      or (p_args->>'markup_bps')::integer not between 0 and 10000 then raise exception 'Invalid AI reservation'; end if;
    if exists(select 1 from ai_credit_requests where id=request_id) then raise exception 'This request was already submitted. Refresh your balance before retrying.'; end if;
    if exists(select 1 from ai_credit_orders where user_id=p_user and disputed) then raise exception 'AI credits are paused while a payment dispute is reviewed.'; end if;
    if (select count(*) from ai_credit_requests where user_id=p_user and created_at>now()-interval '1 minute') >= 30 then raise exception 'AI request limit reached. Wait a minute.'; end if;
    if a.balance_micros-a.reserved_micros < amount then raise exception 'Not enough available AI credits for this request. Add credits or lower the output limit.'; end if;
    select coalesce(sum(charged_micros),0) into spent from ai_credit_requests
      where user_id=p_user and created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
    select coalesce(sum(charged_micros+case when state='reserved' then reserved_micros else 0 end),0) into run_spent
      from ai_credit_requests where user_id=p_user and run_id=task_id;
    if spent+a.reserved_micros+amount > a.daily_limit_micros then raise exception 'Daily AI spending limit reached. Adjust it in AI Credits.'; end if;
    if run_spent+amount > a.task_limit_micros then raise exception 'Task spending limit reached. Adjust it in AI Credits or reduce the task.'; end if;
    insert into ai_credit_requests(id,user_id,run_id,model,state,reserved_micros,markup_bps,expires_at)
      values(request_id,p_user,task_id,p_args->>'model','reserved',amount,(p_args->>'markup_bps')::integer, now() + interval '10 minutes');
    a.reserved_micros := a.reserved_micros+amount;
  elsif p_action in ('settle','release') then
    select * into strict r from ai_credit_requests where id=(p_args->>'request_id')::uuid and user_id=p_user for update;
    if r.state='reserved' then
      amount := case when p_action='release' then 0 else (p_args->>'charged_micros')::bigint end;
      if amount is null or amount<0 then raise exception 'Invalid usage charge'; end if;
      -- Never charge beyond the approved reservation, even if a provider's
      -- tokenizer/pricing changes. The merchant absorbs any excess.
      amount := least(amount,r.reserved_micros);
      update ai_credit_requests set state=case when p_action='release' then 'released' else 'settled' end,
        charged_micros=amount, provider_cost_micros=(p_args->>'provider_cost_micros')::bigint,
        provider_id=left(p_args->>'provider_id',200), input_tokens=(p_args->>'input_tokens')::bigint,
        output_tokens=(p_args->>'output_tokens')::bigint, finished_at=now() where id=r.id;
      if p_action='settle' then
        insert into ai_credit_ledger(user_id,event_key,kind,amount_micros,description)
          values(p_user,'usage:'||r.id,'usage',-amount,r.model);
      end if;
      a.balance_micros := a.balance_micros-amount;
      a.reserved_micros := a.reserved_micros-r.reserved_micros;
    end if;
  elsif p_action in ('topup','refund','dispute','resolve_dispute') then
    select * into strict o from ai_credit_orders where id=(p_args->>'order_id')::uuid and user_id=p_user for update;
    if p_action='topup' then
      if o.payment_id is null then
        if coalesce(p_args->>'payment_id','')='' or coalesce((p_args->>'paid_cents')::bigint,0)<=0 then raise exception 'Invalid payment'; end if;
        update ai_credit_orders set payment_id=p_args->>'payment_id',paid_cents=(p_args->>'paid_cents')::bigint where id=o.id;
        insert into ai_credit_ledger(user_id,event_key,kind,amount_micros,description)
          values(p_user,'payment:'||(p_args->>'payment_id'),'topup',o.credits_micros,'AI credit top-up');
        a.balance_micros := a.balance_micros+o.credits_micros;
      elsif o.payment_id <> p_args->>'payment_id' then raise exception 'Payment does not match this top-up'; end if;
    elsif p_action='refund' then
      if o.payment_id is null then raise exception 'Payment must be reconciled before its refund'; end if;
      event_id := 'refund:'||(p_args->>'refund_id');
      if event_id is null or length(event_id)<9 then raise exception 'Refund ID required'; end if;
      if not exists(select 1 from ai_credit_ledger where event_key=event_id) then
        if coalesce((p_args->>'refund_cents')::bigint,0)<=0 then raise exception 'Invalid refund amount'; end if;
        amount := least(o.credits_micros-o.refunded_micros,ceil(o.credits_micros::numeric*(p_args->>'refund_cents')::bigint/o.paid_cents)::bigint);
        insert into ai_credit_ledger(user_id,event_key,kind,amount_micros,description)
          values(p_user,event_id,'refund',-amount,'AI credit refund');
        update ai_credit_orders set refunded_micros=refunded_micros+amount where id=o.id;
        a.balance_micros := a.balance_micros-amount;
      end if;
    else
      update ai_credit_orders set disputed=(p_action='dispute') where id=o.id;
    end if;
  elsif p_action <> 'status' then raise exception 'Unknown wallet action'; end if;

  if p_action <> 'status' or released > 0 then
  update ai_credit_accounts set balance_micros=a.balance_micros, reserved_micros=a.reserved_micros,
    task_limit_micros=a.task_limit_micros,daily_limit_micros=a.daily_limit_micros,updated_at=now() where user_id=p_user;
  end if;
  return to_jsonb(a)||jsonb_build_object('available_micros',a.balance_micros-a.reserved_micros,
    'blocked',exists(select 1 from ai_credit_orders where user_id=p_user and disputed));
end;
$$;
revoke all on function public.filey_ai_wallet(text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.filey_ai_wallet(text,uuid,jsonb) to service_role;
commit;
