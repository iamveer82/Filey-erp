-- Run as actual authenticated identities, with real installed RLS/guards.
set role authenticated;
set request.jwt.claim.sub='b0000000-0000-4000-8000-000000000001';
set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
create temp table numbering_assertions(label text primary key);
grant select,insert on numbering_assertions to authenticated,anon;
create function pg_temp.check_number(p_label text,p_condition boolean) returns void
language plpgsql as $$ begin
  if not coalesce(p_condition,false) then raise exception 'Number assertion failed: %',p_label; end if;
  insert into numbering_assertions values(p_label);
end $$;
create function pg_temp.reject_number(p_label text,p_sql text,p_state text,p_message text default null) returns void
language plpgsql as $$ begin
  begin execute p_sql;
  exception when others then
    if sqlstate<>p_state or (p_message is not null and position(p_message in sqlerrm)=0) then raise; end if;
    insert into numbering_assertions values(p_label); return;
  end;
  raise exception 'Number operation unexpectedly succeeded: %',p_label;
end $$;
do $$ declare v_org text:=public.current_org(); v text; k text; table_row text[]; key_name text; coll jsonb; request uuid; begin
  perform pg_temp.reject_number('spoofed actor',format($q$select public.filey_reserve_document_number('invoice','AUTH-{001}',2026,gen_random_uuid(),'b0000000-0000-4000-8000-000000000002',%L)$q$,v_org),'42501','workspace access denied');
  perform pg_temp.reject_number('foreign workspace',$q$select public.filey_reserve_document_number('invoice','AUTH-{001}',2026,gen_random_uuid(),auth.uid(),'ffffffff-ffff-4fff-8fff-ffffffffffff')$q$,'42501','workspace access denied');
  perform pg_temp.reject_number('private raw reservations',$q$select * from public.document_number_reservations$q$,'42501');
  perform pg_temp.reject_number('private historical scan',format($q$select * from public.filey_document_numbers('invoice',%L)$q$,v_org),'42501');
  perform pg_temp.reject_number('changed replay pattern',format($q$select public.filey_reserve_document_number('invoice','OTHER-{0001}-{YY}',2026,'b1000000-0000-4000-8000-000000000001',auth.uid(),%L)$q$,v_org),'P0001','already used differently');
  perform pg_temp.reject_number('changed replay year',format($q$select public.filey_reserve_document_number('invoice','INV-{0001}-{YY}',2027,'b1000000-0000-4000-8000-000000000001',auth.uid(),%L)$q$,v_org),'P0001','already used differently');
  foreach k in array array['NOCOUNTER','{1}-{2}','{0000000000000}',E'INVALID\n{001}'] loop
    perform pg_temp.reject_number('invalid pattern '||k,format($q$select public.filey_reserve_document_number('invoice',%L,2026,gen_random_uuid(),auth.uid(),%L)$q$,k,v_org),'P0001');
  end loop;
  perform pg_temp.reject_number('invalid year',format($q$select public.filey_reserve_document_number('invoice','YEAR-{001}',1899,gen_random_uuid(),auth.uid(),%L)$q$,v_org),'P0001','Invalid');
  perform pg_temp.reject_number('safe integer exhaustion',format($q$select public.filey_reserve_document_number('invoice','SAFE-{1}',2026,gen_random_uuid(),auth.uid(),%L)$q$,v_org),'P0001','counter exhausted');
  perform pg_temp.reject_number('very large historical counter exhaustion',format($q$select public.filey_reserve_document_number('invoice','HUGE-{1}',2026,gen_random_uuid(),auth.uid(),%L)$q$,v_org),'P0001','counter exhausted');
  update public.invoice_docs set notes='Historical duplicate can still be edited' where id=910002;
  perform pg_temp.check_number('historical table duplicates retained',(select count(*)=2 from public.invoice_docs where number='LEGACY-DUP'));
  perform pg_temp.check_number('historical duplicate unchanged edit',(select notes='Historical duplicate can still be edited' from public.invoice_docs where id=910002));
  perform pg_temp.reject_number('normalized invoice insert',$q$insert into public.invoice_docs(number) values('  manual-001  ')$q$,'23505','already in use');
  perform pg_temp.reject_number('normalized invoice update',$q$update public.invoice_docs set number='  manual-001  ' where id=910005$q$,'23505','already in use');
  perform pg_temp.check_number('failed renumber preserved original',(select number='MANUAL-002' from public.invoice_docs where id=910005));
  foreach table_row slice 1 in array array[
    ['quotations','number','  q-manual-001  '],['purchase_orders','po_number','  po-manual-001  '],
    ['orders','order_number','  so-manual-001  '],['payment_receipts','number','  rcpt-manual-001  ']
  ] loop
    perform pg_temp.reject_number('normalized '||table_row[1]||' insert',format('insert into public.%I(%I) values(%L)',table_row[1],table_row[2],table_row[3]),'23505','already in use');
  end loop;
  update public.app_settings set value=jsonb_set(value::jsonb,'{0,form,title}','"Updated historical letter"')::text where id=910001;
  perform pg_temp.check_number('historical JSON duplicates retained',(select count(*)=2 from public.app_settings s cross join lateral jsonb_array_elements(s.value::jsonb) r where s.id=910001 and r->'form'->>'number'='LTR-DUP'));
  perform pg_temp.check_number('historical JSON unchanged edit',(select value::jsonb->0->'form'->>'title'='Updated historical letter' from public.app_settings where id=910001));
  perform pg_temp.reject_number('normalized JSON new record',$q$update public.app_settings set value=(value::jsonb||jsonb_build_array(jsonb_build_object('id','new','form',jsonb_build_object('number','  ltr-dup  ','blocks','[]'::jsonb))))::text where id=910001$q$,'23505','already in use');
  perform pg_temp.reject_number('normalized JSON renumber',$q$update public.app_settings set value=jsonb_set(value::jsonb,'{2,form,number}','"  ltr-dup  "')::text where id=910001$q$,'23505','already in use');
  perform pg_temp.reject_number('JSON duplicate existing identity',$q$update public.app_settings set value=(value::jsonb||jsonb_build_array(value::jsonb->0))::text where id=910001$q$,'23505');
  perform pg_temp.reject_number('JSON duplicate identity changed number',$q$update public.app_settings set value=(value::jsonb||jsonb_build_array(jsonb_set(value::jsonb->0,'{form,number}','"NEW-NUMBER"')))::text where id=910001$q$,'23505');
  v:=public.filey_reserve_document_number('letter','LTR-{0001}-{YY}',2026,gen_random_uuid(),auth.uid(),v_org);
  perform pg_temp.check_number('JSON historical number seeds allocator',v='LTR-0043-26');
  foreach key_name in array array['packaging_lists','delivery_challans','declaration_letters'] loop
    coll:=jsonb_build_array(jsonb_build_object('id','unique','number','JSON-'||key_name||'-001'));
    insert into public.app_settings(key,value) values(key_name,coll::text);
    perform pg_temp.reject_number('normalized collection '||key_name,format($q$update public.app_settings set value=(value::jsonb||jsonb_build_array(jsonb_build_object('id','other','number',%L)))::text where key=%L$q$,'  json-'||key_name||'-001  ',key_name),'23505','already in use');
  end loop;
end $$;
-- All nine kind/module mappings must work for a staff member with exactly that
-- module granted. Owners alone would mask a misspelled module identifier.
reset role;
update public.org_members set modules=array['team'] where user_id='b0000000-0000-4000-8000-000000000002'
  and org_id=(select org_id from public.profiles where id='b0000000-0000-4000-8000-000000000001');
set role authenticated;
set request.jwt.claim.sub='b0000000-0000-4000-8000-000000000002';
select pg_temp.reject_number('staff module denied',$q$select public.filey_reserve_document_number('invoice','STAFF-{001}',2026,gen_random_uuid(),auth.uid(),public.current_org())$q$,'42501','module access denied');
reset role;
do $$ declare pair text[]; v_org text:=(select org_id from public.profiles where id='b0000000-0000-4000-8000-000000000001'); result text; begin
  foreach pair slice 1 in array array[
    ['invoice','invoicing'],['purchase_invoice','purchase-invoices'],['quote','quoting'],
    ['purchase_order','purchase-orders'],['sales_order','orders'],['payment_receipt','payment-receipts'],
    ['letter','letters'],['packaging_list','packaging-list'],['delivery_challan','delivery-challans'],['declaration_letter','declaration']
  ] loop
    update public.org_members set modules=array[pair[2]] where user_id='b0000000-0000-4000-8000-000000000002' and org_id=v_org;
    perform set_config('role','authenticated',true);
    result:=public.filey_reserve_document_number(pair[1],'STAFF-'||pair[1]||'-{001}',2026,gen_random_uuid(),auth.uid(),v_org);
    perform pg_temp.check_number('staff module mapping '||pair[1],result='STAFF-'||pair[1]||'-001');
    if pair[1]='invoice' then
      perform pg_temp.reject_number('another actor reservation cannot be claimed',$q$insert into public.invoice_docs(number) values('  inv-0043-26  ')$q$,'23505','reserved by another user');
    end if;
    perform set_config('role','none',true);
  end loop;
end $$;
set role anon;
select pg_temp.reject_number('anonymous allocator denied',$q$select public.filey_reserve_document_number('invoice','ANON-{001}',2026,gen_random_uuid(),null,'default')$q$,'42501');
reset role;
select 'PASS: '||count(*)||' real numbering authority, format, normalized table/JSON collision, historical preservation and staff-module assertions.' from numbering_assertions;
reset request.jwt.claim.sub;
reset request.jwt.claims;
