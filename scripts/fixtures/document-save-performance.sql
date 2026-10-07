-- Full installed workflow/RLS with synthetic inline artwork; no customer data.
-- Assert the execution shape instead of a wall-clock limit that varies by CI host.
do $$ declare definition text:=pg_get_functiondef('public.filey_save_document(text,jsonb,jsonb,bigint)'::regprocedure); begin
  if definition ~ '\(jsonb_populate_record\([^\n]+\)\)\.'
    or (select count(*) from regexp_matches(definition,'from jsonb_populate_record','g'))<>3 then
    raise exception 'Document conversion must run once per header/line, not once per column';
  end if;
end $$;
set role authenticated;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';
set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
do $$ declare
  artwork text; header jsonb; items jsonb; payload jsonb; result jsonb; replay jsonb;
  doc bigint; before_doc jsonb; before_items jsonb; request uuid:=gen_random_uuid(); failed_request uuid:=gen_random_uuid();
  kind text; child text; fk text; line jsonb; generic_header jsonb; generic_doc bigint; count_rows bigint;
begin
  select string_agg(md5(g::text),'') into artwork from generate_series(1,105831) g;
  header:=jsonb_build_object('number','LARGE-ARTWORK-INV','status','draft','template','minimal','accent','#222222',
    'currency','AED','seller_name','Synthetic Company','tax_country_code','AE','seller_address','Synthetic Address',
    'seller_trn','100000000000003','seller_email','seller@example.invalid','seller_phone','+971500000000',
    'logo',left(artwork,3159686),'stamp',jsonb_build_object('image',left(artwork,159012)),
    'signature',jsonb_build_object('image',left(artwork,67872)),
    'customer_name','Workflow customer','customer_id',910001,'customer_email','customer@example.invalid',
    'customer_address','Synthetic Address','customer_trn','100000000000003','issue_date','2026-09-23',
    'notes','Keep until updated','tax_rate',5,'discount',0,
    'custom_columns','[{"key":"liters","label":"T.Liters"}]'::jsonb,
    'unit_price_formula','{"a":"liters","b":"unit_price"}'::jsonb);
  items:='[{"description":"H/O 68 PAIL 20L","qty":50,"unit_price":0.20,"unit":"L","custom":{"liters":"1000"}},
    {"description":"15W40 PAIL 20L","qty":15,"unit_price":0.20,"unit":"L","custom":{"liters":"300"}},
    {"description":"20W50 PAIL 20L","qty":15,"unit_price":0.20,"unit":"L","custom":{"liters":"300"}}]';
  payload:=jsonb_build_object('header',header,'items',items);
  result:=public.filey_business_workflow('invoice','save',payload,request,auth.uid(),public.current_org());
  doc:=(result->>'id')::bigint;
  select to_jsonb(d) into before_doc from public.invoice_docs d where id=doc;
  select jsonb_agg(to_jsonb(i) order by position,id) into before_items from public.invoice_doc_items i where invoice_id=doc;
  if before_doc->>'logo' is distinct from header->>'logo' or before_doc->'stamp' is distinct from header->'stamp'
    or before_doc->'signature' is distinct from header->'signature' or jsonb_array_length(before_items)<>3
    or (public.filey_workflow_totals(before_doc,before_items)->>'total')::numeric<>336
    or before_doc->>'user_id' is distinct from auth.uid()::text or before_doc->>'org_id' is distinct from public.current_org()
    or before_doc->>'doc_type' is distinct from 'Tax Invoice' or before_doc->>'shared' is distinct from 'false' then
    raise exception 'Large artwork/custom quantities, ownership or omitted-column defaults changed';
  end if;
  replay:=public.filey_business_workflow('invoice','save',payload,request,auth.uid(),public.current_org());
  if replay is distinct from result or (select count(*) from public.invoice_docs where number='LARGE-ARTWORK-INV')<>1
    or (select count(*) from public.business_workflow_requests where request_id=request)<>1 then
    raise exception 'Large document replay duplicated its document or receipt';
  end if;
  payload:=jsonb_build_object('id',doc,'header',header||'{"notes":null}'::jsonb,'items',items);
  perform public.filey_business_workflow('invoice','save',payload,gen_random_uuid(),auth.uid(),public.current_org());
  select to_jsonb(d) into before_doc from public.invoice_docs d where id=doc;
  select jsonb_agg(to_jsonb(i) order by position,id) into before_items from public.invoice_doc_items i where invoice_id=doc;
  if before_doc->'notes' is distinct from 'null'::jsonb or before_doc->>'logo' is distinct from header->>'logo'
    or (public.filey_workflow_totals(before_doc,before_items)->>'total')::numeric<>336 then
    raise exception 'Large document update lost explicit null, artwork or custom pricing';
  end if;
  begin
    perform public.filey_business_workflow('invoice','save',jsonb_set(payload,'{items,2,unknown_column}','true'),
      failed_request,auth.uid(),public.current_org());
    raise exception 'Unknown replacement field accepted';
  exception when raise_exception then if sqlerrm<>'Unknown line field' then raise; end if; end;
  if (select to_jsonb(d) from public.invoice_docs d where id=doc) is distinct from before_doc
    or (select jsonb_agg(to_jsonb(i) order by position,id) from public.invoice_doc_items i where invoice_id=doc) is distinct from before_items
    or exists(select 1 from public.business_workflow_requests where request_id=failed_request) then
    raise exception 'Failed large replacement changed persisted header, lines or receipt';
  end if;
  -- The shared function also saves quotes and POs. Partial updates must keep
  -- omitted columns; explicit null must still clear a supplied field.
  foreach kind in array array['invoice_docs','quotations','purchase_orders'] loop
    case kind
      when 'invoice_docs' then child:='invoice_doc_items';fk:='invoice_id';line:='{"description":"Invoice","qty":2,"unit_price":12.5}';generic_header:='{"number":"DEFAULT-INV","notes":"Original"}';
      when 'quotations' then child:='quotation_items';fk:='quotation_id';line:='{"product":"Quote","qty":2,"rate":12.5}';generic_header:='{"number":"DEFAULT-QUOTE","notes":"Original"}';
      when 'purchase_orders' then child:='purchase_order_items';fk:='po_id';line:='{"description":"PO","quantity":2,"unit_cost":12.5}';generic_header:='{"po_number":"DEFAULT-PO","notes":"Original"}';
    end case;
    generic_doc:=public.filey_save_document(kind,generic_header,jsonb_build_array(line));
    perform public.filey_save_document(kind,'{"notes":null}',jsonb_build_array(line,line),generic_doc);
    execute format('select count(*) from public.%I where id=$1 and notes is null and status=''draft'' and shared=false and user_id=auth.uid() and org_id=public.current_org()',kind) into count_rows using generic_doc;
    if count_rows<>1 then raise exception 'Partial update lost defaults, null or ownership: %',kind; end if;
    execute format('select count(*) from public.%I where %I=$1',child,fk) into count_rows using generic_doc;
    if count_rows<>2 then raise exception 'Replacement line conversion failed: %',kind; end if;
  end loop;
end $$;
reset role;
select 'PASS: 3.4 MB artwork, custom T.Liters total, idempotent replay, update/null/default parity and atomic replacement rollback; invoice/quote/PO convert each payload once.';
