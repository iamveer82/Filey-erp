-- Synthetic paid claims in a disposable database; never provider/customer data.
set client_min_messages=warning;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
insert into auth.users values
 ('00000000-0000-4000-8000-000000000001','owner@example.invalid',now()),
 ('00000000-0000-4000-8000-000000000002','admin@example.invalid',now());
create table organizations(id text primary key,owner_id uuid,plan text,plan_status text,dodo_subscription_id text unique,dodo_customer_id text,current_period_end timestamptz,created_at timestamptz default now());
insert into organizations(id,owner_id,plan) values('a','00000000-0000-4000-8000-000000000001','free');
create table org_members(org_id text,user_id uuid,role text);
insert into org_members values('a','00000000-0000-4000-8000-000000000001','owner'),('a','00000000-0000-4000-8000-000000000002','admin');
create function current_org() returns text language sql stable security definer set search_path=public,pg_temp as $$ select org_id from org_members where user_id=auth.uid() $$;
create table pending_entitlements(id uuid primary key default gen_random_uuid(),email text not null,kind text not null,dodo_payment_id text,dodo_subscription_id text,dodo_customer_id text,created_at timestamptz default now(),claimed_at timestamptz,claimed_by uuid);
create unique index pending_subscription on pending_entitlements(dodo_subscription_id) where dodo_subscription_id is not null;
create table licenses(user_id uuid,product text,status text,dodo_payment_id text unique);
-- Hold the first UPDATE's row lock while the second caller reads eligibility.
create function fixture_slow_claim() returns trigger language plpgsql as $$ begin perform pg_sleep(1); return new; end $$;
create trigger fixture_slow_claim before update on organizations for each row execute function fixture_slow_claim();
grant usage on schema public,auth to authenticated,anon,service_role;
