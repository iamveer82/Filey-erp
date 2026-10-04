set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000005';
do $$ begin
  if exists(select 1 from invoice_doc_items where id=80) then raise exception 'Inconsistent invoice child unexpectedly readable'; end if;
  if exists(select 1 from quotation_items where id=80) then raise exception 'Inconsistent quote child unexpectedly readable'; end if;
  if exists(select 1 from purchase_order_items where id=80) then raise exception 'Inconsistent PO child unexpectedly readable'; end if;
end $$;
reset role;
set role anon;
set test.uid='';
do $$ declare d jsonb; token uuid; denied boolean:=false; begin
  begin perform 1 from invoice_docs; exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Anon broad SELECT must be denied'; end if;
  d:=public.get_shared_doc('10000000-0000-4000-8000-000000000001');
  if not (d->'doc'->'shared_with' ? '00000000-0000-0000-0000-000000000002') then raise exception 'Member UUID baseline leak did not reproduce'; end if;
  foreach token in array array['10000000-0000-4000-8000-000000000001'::uuid,'10000000-0000-4000-8000-000000000002'::uuid,'10000000-0000-4000-8000-000000000003'::uuid] loop
    d:=public.get_shared_doc(token);
    if not exists(select 1 from jsonb_array_elements(d->'items') i where i->>'name'='private B line') then raise exception 'Foreign-child baseline leak did not reproduce'; end if;
  end loop;
  d:=public.get_shared_invoice('10000000-0000-4000-8000-000000000001');
  if not exists(select 1 from jsonb_array_elements(d->'items') i where i->>'name'='private B line') then raise exception 'Legacy invoice baseline leak did not reproduce'; end if;
end $$;
reset role;
select 'PASS: actual old public RPCs expose internal recipients and malformed foreign children despite caller RLS.';
