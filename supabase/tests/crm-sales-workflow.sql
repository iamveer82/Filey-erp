-- Run with psql -v ON_ERROR_STOP=1 -d filey_crm_sales_test -f this-file.sql.
-- This deliberately requires an empty, disposable database. Never use customer data.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'filey_crm_sales_test' or to_regclass('public.quotations') is not null then
    raise exception 'Use an empty disposable filey_crm_sales_test database';
  end if;
end $$;
create role authenticated;
create role anon;
create schema auth;
create function auth.uid() returns uuid language sql as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function public.current_org() returns text language sql as $$
  select nullif(current_setting('test.org', true), '')
$$;
create table quotations (
  id bigint primary key, user_id uuid default auth.uid(), org_id text default current_org(),
  customer_id bigint, status text default 'draft', updated_at timestamptz default '2026-09-12Z'
);
create table invoice_docs (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid(), org_id text default current_org(),
  quotation_id bigint references quotations, customer_id bigint, number text,
  status text, doc_type text, currency text, fx_rate numeric, terms text
);
create table invoice_doc_items (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid(), org_id text default current_org(),
  invoice_id bigint references invoice_docs, description text, qty numeric not null,
  unit_price numeric, position bigint
);
alter table quotations enable row level security;
alter table invoice_docs enable row level security;
alter table invoice_doc_items enable row level security;
create policy owner on quotations using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy owner on invoice_docs using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy owner on invoice_doc_items using (user_id=auth.uid()) with check (user_id=auth.uid());
grant usage on schema auth, public to authenticated;
grant all on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
\ir ../2026-09-12-crm-sales-workflow.sql
insert into quotations(id,user_id,org_id,customer_id)
  select n,'00000000-0000-0000-0000-000000000001','org-a',42 from generate_series(1,5) n;
insert into quotations(id,user_id,org_id) values
  (6,'00000000-0000-0000-0000-000000000002','org-a'),
  (7,'00000000-0000-0000-0000-000000000001','org-b');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_config('test.org','org-a',false);
set role authenticated;
do $$
declare
  invoice bigint; again bigint; test_case record;
  header jsonb := '{"number":"TEST-1","currency":"EUR","fx_rate":4.1,"terms":"Net 30","user_id":"00000000-0000-0000-0000-000000000002","org_id":"org-b","customer_id":999}';
  lines jsonb := '[{"description":"Test service","qty":2,"unit_price":125,"position":99,"org_id":"org-b"}]';
begin
  invoice := filey_convert_quotation(1,header,lines,'2026-09-12Z');
  again := filey_convert_quotation(1,header,lines,'2020-01-01Z');
  assert invoice=again, 'Retry created another invoice';
  assert (select count(*)=1 from invoice_docs), 'Wrong invoice count';
  assert (select currency='EUR' and fx_rate=4.1 and terms='Net 30' and customer_id=42
    and status='draft' and doc_type='invoice' and user_id=auth.uid() and org_id=current_org()
    from invoice_docs where id=invoice), 'Header or ownership was not preserved';
  assert (select qty=2 and unit_price=125 and position=0 and user_id=auth.uid() and org_id=current_org()
    from invoice_doc_items where invoice_id=invoice), 'Line or ownership was not preserved';
  assert (select status='accepted' from quotations where id=1), 'Quote was not accepted';

  for test_case in select * from (values
    (2, header, lines || '[{"qty":"invalid-number"}]'::jsonb, '2026-09-12Z'::timestamptz),
    (2, header || '{"unexpected":true}'::jsonb, lines, '2026-09-12Z'::timestamptz),
    (2, header, '[]'::jsonb, '2026-09-12Z'::timestamptz),
    (2, header, lines, '2020-01-01Z'::timestamptz),
    (6, header, lines, '2026-09-12Z'::timestamptz),
    (7, header, lines, '2026-09-12Z'::timestamptz),
    (-1, header, lines, '2026-09-12Z'::timestamptz)
  ) t(id,h,l,stamp) loop
    begin
      perform filey_convert_quotation(test_case.id,test_case.h,test_case.l,test_case.stamp);
      raise exception 'Unexpected conversion success';
    exception when others then
      if sqlerrm='Unexpected conversion success' then raise; end if;
    end;
    assert (select count(*)=1 from invoice_docs), 'Failed conversion left an invoice';
    assert (select count(*)=1 from invoice_doc_items), 'Failed conversion left lines';
    assert (select status='draft' from quotations where id=2), 'Failed conversion changed quote';
  end loop;
  perform set_config('request.jwt.claim.sub','',false);
  begin
    perform filey_convert_quotation(2,header,lines,'2026-09-12Z');
    raise exception 'Signed-out conversion succeeded';
  exception when others then
    if sqlerrm<>'Sign in to convert quotations' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  assert not has_function_privilege('anon','filey_convert_quotation(bigint,jsonb,jsonb,timestamptz)','execute');
  assert not (select prosecdef from pg_proc where oid='filey_convert_quotation(bigint,jsonb,jsonb,timestamptz)'::regprocedure);
end $$;
select 'CRM sales migration checks passed' as result;
