-- Lock the eligible organization before consuming a parked paid entitlement.
-- Distinct purchasers must not both consume claims for the same workspace.
begin;
create or replace function public.filey_claim_entitlements()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid uuid:=auth.uid(); v_email text; v_org text; v_row record;
  v_claimed_cloud int:=0; v_claimed_licence int:=0;
begin
  if v_uid is null then return jsonb_build_object('claimed',false,'reason','not signed in'); end if;
  select lower(email) into v_email from auth.users where id=v_uid and email_confirmed_at is not null;
  if v_email is null or v_email='' then
    return jsonb_build_object('claimed',false,'reason','verify your email first');
  end if;
  for v_row in select * from public.pending_entitlements
    where claimed_at is null and lower(email)=v_email order by created_at,id for update
  loop
    if v_row.kind='freedom' then
      if not exists(select 1 from public.licenses where user_id=v_uid and status='active') then
        insert into public.licenses(user_id,product,status,dodo_payment_id)
          values(v_uid,'filey-desktop','active',v_row.dodo_payment_id) on conflict do nothing;
        if not found then continue; end if;
        v_claimed_licence:=v_claimed_licence+1;
        update public.pending_entitlements set claimed_at=now(),claimed_by=v_uid where id=v_row.id;
      end if;
    elsif v_row.plan_status in ('active','trialing','past_due')
      and (v_row.current_period_end is null or v_row.current_period_end>now()) then
      -- FOR UPDATE rechecks this eligibility after waiting for an earlier
      -- claim's row lock. A different active purchase remains unclaimed.
      select o.id::text into v_org from public.organizations o
        where o.id::text=public.current_org() and (o.owner_id=v_uid or exists(
          select 1 from public.org_members m where m.org_id=o.id::text
            and m.user_id=v_uid and m.role in ('owner','admin')))
          and (o.dodo_subscription_id is null or o.dodo_subscription_id=v_row.dodo_subscription_id or o.plan='free')
        order by (o.id::text=public.current_org()) desc,o.created_at limit 1 for update of o;
      if v_org is not null then
        update public.organizations set plan='cloud',plan_status=v_row.plan_status,
          current_period_end=v_row.current_period_end,
          dodo_subscription_id=coalesce(v_row.dodo_subscription_id,dodo_subscription_id),
          dodo_customer_id=coalesce(v_row.dodo_customer_id,dodo_customer_id) where id::text=v_org;
        v_claimed_cloud:=v_claimed_cloud+1;
        update public.pending_entitlements set claimed_at=now(),claimed_by=v_uid where id=v_row.id;
      end if;
    end if;
  end loop;
  return jsonb_build_object('claimed',(v_claimed_cloud+v_claimed_licence)>0,'cloud',v_claimed_cloud,'licences',v_claimed_licence);
end $$;
revoke all on function public.filey_claim_entitlements() from public,anon;
grant execute on function public.filey_claim_entitlements() to authenticated;
notify pgrst,'reload schema';
commit;
