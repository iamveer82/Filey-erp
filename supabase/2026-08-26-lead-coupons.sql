-- Lead-to-coupon: a website visitor leaves their contact details, the edge
-- function mints a single-use, hard-to-guess coupon for the unlimited offline
-- license, and the owner sends the code once payment lands. Until a payment
-- gateway replaces the manual step, this table is the bridge between
-- "stranger on the pricing page" and "paying desktop customer".
--
-- Redemption rides the EXISTING voucher path (redeem_voucher RPC → license
-- activate), so there is exactly one redemption brain in the product. What is
-- new here: single-use by construction (max_uses = 1), an expiry so an unused
-- code dies quietly, and the lead's contact details kept beside their code.

create table if not exists public.lead_coupons (
  id          uuid primary key default gen_random_uuid(),
  lead_id     bigint,
  name        text not null,
  phone       text not null,
  email       text,
  message     text,
  source      text not null default 'website',
  code        text not null unique,
  status      text not null default 'new',   -- new | sent | redeemed
  created_at  timestamptz not null default now(),
  redeemed_at timestamptz
);

alter table public.lead_coupons enable row level security;

-- The contact form posts without a session (the edge function uses the
-- service key, which bypasses RLS — this policy is the belt to its braces).
create policy "lead coupons can be created by anyone"
  on public.lead_coupons for insert
  to anon, authenticated
  with check (true);

-- The owner (any signed-in workspace member) reads leads and updates status.
create policy "lead coupons readable by signed in"
  on public.lead_coupons for select
  to authenticated
  using (true);

create policy "lead coupons updatable by signed in"
  on public.lead_coupons for update
  to authenticated
  using (true)
  with check (true);

-- Vouchers gain an expiry: an unused lead coupon dies after 30 days so the
-- wild doesn't fill with forever-valid free licenses.
alter table public.vouchers add column if not exists expires_at timestamptz;

-- Redeem gains the expiry gate. Recreated (not altered) so the change ships
-- as one idempotent statement.
create or replace function public.redeem_voucher(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_max     int;
  v_product text;
  v_already boolean;
  v_expires timestamptz;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  select max_uses, product, expires_at into v_max, v_product, v_expires
    from vouchers where code = p_code;
  if v_max is null then
    return json_build_object('ok', false, 'reason', 'invalid_code');
  end if;

  -- An unused coupon past its expiry is dead, and says so (the app can offer
  -- a fresh one) rather than pretending the code never existed.
  if v_expires is not null and now() > v_expires then
    return json_build_object('ok', false, 'reason', 'expired');
  end if;

  select exists(
    select 1 from voucher_redemptions where code = p_code and user_id = v_uid
  ) into v_already;

  if not v_already then
    update vouchers set used_count = used_count + 1
      where code = p_code and used_count < max_uses;
    if not found then
      return json_build_object('ok', false, 'reason', 'exhausted');
    end if;
    insert into voucher_redemptions (code, user_id) values (p_code, v_uid);
  end if;

  -- grant the entitlement; the existing stripe/license_activate path signs the
  -- offline token from this row.
  if not exists (select 1 from licenses where user_id = v_uid and status = 'active') then
    insert into licenses (user_id, product, status) values (v_uid, v_product, 'active');
  end if;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.redeem_voucher(text) from public, anon;
grant execute on function public.redeem_voucher(text) to authenticated;
