create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role',true),''),'authenticated') $$;
create table auth.users(id uuid primary key);
insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
create table public.tool_jobs(
  id uuid primary key default gen_random_uuid(),user_id uuid not null default auth.uid() references auth.users(id),
  tool text not null,status text not null default 'pending',engine text not null default 'edge',input_path text not null,
  output_paths text[] not null default '{}',params jsonb not null default '{}',file_name text not null default '',
  size_bytes bigint not null default 0,error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
alter table tool_jobs enable row level security;
create policy tool_jobs_own on tool_jobs for all to authenticated using(user_id=auth.uid())
  with check(user_id=auth.uid() and input_path like auth.uid()::text||'/%');
grant usage on schema public,auth to authenticated,service_role;
grant select,insert,update,delete on tool_jobs to authenticated,service_role;
-- A legacy column grant must not survive the new server-owned update boundary.
grant update(status) on tool_jobs to authenticated;
set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000001';
insert into tool_jobs(id,tool,status,input_path,output_paths)
  values('50000000-0000-4000-8000-000000000001','rotate','processing',auth.uid()::text||'/original.pdf',array[auth.uid()::text||'/forged.pdf']);
update tool_jobs set tool='ocr',engine='worker',input_path=auth.uid()::text||'/changed.pdf',params='{"degrees":180}'
  where id='50000000-0000-4000-8000-000000000001';
do $$ begin if not exists(select 1 from tool_jobs where tool='ocr' and status='processing' and cardinality(output_paths)=1)
  then raise exception 'Fixture must reproduce processing mutation/result forgery'; end if; end $$;
reset role;
delete from tool_jobs;
select 'PASS: baseline clients can forge completed/processing results and alter active tool specifications.';
