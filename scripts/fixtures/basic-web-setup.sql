-- Disposable database only. Matches the production column types and RLS boundary.
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;
create table organizations (id uuid primary key, owner_id uuid, created_at timestamptz default now(),
  plan text default 'free', plan_status text, cloud_grandfathered boolean default false);
create table org_members (org_id text, user_id uuid);
create function current_org() returns text language sql stable security definer set search_path=public as $$
  select org_id from org_members where user_id=auth.uid()
$$;
create table licenses (user_id uuid, status text);
create table platform_config (key text primary key, value text);
insert into platform_config values ('licensing_enforced','true');
insert into organizations(id,owner_id)
select ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
  ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,6) n;
insert into org_members select id::text,owner_id from organizations;
insert into org_members values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000007');
update organizations set plan='cloud',plan_status='active' where id='10000000-0000-0000-0000-000000000002';
update organizations set cloud_grandfathered=true where id='10000000-0000-0000-0000-000000000003';
insert into licenses values ('20000000-0000-0000-0000-000000000004','active');
create table invoice_docs (id bigint primary key, org_id text not null default current_org(),
  user_id uuid not null default auth.uid(), created_at timestamptz default now(), notes text);
alter table invoice_docs enable row level security;
create policy invoice_ownership on invoice_docs for all to authenticated
  using (org_id=current_org()) with check (org_id=current_org());
grant usage on schema public,auth to authenticated;
grant select,insert,update,delete on invoice_docs to authenticated;
-- Seed old invoices before installing the migration: current month counts, old month does not.
insert into invoice_docs(id,org_id,user_id,created_at) values
  (1,'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',now()),
  (2,'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',now()-interval '2 months');
