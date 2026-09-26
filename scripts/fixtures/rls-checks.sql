set role authenticated;
do $$
declare
  actor int;
  t text;
  n int;
  expected int;
  result json;
begin
  for actor in 1..5 loop
    perform set_config('test.uid', '00000000-0000-0000-0000-' || lpad(actor::text,12,'0'), false);
    for t in select tablename from pg_tables where schemaname='public' and tablename <> 'org_members' loop
      expected := case when actor in (1,4) then 3 when actor=5 then 0
        when actor=2 and t in ('invoice_docs','invoice_doc_items','invoice_payments','invoice_recurrence') then 2 else 1 end;
      execute format('select count(*) from public.%I',t) into n;
      if n <> expected then raise exception '% actor % read: expected %, got %', t,actor,expected,n; end if;
      execute format('update public.%I set name=''checked''',t);
      get diagnostics n = row_count;
      if n <> (case when actor in (1,4) then 3 else 0 end) then
        raise exception '% actor % unexpected update count %',t,actor,n;
      end if;
      if actor not in (1,4) then
        execute format('delete from public.%I',t);
        get diagnostics n = row_count;
        if n <> 0 then raise exception '% actor % deleted shared records',t,actor; end if;
      end if;
    end loop;
  end loop;
  -- An admin in B must not share an invoice in A through SECURITY DEFINER.
  result := public.share_invoice(3,true,'[]');
  if result->>'reason' <> 'not_found' then raise exception 'Cross-org share accepted'; end if;
  perform set_config('test.uid','00000000-0000-0000-0000-000000000002',false);
  result := public.share_invoice(2,true,'[]');
  if result->>'reason' <> 'forbidden' then raise exception 'Reader changed targeted sharing'; end if;
  begin
    insert into invoice_payments(id,user_id,org_id,invoice_id) values(4,auth.uid(),'a',1);
    raise exception 'Reader added a payment to a shared invoice';
  exception when insufficient_privilege then null; end;
  begin
    insert into products(id,user_id,org_id) values(4,auth.uid(),'b');
    raise exception 'Cross-org insert accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
  result := public.share_invoice(1,false,'["00000000-0000-0000-0000-000000000005"]');
  if result->>'reason' <> 'invalid_members' then raise exception 'Foreign share target accepted'; end if;
  result := public.share_invoice(1,false,'["00000000-0000-0000-0000-000000000002"]');
  if result->>'ok' <> 'true' then raise exception 'Owner share failed'; end if;
  perform set_config('test.uid','00000000-0000-0000-0000-000000000003',false);
  if exists(select 1 from invoice_docs where id=1) then raise exception 'Whole-org sharing not revoked'; end if;
  perform set_config('test.uid','00000000-0000-0000-0000-000000000002',false);
  if not exists(select 1 from invoice_doc_items where id=1) then raise exception 'Target cannot read invoice items'; end if;
  -- Positive delete checks: authorized author and admin retain write access.
  for actor in 1..2 loop
    perform set_config('test.uid',case when actor=1 then '00000000-0000-0000-0000-000000000001' else '00000000-0000-0000-0000-000000000004' end,false);
    delete from products where id=actor;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'Authorized delete blocked'; end if;
  end loop;
end $$;
reset role;
select 'All shared-record permission assertions passed' as result;
