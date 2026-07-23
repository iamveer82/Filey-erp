-- Promo vouchers: a code grants a free Filey Desktop (offline) license, capped
-- at a fixed number of total redemptions enforced server-side. One code can be
-- claimed by up to max_uses distinct accounts; re-redeeming is idempotent.

create table if not exists public.vouchers (
  code       text primary key,
  max_uses   int  not null check (max_uses >= 0),
  used_count int  not null default 0,
  product    text not null default 'filey-desktop',
  created_at timestamptz not null default now()
);

create table if not exists public.voucher_redemptions (
  id         uuid primary key default gen_random_uuid(),
  code       text not null references public.vouchers(code),
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (code, user_id)          -- one seat per account per code
);

-- Only the SECURITY DEFINER function below touches these tables; RLS on with
-- no policies means the client can't read/write them directly.
alter table public.vouchers            enable row level security;
alter table public.voucher_redemptions enable row level security;

-- Atomic redeem: the guarded UPDATE is race-safe (the row lock re-checks the
-- cap), so concurrent claims can never exceed max_uses.
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
begin
  if v_uid is null then
    return json_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  select max_uses, product into v_max, v_product from vouchers where code = p_code;
  if v_max is null then
    return json_build_object('ok', false, 'reason', 'invalid_code');
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

-- The launch promo: first 25 accounts free.
insert into public.vouchers (code, max_uses) values ('FILEY25', 25)
  on conflict (code) do nothing;
