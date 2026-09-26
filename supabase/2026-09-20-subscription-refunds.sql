-- Hosted billing only. Requests never sync into customer business databases.
begin;
create table if not exists public.subscription_refund_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  requested_by uuid not null references auth.users(id),
  payment_id text not null unique,
  subscription_id text not null,
  customer_id text not null,
  amount integer not null check (amount > 0),
  currency text not null,
  reason text not null check (length(reason) between 10 and 2000),
  status text not null default 'requested' check (status in
    ('requested','processing','pending','refunded','partially_refunded','rejected','needs_review','failed')),
  provider_refund_id text unique,
  refunded_amount integer not null default 0 check (refunded_amount >= 0),
  reviewed_by uuid references auth.users(id),
  review_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscription_refunds_org_date
  on public.subscription_refund_requests(org_id,created_at desc);
create index if not exists subscription_refunds_status_date
  on public.subscription_refund_requests(status,created_at desc);
alter table public.subscription_refund_requests enable row level security;
revoke all on public.subscription_refund_requests from public,anon,authenticated;
grant select,insert,update on public.subscription_refund_requests to service_role;
comment on table public.subscription_refund_requests is
  'Subscription refund requests only. Edge function verifies workspace billing roles and a separate merchant allowlist. Never AI credits.';
commit;
