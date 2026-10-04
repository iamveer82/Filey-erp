-- Actual installed RLS/helpers: staff authors must retain replacement authority
-- after an admin edits their document, and failed edits preserve the prior rows.
reset role;
update public.org_members set modules=null where user_id='b0000000-0000-4000-8000-000000000002'
  and org_id=(select org_id from public.profiles where id='b0000000-0000-4000-8000-000000000001');
set role authenticated;
set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
set request.jwt.claim.sub='b0000000-0000-4000-8000-000000000002';
do $$ declare kind text; child text; fk text; line jsonb; header jsonb; d bigint; n bigint; owner uuid:=auth.uid(); org text:=public.current_org(); denied boolean; begin
  if public.is_org_admin() then raise exception 'Generic author fixture must be ordinary staff'; end if;
  foreach kind in array array['invoice_docs','quotations','purchase_orders'] loop
    case kind
      when 'invoice_docs' then child:='invoice_doc_items';fk:='invoice_id';line:='{"description":"Original","qty":2,"unit_price":12.5}';header:='{"number":"GENERIC-INV","status":"draft","notes":"Original"}';
      when 'quotations' then child:='quotation_items';fk:='quotation_id';line:='{"product":"Original","qty":2,"rate":12.5}';header:='{"number":"GENERIC-QUOTE","status":"draft","notes":"Original"}';
      when 'purchase_orders' then child:='purchase_order_items';fk:='po_id';line:='{"description":"Original","quantity":2,"unit_cost":12.5}';header:='{"po_number":"GENERIC-PO","status":"draft","notes":"Original"}';
    end case;
    d:=public.filey_save_document(kind,header,jsonb_build_array(line));
    perform set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000001',false);
    perform public.filey_save_document(kind,'{"notes":"Admin edit"}',jsonb_build_array(line,line),d);
    execute format('select count(*) from public.%I where %I=$1 and user_id=$2 and org_id=$3',child,fk) into n using d,owner,org;
    if n<>2 then raise exception 'Admin created other-owned replacement lines: %',kind; end if;
    perform set_config('request.jwt.claim.sub',owner::text,false);
    perform public.filey_save_document(kind,'{"notes":"Author edit"}',jsonb_build_array(line),d);
    execute format('select count(*) from public.%I where %I=$1',child,fk) into n using d;
    if n<>1 then raise exception 'Original author retained admin lines while saving: %',kind; end if;
    denied:=false;
    begin perform public.filey_save_document(kind,'{"notes":"Must roll back"}',jsonb_build_array(line||jsonb_build_object('unknown_field','bad')),d);
    exception when raise_exception then denied:=true; end;
    if not denied then raise exception 'Unknown replacement accepted: %',kind; end if;
    execute format('select count(*) from public.%I where id=$1 and notes=''Author edit''',kind) into n using d;
    if n<>1 then raise exception 'Replacement failure modified header: %',kind; end if;
    execute format('select count(*) from public.%I where %I=$1',child,fk) into n using d;
    if n<>1 then raise exception 'Replacement failure lost original lines: %',kind; end if;
    if public.filey_document_lines_replaceable(kind,900001) then raise exception 'Foreign/absent parent helper exposed authority: %',kind; end if;
    if kind<>'quotations' then
      denied:=false;
      begin perform public.filey_save_document(kind,header||'{"status":"sent"}',jsonb_build_array(line));
      exception when insufficient_privilege then denied:=true; end;
      if not denied then raise exception 'Generic new document posting accepted: %',kind; end if;
      denied:=false;
      begin perform public.filey_save_document(kind,'{"status":"sent"}',jsonb_build_array(line),d);
      exception when insufficient_privilege then denied:=true; end;
      if not denied then raise exception 'Generic draft promotion accepted: %',kind; end if;
    end if;
  end loop;
  if public.filey_document_lines_replaceable('profiles',1) then raise exception 'Helper table whitelist bypassed'; end if;
end $$;
reset role;
-- Persisted malformed children are seeded as database owner to reproduce
-- historical/admin data ordinary RLS cannot create. No customer rows are used.
reset request.jwt.claim.sub;
insert into public.invoice_docs(id,user_id,org_id,number,status,notes)
  select 900071,'b0000000-0000-4000-8000-000000000002',org_id,'GENERIC-HIDDEN','draft','Keep hidden parent' from public.profiles where id='b0000000-0000-4000-8000-000000000001';
alter table public.invoice_doc_items disable trigger trg_invoice_doc_items_org;
insert into public.invoice_doc_items(invoice_id,user_id,org_id,description,qty,unit_price)
  select 900071,'b0000000-0000-4000-8000-000000000002',org_id,'Hidden foreign line',1,100 from public.org_members where user_id='b0000000-0000-4000-8000-000000000002' and role='owner' limit 1;
alter table public.invoice_doc_items enable trigger trg_invoice_doc_items_org;
insert into public.quotations(id,user_id,org_id,number,status,notes)
  select 900072,'b0000000-0000-4000-8000-000000000002',org_id,'GENERIC-CREATOR','draft','Keep creator parent' from public.profiles where id='b0000000-0000-4000-8000-000000000001';
insert into public.quotation_items(quotation_id,user_id,org_id,product,qty,rate)
  select 900072,'b0000000-0000-4000-8000-000000000001',org_id,'Other creator',1,100 from public.profiles where id='b0000000-0000-4000-8000-000000000001';
insert into public.quotations(id,user_id,org_id,number,status)
  select 900073,id,org_id,'GENERIC-PRIVATE-PARENT','draft' from public.profiles where id='b0000000-0000-4000-8000-000000000001';
insert into public.quotations(id,user_id,org_id,number,status)
  select 900074,user_id,org_id,'GENERIC-FOREIGN-PARENT','draft' from public.org_members where user_id='b0000000-0000-4000-8000-000000000002' and role='owner' limit 1;
update public.invoice_docs set status='sent' where number='GENERIC-INV';
update public.purchase_orders set status='received' where po_number='GENERIC-PO';
set role authenticated;
set request.jwt.claim.sub='b0000000-0000-4000-8000-000000000002';
do $$ declare denied boolean; kind text; n bigint; d bigint; begin
  if public.filey_document_lines_replaceable('quotations',900073) or public.filey_document_lines_replaceable('quotations',900074) then raise exception 'Private/foreign helper authority leaked'; end if;
  if exists(select 1 from public.invoice_doc_items where invoice_id=900071) then raise exception 'Hidden legacy fixture unexpectedly visible'; end if;
  foreach kind in array array['invoice_docs','quotations'] loop
    denied:=false;
    begin perform public.filey_save_document(kind,'{"notes":"Lost parent"}','[]',case when kind='invoice_docs' then 900071 else 900072 end);
    exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'Incompatible historical replacement accepted: %',kind; end if;
  end loop;
  foreach kind in array array['invoice_docs','purchase_orders'] loop
    execute format('select id from public.%I where %I=$1',kind,case when kind='invoice_docs' then 'number' else 'po_number' end) into d using case when kind='invoice_docs' then 'GENERIC-INV' else 'GENERIC-PO' end;
    denied:=false;
    begin perform public.filey_save_document(kind,'{"status":"draft","notes":"Unposted directly"}','[]',d);
    exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'Generic posted→draft replacement accepted: %',kind; end if;
  end loop;
end $$;
reset role;
do $$ begin
 if (select notes from public.invoice_docs where id=900071)<>'Keep hidden parent' or (select notes from public.quotations where id=900072)<>'Keep creator parent'
   or (select count(*) from public.invoice_doc_items where invoice_id=900071)<>1 or (select count(*) from public.quotation_items where quotation_id=900072)<>1 then raise exception 'Denied legacy replacement changed persisted rows'; end if;
 if has_function_privilege('anon','public.filey_document_lines_replaceable(text,bigint)','execute') or has_function_privilege('anon','public.filey_save_document(text,jsonb,jsonb,bigint)','execute') then raise exception 'Generic document helper/save anonymously accessible'; end if;
end $$;
update public.org_members set modules=array['team'] where user_id='b0000000-0000-4000-8000-000000000002'
 and org_id=(select org_id from public.profiles where id='b0000000-0000-4000-8000-000000000001');
set role authenticated;
do $$ begin if public.filey_document_lines_replaceable('quotations',900072) then raise exception 'Helper bypassed current module restriction'; end if; end $$;
reset role;
reset request.jwt.claim.sub;
reset request.jwt.claims;
select 'PASS: generic invoice/quote/PO original staff save after admin edit, atomic rollback, hidden/creator legacy denial, helper whitelist/privacy and finalized workflow boundary.';
