-- Stripe billing — org-level subscription state.
-- Source of truth is the Stripe webhook (writes via service role); the client
-- only reads these. Additive + idempotent.

alter table organizations add column if not exists plan text not null default 'free';
alter table organizations add column if not exists plan_status text;
alter table organizations add column if not exists stripe_customer_id text;
alter table organizations add column if not exists stripe_subscription_id text;
alter table organizations add column if not exists current_period_end timestamptz;
