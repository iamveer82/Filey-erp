set client_min_messages = warning;
create role authenticated;
create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;
create table public.org_members (org_id text, user_id uuid, role text);
insert into public.org_members values
  ('a','00000000-0000-0000-0000-000000000001','staff'),
  ('a','00000000-0000-0000-0000-000000000002','staff'),
  ('a','00000000-0000-0000-0000-000000000003','staff'),
  ('a','00000000-0000-0000-0000-000000000004','admin'),
  ('b','00000000-0000-0000-0000-000000000005','admin');
create function public.current_org() returns text language sql stable security definer set search_path = public as $$
  select org_id from org_members where user_id = auth.uid()
$$;
create function public.is_org_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from org_members where user_id = auth.uid() and role = 'admin')
$$;
-- Minimal fixture columns; the policies and RPC under test are the production SQL.
do $$ declare t text; begin
  foreach t in array array[
    'products','orders','order_items','employees','attendance','payroll',
    'accounts','expenses','transactions','crm_leads','crm_customers',
    'crm_opportunities','crm_activities','crm_people','crm_notes','crm_tasks',
    'invoice_docs','invoice_doc_items','invoice_payments','quotations',
    'quotation_items','quotation_templates','tool_runs','suppliers',
    'purchase_orders','purchase_order_items','stock_movements','advances',
    'po_payments','payment_receipts','entity_links','campaigns','email_optouts',
    'org_channels','email_messages','call_logs','invoice_recurrence'
  ] loop
    execute format('create table public.%I (id bigint primary key, user_id uuid not null, org_id text not null, shared boolean default false, updated_at timestamptz, name text default ''original'')', t);
    execute format('insert into public.%I(id,user_id,org_id,shared) values (1,''00000000-0000-0000-0000-000000000001'',''a'',true), (2,''00000000-0000-0000-0000-000000000001'',''a'',false), (3,''00000000-0000-0000-0000-000000000001'',''a'',false)', t);
    -- Reproduce the old permissive policy; migration must replace it.
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all using (true) with check (true)', t || '_access', t);
  end loop;
end $$;
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' and tablename <> 'org_members' loop
    execute format('alter table public.%I alter column user_id set default auth.uid()',t);
    execute format('alter table public.%I alter column org_id set default public.current_org()',t);
    execute format('alter table public.%I add column created_at timestamptz default now()',t);
  end loop;
end $$;
alter table invoice_doc_items add column invoice_id bigint;
alter table invoice_payments add column invoice_id bigint;
alter table invoice_recurrence add column base_invoice_id bigint;
update invoice_doc_items set invoice_id = id;
update invoice_payments set invoice_id = id;
update invoice_recurrence set base_invoice_id = id;
alter table invoice_docs add column shared_with jsonb default '[]';
update invoice_docs set shared_with = '["00000000-0000-0000-0000-000000000002"]' where id = 2;
grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
