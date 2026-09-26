-- Dodo Payments sells the Freedom licence; record which payment bought it.
--
-- The webhook can be delivered more than once (Dodo retries until it gets a
-- 2xx, and a retry after our own 500 is exactly the case that matters), so the
-- payment id is the idempotency key: a second delivery of the same payment
-- hits the unique index instead of handing out a second licence.
--
-- Partial index, because every licence issued through Stripe or a voucher has
-- no Dodo payment at all and those NULLs must not collide.

begin;

alter table public.licenses add column if not exists dodo_payment_id text;

create unique index if not exists licenses_dodo_payment_id_key
  on public.licenses (dodo_payment_id)
  where dodo_payment_id is not null;

commit;
