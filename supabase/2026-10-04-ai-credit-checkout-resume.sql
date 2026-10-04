-- Persist an acknowledged provider checkout before returning it to its owner.
-- Existing unknown claims remain unknown; no new session or Coin is inferred.
begin;
alter table public.ai_credit_orders add column if not exists checkout_url text;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.ai_credit_orders'::regclass and conname='ai_credit_checkout_url_safe') then
    alter table public.ai_credit_orders add constraint ai_credit_checkout_url_safe check (
      checkout_url is null or (length(checkout_url) between 1 and 2048
        and checkout_url ~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*dodopayments\.com([/?#]|$)'
        and checkout_url !~ '[[:space:][:cntrl:]\\]'));
  end if;
end $$;
-- Checkout URLs contain private session identities and keep the existing
-- service-only order authority. Authenticated clients use the verified action.
revoke all on public.ai_credit_orders from public, anon, authenticated;
grant all on public.ai_credit_orders to service_role;
commit;
