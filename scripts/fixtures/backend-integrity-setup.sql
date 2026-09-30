create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
create table auth.users(id uuid primary key);
insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
create table invoice_docs(id bigint primary key,user_id uuid,org_id text,currency text,status text,tax_rate numeric,discount numeric,updated_at timestamptz);
create table invoice_doc_items(invoice_id bigint,org_id text,qty numeric,unit_price numeric);
create table invoice_payments(id bigint generated always as identity primary key,invoice_id bigint,user_id uuid,org_id text,amount numeric,method text,paid_at date);
create table licenses(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),product text,status text,stripe_payment_intent text);
insert into invoice_docs values(1,'00000000-0000-0000-0000-000000000001','ORG','AED','sent',5,0,now()),
  (2,'00000000-0000-0000-0000-000000000002','OTHER','AED','sent',5,0,now());
insert into invoice_doc_items values(1,'ORG',1,100),(2,'OTHER',1,200);
create table tool_jobs(id integer primary key,user_id uuid,input_path text,output_paths text[] not null default '{}');
alter table tool_jobs enable row level security;
create policy tool_jobs_own on tool_jobs to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid() and input_path like auth.uid()::text||'/%');
grant select,insert,update,delete on tool_jobs to authenticated;
