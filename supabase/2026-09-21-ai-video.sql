-- Account-owned video jobs; no customer/workspace records or local sync changes.
begin;
alter table public.ai_credit_requests add column if not exists expires_at timestamptz not null default now() + interval '10 minutes';
create index if not exists ai_credit_requests_expiry on public.ai_credit_requests(user_id,expires_at) where state='reserved';

create table if not exists public.ai_video_jobs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  state text not null default 'draft' check (state in ('draft','submitting','uncertain','queued','in_progress','completed','failed','nsfw','canceled')),
  model text not null,
  params jsonb not null,
  duration integer not null check (duration between 4 and 15),
  charge_micros bigint not null check (charge_micros = duration * 250000),
  charged_micros bigint not null default 0 check (charged_micros between 0 and charge_micros),
  provider_quote_micros bigint not null check (provider_quote_micros between 0 and charge_micros),
  provider_request_id uuid unique,
  callback_token text not null check (length(callback_token) = 64),
  quote_expires_at timestamptz not null default now() + interval '10 minutes',
  output_url text,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  last_checked_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists ai_video_jobs_user_date on public.ai_video_jobs(user_id,created_at desc);
alter table public.ai_video_jobs enable row level security;
-- All reads go through the handler's public field list: callback tokens stay private.
revoke all on public.ai_video_jobs from public, anon, authenticated;
grant all on public.ai_video_jobs to service_role;

create or replace function public.filey_ai_video(p_action text, p_user uuid, p_id uuid, p_args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j public.ai_video_jobs%rowtype;
  claimed boolean := false;
  charge bigint;
begin
  if p_action='list' then
    return jsonb_build_object('jobs',coalesce((select jsonb_agg(recent) from (
      select * from ai_video_jobs where user_id=p_user
      order by (state in ('submitting','uncertain','queued','in_progress') and started_at>now()-interval '24 hours') desc nulls last,created_at desc limit 30
    ) recent),'[]'::jsonb));
  end if;
  select * into strict j from ai_video_jobs where id=p_id and user_id=p_user for update;
  if p_action = 'start' then
    if j.state = 'draft' then
      if j.quote_expires_at <= now() then raise exception 'This quote expired. Request a new quote.'; end if;
      if coalesce((p_args->>'charge_micros')::bigint,-1) <> j.charge_micros then raise exception 'The video price changed. Review a new quote.'; end if;
      perform filey_ai_wallet('reserve', p_user, jsonb_build_object('request_id',j.id,'run_id',j.id,'model','Video · Seedance 2.0 · '||j.duration||'s','amount_micros',j.charge_micros,'markup_bps',0));
      if (select count(*) from ai_video_jobs where user_id=p_user and started_at > now()-interval '24 hours' and state in ('submitting','uncertain','queued','in_progress')) >= 3 then raise exception 'Wait for a running video to finish before starting another.'; end if;
      update ai_credit_requests set expires_at=now()+interval '24 hours' where id=j.id;
      j.state := 'submitting'; j.started_at := now(); j.error := null;
      claimed := true;
    end if;
  elsif p_action = 'accepted' then
    if j.provider_request_id is not null and j.provider_request_id <> (p_args->>'request_id')::uuid then raise exception 'Provider request does not match'; end if;
    if j.state in ('submitting','uncertain','queued','in_progress') then
      j.provider_request_id := (p_args->>'request_id')::uuid;
      if j.provider_request_id is null then raise exception 'Provider request required'; end if;
      if j.state in ('submitting','uncertain') then j.state := 'queued'; end if;
      j.error := null;
    end if;
  elsif p_action = 'uncertain' then
    if j.state='submitting' then
      j.state := 'uncertain';
      j.error := 'The provider has not confirmed submission. Do not submit a replacement yet. Filey will reconcile this job; unconfirmed holds expire after 24 hours.';
    end if;
  elsif p_action = 'poll' then
    if j.state in ('submitting','uncertain','queued','in_progress') and (j.last_checked_at is null or j.last_checked_at < now()-interval '15 seconds') then
      j.last_checked_at := now(); claimed := true;
    end if;
  elsif p_action = 'finish' then
    if j.state in ('submitting','uncertain','queued','in_progress') then
      if p_args->>'state' not in ('completed','failed','nsfw','canceled','in_progress','queued') then raise exception 'Invalid video state'; end if;
      -- A hold lasts at most 24 hours. Late success is absorbed by Filey,
      -- never charged after the customer's money has been released.
      if j.started_at < now()-interval '24 hours' then
        perform filey_ai_wallet('release', p_user, jsonb_build_object('request_id',j.id));
      end if;
      if p_args->>'state' = 'completed' then
        if coalesce(p_args->>'output_url','') !~ '^https://' then raise exception 'Video output required'; end if;
        perform filey_ai_wallet('settle', p_user, jsonb_build_object('request_id',j.id,'charged_micros',j.charge_micros,'provider_id',j.provider_request_id));
        select charged_micros into charge from ai_credit_requests where id=j.id;
        j.charged_micros := charge;
        j.output_url := p_args->>'output_url';
      elsif p_args->>'state' in ('failed','nsfw','canceled') then
        perform filey_ai_wallet('release', p_user, jsonb_build_object('request_id',j.id));
      end if;
      j.state := p_args->>'state'; j.error := left(p_args->>'error',500);
    end if;
  elsif p_action = 'discard' then
    if j.state='draft' then j.state := 'canceled'; end if;
  else raise exception 'Unknown video action';
  end if;
  update ai_video_jobs set state=j.state, provider_request_id=j.provider_request_id,
    charged_micros=j.charged_micros,output_url=j.output_url,error=j.error,
    started_at=j.started_at,last_checked_at=j.last_checked_at,updated_at=now() where id=j.id returning * into j;
  return jsonb_build_object('job',to_jsonb(j),'claimed',claimed);
end;
$$;
revoke all on function public.filey_ai_video(text,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.filey_ai_video(text,uuid,uuid,jsonb) to service_role;

-- WALLET_FUNCTION is appended below from the currently deployed definition.

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
  -- accepted asynchronous video jobs explicitly extend their hold to 24 hours.
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
    insert into ai_credit_requests(id,user_id,run_id,model,state,reserved_micros,markup_bps)
      values(request_id,p_user,task_id,p_args->>'model','reserved',amount,(p_args->>'markup_bps')::integer);
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
