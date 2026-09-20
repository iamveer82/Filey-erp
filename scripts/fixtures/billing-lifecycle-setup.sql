-- Extends the disposable Basic-web fixture, never the live database.
create role service_role;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
insert into auth.users select owner_id,'owner'||right(id::text,1)||'@example.invalid',now() from organizations;
alter table org_members add column role text default 'owner';
alter table organizations add column dodo_subscription_id text unique;
alter table organizations add column dodo_customer_id text;
alter table organizations add column current_period_end timestamptz;
alter table licenses add column product text;
alter table licenses add column dodo_payment_id text unique;
create table pending_entitlements(id uuid primary key default gen_random_uuid(),email text not null,kind text not null,
 dodo_payment_id text,dodo_subscription_id text,dodo_customer_id text,created_at timestamptz default now(),claimed_at timestamptz,claimed_by uuid);
create unique index pending_subscription on pending_entitlements(dodo_subscription_id) where dodo_subscription_id is not null;
create unique index pending_payment on pending_entitlements(dodo_payment_id) where dodo_payment_id is not null;
alter table pending_entitlements enable row level security;
