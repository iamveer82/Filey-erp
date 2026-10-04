set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000001';
do $$ declare d bigint; before_count bigint; denied boolean; kind text; line jsonb; child text; fk text; begin
  foreach kind in array array['invoice_docs','quotations','purchase_orders'] loop
    case kind
      when 'invoice_docs' then child:='invoice_doc_items';fk:='invoice_id';line:='{"description":"Saved invoice line","qty":2,"unit_price":12.5,"tax_category":"S"}';
      when 'quotations' then child:='quotation_items';fk:='quotation_id';line:='{"product":"Saved quote line","qty":2,"rate":12.5}';
      when 'purchase_orders' then child:='purchase_order_items';fk:='po_id';line:='{"description":"Saved PO line","quantity":2,"unit_cost":12.5}';
    end case;
    d:=filey_save_document(kind,'{"name":"Atomic draft","notes":"Original","currency":"AED","shared":true,"user_id":"00000000-0000-0000-0000-000000000002"}',jsonb_build_array(line));
    execute format('select count(*) from %I where id=$1 and user_id=auth.uid() and org_id=current_org() and shared=false',kind) into before_count using d;
    if before_count<>1 then raise exception 'Atomic save changed authority fields: %',kind; end if;
    execute format('select count(*) from %I',kind) into before_count;
    denied:=false;
    begin perform filey_save_document(kind,'{"name":"Broken new draft"}',jsonb_build_array(line||case when kind='purchase_orders' then '{"quantity":"invalid"}'::jsonb else '{"qty":"invalid"}'::jsonb end));
    exception when invalid_text_representation then denied:=true; end;
    if not denied then raise exception 'Invalid numeric line accepted: %',kind; end if;
    execute format('select count(*)=$1 from %I',kind) into denied using before_count;
    if not denied then raise exception 'Failed create left orphan header: %',kind; end if;
    denied:=false;
    begin perform filey_save_document(kind,'{"notes":"Lost original"}',jsonb_build_array(line||jsonb_build_object('unknown_column','bad')),d);
    exception when raise_exception then denied:=true; end;
    if not denied then raise exception 'Invalid replacement line accepted: %',kind; end if;
    execute format('select count(*) from %I where id=$1 and notes=''Original''',kind) into before_count using d;
    if before_count<>1 then raise exception 'Failed replacement changed original header: %',kind; end if;
    execute format('select count(*) from %I where %I=$1',child,fk) into before_count using d;
    if before_count<>1 then raise exception 'Failed replacement lost original lines: %',kind; end if;
    perform filey_save_document(kind,'{"notes":"Updated"}',jsonb_build_array(line,line),d);
    execute format('select count(*) from %I where %I=$1',child,fk) into before_count using d;
    if before_count<>2 then raise exception 'Valid replacement did not replace atomically: %',kind; end if;
  end loop;
  d:=filey_save_document('invoice_docs','{"name":"E-invoice","einvoice":{"tax_category":"S","payment_means":"30"}}','[{"description":"Taxable","qty":1,"unit_price":100,"tax_category":"S"}]');
  if (select einvoice->>'payment_means' from invoice_docs where id=d)<>'30' then raise exception 'Invoice metadata was lost'; end if;
end $$;
set test.uid='00000000-0000-0000-0000-000000000002';
do $$ declare kind text; denied boolean; begin
  foreach kind in array array['invoice_docs','quotations','purchase_orders'] loop
    denied:=false;
    begin perform filey_save_document(kind,'{}','[]',1);
    exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'Shared recipient replaced lines with empty header: %',kind; end if;
  end loop;
end $$;
set test.uid='00000000-0000-0000-0000-000000000004';
select filey_save_document('invoice_docs','{"notes":"Admin repair"}','[{"description":"Repaired","qty":1,"unit_price":100}]',3);
reset role;
do $$ begin
  if has_function_privilege('anon','filey_save_document(text,jsonb,jsonb,bigint)','EXECUTE') then raise exception 'Anonymous document save executable'; end if;
  if exists(select 1 from pg_proc where oid='filey_save_document(text,jsonb,jsonb,bigint)'::regprocedure and prosecdef) then raise exception 'Save RPC bypasses RLS'; end if;
end $$;
select 'PASS: invoice/quote/PO create+replace rollback, formatting/tax data, authority fields, shared denial, admin and anonymous ACL.';
