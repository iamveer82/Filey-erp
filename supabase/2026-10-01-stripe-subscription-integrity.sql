-- Apply after workspace-billing-acl and before deploying stripe.
-- Current provider state is passed only by the verified service-role handler.
begin;
do $$ begin
  if has_column_privilege('authenticated','public.organizations','stripe_subscription_id','UPDATE') then
    raise exception 'Apply 2026-09-30-workspace-billing-acl.sql before Stripe subscription integrity';
  end if;
end $$;
alter table public.organizations
  add column if not exists stripe_event_at timestamptz,
  add column if not exists stripe_observed_at timestamptz,
  add column if not exists stripe_subscription_created_at timestamptz;
revoke insert(stripe_event_at,stripe_observed_at,stripe_subscription_created_at),
  update(stripe_event_at,stripe_observed_at,stripe_subscription_created_at)
  on public.organizations from public,anon,authenticated;

create or replace function public.filey_apply_stripe_subscription(
  p_subscription text,p_customer text,p_org text,p_plan text,p_status text,
  p_period_end timestamptz,p_created_at timestamptz,p_event_at timestamptz,p_observed_at timestamptz,p_bind boolean default false
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org public.organizations; v_paid boolean := p_status in ('active','trialing','past_due');
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Billing service access required' using errcode='42501'; end if;
  if p_subscription is null or p_subscription !~ '^sub_[A-Za-z0-9]+$'
    or p_customer is null or p_customer !~ '^cus_[A-Za-z0-9]+$'
    or p_plan is null or p_plan not in ('pro','business')
    or p_status is null or p_status not in ('active','trialing','past_due','incomplete','incomplete_expired','canceled','unpaid','paused')
    or p_period_end is null or p_created_at is null or p_event_at is null or p_observed_at is null then
    raise exception 'Invalid subscription state' using errcode='22023';
  end if;
  if (select count(*) from public.organizations where stripe_customer_id=p_customer)>1 then
    raise exception 'Stripe customer workspace is ambiguous' using errcode='42501';
  end if;
  select * into v_org from public.organizations where stripe_customer_id=p_customer
    and (p_org is null or id::text=p_org) for update;
  if not found then raise exception 'Stripe customer workspace is not authorized' using errcode='42501'; end if;
  -- A shared customer never permits moving a subscription to another org.
  if exists(select 1 from public.organizations where stripe_subscription_id=p_subscription and id<>v_org.id) then
    raise exception 'Subscription belongs to another workspace' using errcode='42501';
  end if;
  if v_org.stripe_subscription_id is not null and v_org.stripe_subscription_id<>p_subscription then
    -- Only a verified paid checkout can replace a bound subscription. Old
    -- lifecycle events cannot retake the workspace using a customer id.
    if not coalesce(p_bind,false) or not v_paid then return 'ignored replaced subscription'; end if;
    if v_org.stripe_subscription_created_at is not null and p_created_at<=v_org.stripe_subscription_created_at then
      return 'ignored older subscription';
    end if;
    if v_org.plan in ('pro','business') and v_org.plan_status in ('active','trialing','past_due') then
      return 'another Stripe subscription is active';
    end if;
  end if;
  if v_org.stripe_event_at is not null and (p_event_at<v_org.stripe_event_at
    or (p_event_at=v_org.stripe_event_at and p_observed_at<=v_org.stripe_observed_at)) then
    return 'ignored older event';
  end if;
  -- Stripe cancellation is terminal for a subscription id. Same-second
  -- delivery races must never resurrect an already canceled subscription.
  if v_org.stripe_subscription_id=p_subscription and v_org.plan_status in ('canceled','incomplete_expired') and v_paid then
    return 'ignored terminal subscription';
  end if;
  -- A Stripe retry/cancellation cannot revoke the other provider's access or
  -- an owner's permanent Ultra license. These are separate entitlements.
  if v_org.plan='ultra' or v_org.cloud_grandfathered
    or exists(select 1 from public.licenses where user_id=v_org.owner_id and status='active')
    or (v_org.dodo_subscription_id is not null and (
      (v_org.plan='cloud' and v_org.plan_status in ('active','trialing','past_due'))
      or exists(select 1 from public.pending_entitlements where dodo_subscription_id=v_org.dodo_subscription_id
        and plan_status in ('active','trialing','past_due')))) then
    return 'protected by another entitlement';
  end if;
  update public.organizations set plan=case when v_paid then p_plan else 'free' end,
    plan_status=p_status,current_period_end=p_period_end,stripe_subscription_id=p_subscription,
    stripe_subscription_created_at=p_created_at,stripe_event_at=p_event_at,stripe_observed_at=p_observed_at
    where id=v_org.id;
  return 'applied';
end $$;
revoke all on function public.filey_apply_stripe_subscription(text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,boolean)
  from public,anon,authenticated;
grant execute on function public.filey_apply_stripe_subscription(text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,boolean) to service_role;
notify pgrst,'reload schema';
commit;
