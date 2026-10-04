-- One explicitly authorized, selected-account test checkout. No public coupon
-- input or synthetic cash receipt can authorize a zero-paid Coin grant.
begin;
alter table public.ai_credit_orders
  add column if not exists promotion_id uuid,
  add column if not exists promotion_discount_id text,
  add column if not exists promotion_discount_code text,
  add column if not exists promotion_customer_id text,
  add column if not exists promotion_email text,
  add column if not exists promotion_expires_at timestamptz,
  add column if not exists expected_paid_cents bigint,
  add column if not exists checkout_session_id text;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.ai_credit_orders'::regclass and conname='ai_credit_promotion_binding') then
    alter table public.ai_credit_orders add constraint ai_credit_promotion_binding check (
      (promotion_id is null and promotion_discount_id is null and promotion_discount_code is null
        and promotion_customer_id is null and promotion_email is null and promotion_expires_at is null and expected_paid_cents is null)
      or (promotion_id is not null and promotion_discount_id is not null and promotion_discount_code is not null
        and promotion_customer_id is not null and promotion_email is not null and promotion_expires_at is not null
        and expected_paid_cents is not null and expected_paid_cents=0 and credits_micros=5000000 and service_fee_cents=50
        and length(promotion_discount_id) between 2 and 200 and promotion_discount_id !~ '[^A-Za-z0-9_-]'
        and length(promotion_customer_id) between 2 and 200 and promotion_customer_id !~ '[^A-Za-z0-9_-]'
        and length(promotion_discount_code) between 3 and 16 and promotion_discount_code !~ '[^A-Z0-9_-]'
        and length(promotion_email) between 3 and 254 and position('@' in promotion_email)>1
        and promotion_email !~ '[[:space:]]' and isfinite(promotion_expires_at)));
  end if;
end $$;
-- Insertion reserves this one-use offer, including concurrent/opened sessions.
create unique index if not exists ai_credit_promotion_once on public.ai_credit_orders(promotion_id) where promotion_id is not null;
create unique index if not exists ai_credit_promotion_discount_once on public.ai_credit_orders(promotion_discount_id) where promotion_id is not null;
revoke all on public.ai_credit_orders from public, anon, authenticated;
grant all on public.ai_credit_orders to service_role;

create or replace function public.filey_ai_wallet(p_action text, p_user uuid, p_args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.ai_credit_accounts%rowtype;
  r public.ai_credit_requests%rowtype;
  o public.ai_credit_orders%rowtype;
  amount bigint; released bigint;
  event_id text; request_id uuid; task_id uuid;
  dispute_at timestamptz;
  payment_at timestamptz;
  payment_args jsonb; payment_refund jsonb;
begin
  if p_user is null then raise exception 'Account required'; end if;
  insert into ai_credit_accounts(user_id) values(p_user) on conflict do nothing;
  select * into strict a from ai_credit_accounts where user_id = p_user for update;

  if p_action='reconcile_payment' then
    if jsonb_typeof(p_args->'refunds') is distinct from 'array'
      or coalesce(p_args->>'dispute_action','') not in ('','dispute','resolve_dispute') then
      raise exception 'Invalid payment reconciliation';
    end if;
    payment_args := jsonb_build_object('order_id',p_args->'order_id',
      'event_type',p_args->'event_type','event_at',p_args->'event_at');
    -- Nested calls share this transaction and reentrant account lock. Return
    -- before the outer expiry CTE so only the nested calls update hold expiry.
    if p_args->>'dispute_action'='dispute' then
      perform public.filey_ai_wallet('dispute',p_user,payment_args);
    end if;
    perform public.filey_ai_wallet('topup',p_user,jsonb_build_object(
      'order_id',p_args->'order_id','payment_id',p_args->'payment_id','paid_cents',p_args->'paid_cents',
      'payment_event_type',p_args->'event_type','payment_event_at',p_args->'event_at'));
    for payment_refund in select value from jsonb_array_elements(p_args->'refunds') loop
      if jsonb_typeof(payment_refund) is distinct from 'object' then
        raise exception 'Invalid payment refund';
      end if;
      perform public.filey_ai_wallet('refund',p_user,jsonb_build_object('order_id',p_args->'order_id',
        'refund_id',payment_refund->'refund_id','refund_cents',payment_refund->'refund_cents'));
    end loop;
    if p_args->>'dispute_action'='resolve_dispute' then
      perform public.filey_ai_wallet('resolve_dispute',p_user,payment_args);
    end if;
    return public.filey_ai_wallet('status',p_user);
  end if;

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
        if coalesce(btrim(p_args->>'payment_id'),'')='' or (p_args->>'paid_cents') is null or (p_args->>'paid_cents')::bigint<0 then raise exception 'Invalid payment'; end if;
        if o.promotion_id is not null then
          if o.expected_paid_cents is distinct from 0 or (p_args->>'paid_cents')::bigint<>0
            or o.promotion_discount_id is null or o.promotion_customer_id is null or o.promotion_email is null
            or o.promotion_discount_code is null or o.promotion_expires_at is null or coalesce(o.checkout_session_id,'')=''
            or o.credits_micros<>5000000 or o.service_fee_cents<>50 then raise exception 'Invalid promotional payment'; end if;
          payment_at := (p_args->>'payment_event_at')::timestamptz;
          if p_args->>'payment_event_type' is distinct from 'payment.succeeded' or payment_at is null
            or not isfinite(payment_at) or payment_at>o.promotion_expires_at then raise exception 'Invalid promotional payment'; end if;
        elsif (p_args->>'paid_cents')::bigint<=0 then raise exception 'Invalid payment'; end if;
        update ai_credit_orders set payment_id=p_args->>'payment_id',paid_cents=(p_args->>'paid_cents')::bigint where id=o.id;
        insert into ai_credit_ledger(user_id,event_key,kind,amount_micros,description)
          values(p_user,'payment:'||(p_args->>'payment_id'),'topup',o.credits_micros,'AI credit top-up');
        a.balance_micros := a.balance_micros+o.credits_micros;
      elsif o.payment_id <> p_args->>'payment_id' or o.paid_cents is distinct from (p_args->>'paid_cents')::bigint then raise exception 'Payment does not match this top-up'; end if;
    elsif p_action='refund' then
      if o.payment_id is null then raise exception 'Payment must be reconciled before its refund'; end if;
      event_id := 'refund:'||(p_args->>'refund_id');
      if event_id is null or length(event_id)<9 then raise exception 'Refund ID required'; end if;
      if not exists(select 1 from ai_credit_ledger where event_key=event_id) then
        if coalesce((p_args->>'refund_cents')::bigint,0)<=0 or coalesce(o.paid_cents,0)<=0 then raise exception 'Invalid refund amount'; end if;
        amount := least(o.credits_micros-o.refunded_micros,ceil(o.credits_micros::numeric*(p_args->>'refund_cents')::bigint/o.paid_cents)::bigint);
        insert into ai_credit_ledger(user_id,event_key,kind,amount_micros,description)
          values(p_user,event_id,'refund',-amount,'AI credit refund');
        update ai_credit_orders set refunded_micros=refunded_micros+amount where id=o.id;
        a.balance_micros := a.balance_micros-amount;
      end if;
    else
      dispute_at := (p_args->>'event_at')::timestamptz;
      if dispute_at is null or not isfinite(dispute_at) then
        raise exception 'Credit dispute event timestamp required';
      end if;
      if p_action='resolve_dispute' and p_args->>'event_type' is distinct from 'dispute.won' then
        raise exception 'A verified won dispute event is required';
      end if;
      -- A delayed snapshot cannot reopen disputed spending. At the same
      -- timestamp, blocking wins regardless of concurrent delivery order.
      if o.dispute_event_at is null or dispute_at > o.dispute_event_at
        or (dispute_at = o.dispute_event_at and p_action='dispute') then
        update ai_credit_orders set disputed=(p_action='dispute'),
          dispute_event_at=dispute_at where id=o.id;
      end if;
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

