set client_min_messages=warning;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid',true),'')::uuid
$$;
create table organizations(id uuid primary key,owner_id uuid);
create table profiles(id uuid primary key,org_id text);
create table org_members(org_id text,user_id uuid,role text);
create function current_org() returns text language sql stable security definer set search_path=public as $$
  select org_id from profiles where id=auth.uid()
$$;
create function is_org_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from organizations where id::text=current_org() and owner_id=auth.uid())
$$;
insert into organizations values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001');
insert into profiles values
 ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003'),
 ('00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000004'),
 ('00000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001');
insert into org_members values
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000004','staff');
do $$ declare t text; begin
  foreach t in array array['products','invoice_docs','invoice_doc_items','invoice_payments','app_settings','company_profile'] loop
    execute format('create table %I(id bigint primary key,user_id uuid not null default auth.uid(),org_id text not null default current_org(),name text,shared boolean default false,updated_at timestamptz)',t);
  end loop;
end $$;
alter table invoice_doc_items add column invoice_id bigint references invoice_docs(id);
alter table invoice_payments add column invoice_id bigint references invoice_docs(id);
alter table app_settings add column key text;
alter table app_settings add column value text;
alter table app_settings add unique(user_id,key);
insert into products(id,user_id,org_id,name) values
 (1,'00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','local owner'),
 (2,'00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','different owner'),
 (3,'00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','current');
insert into invoice_docs(id,user_id,org_id,name) values
 (10,'00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','invoice');
insert into invoice_doc_items(id,user_id,org_id,invoice_id,name) values
 (20,'00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',10,'linked'),
 (21,'00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',null,'unlinked');
insert into invoice_payments(id,user_id,org_id,invoice_id,name) values
 (22,'00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',null,'unlinked payment');
insert into app_settings(id,user_id,org_id,key,value) values
 (40,'00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','company_stamp','data:image/png;base64,unchanged');
insert into company_profile(id,user_id,org_id,name) values
 (50,'00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','Archived'),
 (51,'00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Current');
alter table app_settings enable row level security;
create policy settings_org on app_settings for all to authenticated using(org_id=current_org()) with check(org_id=current_org());
alter table company_profile enable row level security;
create policy company_org on company_profile for all to authenticated using(org_id=current_org()) with check(org_id=current_org());
grant usage on schema public,auth to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
