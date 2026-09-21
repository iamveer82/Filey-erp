-- Snapshot the one-time service fee separately from spendable AI credit.
-- Existing orders retain their original zero fee.
begin;
alter table public.ai_credit_orders
  add column if not exists service_fee_cents integer not null default 0
  check (service_fee_cents >= 0);
commit;
