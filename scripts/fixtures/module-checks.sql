-- Apply only to the disposable fixture cluster, after existing RLS/sync checks.
alter table public.org_members add column modules text[];
alter table public.invoice_docs add column doc_type text default 'invoice';
alter table public.entity_links add column from_type text default 'customer';
alter table public.entity_links add column to_type text default 'invoice';
create table public.app_settings(id bigint primary key,key text,value text);
insert into app_settings values(1,'modules.disabled','[]'),(2,'bank_accounts','private-bank-fixture');
alter table app_settings enable row level security;
create policy fixture_org on app_settings for all to authenticated using(true) with check(true);
grant select,insert,update,delete on app_settings to authenticated;
