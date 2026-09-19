-- Atomic subscription delivery and verified-email claims. No business rows are rewritten.
begin;
alter table public.pending_entitlements
  add column if not exists plan_status text not null default 'pending',
  add column if not exists current_period_end timestamptz,
  add column if not exists last_event_at timestamptz;

create or replace view public.filey_users_by_email
with (security_invoker = true) as
  select id, lower(email) as email from auth.users where email_confirmed_at is not null;
revoke all on public.filey_users_by_email from public, anon, authenticated;
grant select on public.filey_users_by_email to service_role;

create or replace function public.filey_apply_dodo_subscription(
  p_subscription text, p_email text, p_customer text, p_org text, p_user uuid,
  p_status text, p_period_end timestamptz, p_event_at timestamptz
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.pending_entitlements%rowtype;
  v_org public.organizations%rowtype;
  v_paid boolean := p_status in ('active', 'trialing', 'past_due');
begin
  if nullif(p_subscription, '') is null or p_event_at is null then
    raise exception 'Subscription id and event timestamp are required';
  end if;
  insert into public.pending_entitlements(email, kind, dodo_subscription_id)
    values (lower(p_email), 'cloud', p_subscription)
    on conflict (dodo_subscription_id) where dodo_subscription_id is not null do nothing;
  select * into v_row from public.pending_entitlements
    where dodo_subscription_id = p_subscription for update;
  if v_row.last_event_at is not null and v_row.last_event_at > p_event_at then
    return 'ignored older event';
  end if;
  update public.pending_entitlements set plan_status = p_status,
    current_period_end = p_period_end, last_event_at = p_event_at,
    dodo_customer_id = coalesce(p_customer, dodo_customer_id)
    where id = v_row.id;

  -- Match a bound subscription first; checkout metadata cannot reassign it.
  select * into v_org from public.organizations
    where dodo_subscription_id = p_subscription for update;
  if v_org.id is null and p_org is not null and p_user is not null then
    select * into v_org from public.organizations o
      where o.id::text = p_org and (o.owner_id = p_user or exists (
        select 1 from public.org_members m where m.org_id = p_org
          and m.user_id = p_user and m.role in ('owner','admin')
      )) for update;
    if v_org.id is null then raise exception 'Checkout workspace is not authorized'; end if;
    if v_org.dodo_subscription_id is distinct from p_subscription
      and v_org.dodo_subscription_id is not null then
      if not v_paid or exists (select 1 from public.pending_entitlements e
        where e.dodo_subscription_id = v_org.dodo_subscription_id
          and e.created_at > v_row.created_at) then
        return 'ignored superseded subscription';
      end if;
      if v_org.plan <> 'free' and v_org.plan_status in ('active','trialing','past_due') then
        return 'another subscription is active';
      end if;
    end if;
  end if;
  if v_org.id is null then return 'parked'; end if;
  update public.organizations set plan = case when v_paid then 'cloud' else 'free' end,
    plan_status = p_status, current_period_end = p_period_end,
    dodo_subscription_id = p_subscription,
    dodo_customer_id = coalesce(p_customer, dodo_customer_id)
    where id = v_org.id;
  update public.pending_entitlements set claimed_at = coalesce(claimed_at, now()),
    claimed_by = coalesce(claimed_by, p_user) where id = v_row.id;
  return 'applied';
end $$;
revoke all on function public.filey_apply_dodo_subscription(text,text,text,text,uuid,text,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.filey_apply_dodo_subscription(text,text,text,text,uuid,text,timestamptz,timestamptz)
  to service_role;

create or replace function public.filey_claim_entitlements()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_org text;
  v_row record;
  v_claimed_cloud int := 0;
  v_claimed_licence int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('claimed', false, 'reason', 'not signed in');
  end if;

  select lower(email) into v_email from auth.users where id = v_uid and email_confirmed_at is not null;
  if v_email is null or v_email = '' then
    return jsonb_build_object('claimed', false, 'reason', 'verify your email first');
  end if;

  for v_row in
    select * from public.pending_entitlements
    where claimed_at is null and lower(email) = v_email
    order by created_at
    for update
  loop
    if v_row.kind = 'freedom' then
      -- One active licence per account is enough; a second purchase stays
      -- unclaimed rather than silently vanishing.
      if not exists (
        select 1 from public.licenses
        where user_id = v_uid and status = 'active'
      ) then
        insert into public.licenses (user_id, product, status, dodo_payment_id)
        values (v_uid, 'filey-desktop', 'active', v_row.dodo_payment_id)
        on conflict do nothing;
        if not found then continue; end if;
        v_claimed_licence := v_claimed_licence + 1;
        update public.pending_entitlements
          set claimed_at = now(), claimed_by = v_uid where id = v_row.id;
      end if;
    elsif v_row.plan_status in ('active', 'trialing', 'past_due')
      and (v_row.current_period_end is null or v_row.current_period_end > now()) then
      select o.id::text into v_org
      from public.organizations o
      where o.id::text = public.current_org()
        and (o.owner_id = v_uid or exists (
          select 1 from public.org_members m where m.org_id = o.id::text
            and m.user_id = v_uid and m.role in ('owner', 'admin')
        ))
        and (o.dodo_subscription_id is null or o.dodo_subscription_id = v_row.dodo_subscription_id
          or o.plan = 'free')
      order by (o.id::text = public.current_org()) desc, o.created_at
      limit 1;
      if v_org is not null then
        update public.organizations
          set plan = 'cloud',
              plan_status = v_row.plan_status,
              current_period_end = v_row.current_period_end,
              dodo_subscription_id = coalesce(v_row.dodo_subscription_id, dodo_subscription_id),
              dodo_customer_id = coalesce(v_row.dodo_customer_id, dodo_customer_id)
          where id::text = v_org;
        v_claimed_cloud := v_claimed_cloud + 1;
        update public.pending_entitlements
          set claimed_at = now(), claimed_by = v_uid where id = v_row.id;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'claimed', (v_claimed_cloud + v_claimed_licence) > 0,
    'cloud', v_claimed_cloud,
    'licences', v_claimed_licence
  );
end;
$$;

revoke all on function public.filey_claim_entitlements() from public, anon;
grant execute on function public.filey_claim_entitlements() to authenticated;

commit;
