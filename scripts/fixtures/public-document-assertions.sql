set role anon;
set test.uid='';
do $$ declare d jsonb; legacy jsonb; token uuid; item jsonb; forbidden text; begin
  foreach token in array array['10000000-0000-4000-8000-000000000001'::uuid,'10000000-0000-4000-8000-000000000002'::uuid,'10000000-0000-4000-8000-000000000003'::uuid] loop
    d:=public.get_shared_doc(token);
    if jsonb_array_length(d->'items')<>1 or d->'items'->0->>'id'<>'1' then raise exception 'Foreign/null child leaked or valid customer line lost'; end if;
    item:=d->'items'->0;
    foreach forbidden in array array['user_id','org_id','share_token','shared_with'] loop
      if d->'doc' ? forbidden or item ? forbidden then raise exception 'Public authority metadata leaked: %',forbidden; end if;
    end loop;
    if item->>'qty'<>'2' or item->>'unit_price'<>'10'
      or item->'custom'->>'discount'<>'5' or item->'custom'->>'tax'<>'5'
      or item->'custom'->>'_filey_calc_mode'<>'formula'
      or item->'custom'->>'label'<>'customer field' then raise exception 'Customer calculation/custom metadata dropped'; end if;
  end loop;
  d:=public.get_shared_doc('10000000-0000-4000-8000-000000000001');
  if d->'doc'->'unit_price_formula'<>'{"a":"qty","b":"unit_price"}'::jsonb
    or d->'doc'->>'round_off'<>'true' or d->'doc'->'bank_details'->>'account'<>'customer-visible account' then raise exception 'Customer formula/roundoff/bank details lost'; end if;
  legacy:=public.get_shared_invoice('10000000-0000-4000-8000-000000000001');
  if legacy<>d-'doc_type' then raise exception 'Legacy/active invoice contract differs'; end if;
  d:=public.get_shared_doc('10000000-0000-4000-8000-000000000004');
  if d->>'doc_type'<>'receipt' or d->'items'<>'[{"description":"Customer deposit","qty":1,"unit_price":250}]'::jsonb
    or d->'doc'->>'notes'<>'Customer receipt terms' or d->'doc'->'stamp'<>'{"x":20,"y":30}'::jsonb then raise exception 'Receipt customer output changed'; end if;
  foreach forbidden in array array['user_id','org_id','share_token','shared_with'] loop
    if d->'doc' ? forbidden then raise exception 'Receipt authority leaked'; end if;
  end loop;
  if public.get_shared_doc('ffffffff-ffff-4fff-8fff-ffffffffffff') is not null
    or public.get_shared_invoice('ffffffff-ffff-4fff-8fff-ffffffffffff') is not null then raise exception 'Unknown token returned a document'; end if;
end $$;
reset role;
do $$ declare t text; token uuid; begin
  foreach t in array array['invoice_docs','quotations','purchase_orders','payment_receipts'] loop
    execute format('select share_token from %I where id=2',t) into token;
    if public.get_shared_doc(token) is not null then raise exception 'Unshared/targeted-only document exposed: %',t; end if;
    if t='invoice_docs' and public.get_shared_invoice(token) is not null then raise exception 'Unshared legacy invoice exposed'; end if;
  end loop;
  if not has_function_privilege('anon','public.get_shared_doc(uuid)','execute')
    or not has_function_privilege('authenticated','public.get_shared_doc(uuid)','execute')
    or not has_function_privilege('anon','public.get_shared_invoice(uuid)','execute') then raise exception 'Public share API ACL changed'; end if;
  if exists(select 1 from pg_proc p,aclexplode(p.proacl) a where p.oid in ('public.get_shared_doc(uuid)'::regprocedure,'public.get_shared_invoice(uuid)'::regprocedure) and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Unintended PUBLIC execute remains'; end if;
end $$;
set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000002';
do $$ begin
  if public.get_shared_doc('10000000-0000-4000-8000-000000000001')->'items'->0 ? 'shared_with' then raise exception 'Authenticated public output leaks authority'; end if;
end $$;
reset role;
select 'PASS: both public RPCs exclude foreign/null-org children and authority, retain customer totals/format/bank/receipt output, private token gates and anonymous ACL after repeat apply.';
