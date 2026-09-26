begin;
select set_config('request.jwt.claim.sub', (select user_id::text from public.org_members where role='owner' order by created_at limit 1), true);
set local role authenticated;
do $$
declare pid bigint; poid bigint; qid bigint; qty numeric; test_number text := 'VERIFY-'||gen_random_uuid()::text;
begin
  insert into public.products(sku,name,quantity,cost_price,unit_price,reorder_level) values(test_number,'Verification only',10,4,8,2) returning id into pid;
  poid := public.filey_save_document('purchase_orders',jsonb_build_object('po_number',test_number,'status','draft','currency','AED','total',10,'order_date',current_date),jsonb_build_array(jsonb_build_object('product_id',pid,'description','Verification item','quantity',2.5,'unit_cost',4)));
  begin
    perform public.filey_save_document('purchase_orders',jsonb_build_object('total',99),jsonb_build_array(jsonb_build_object('description','Bad line','quantity','invalid','unit_cost',4)),poid);
    raise exception 'Invalid line was accepted';
  exception when invalid_text_representation then null;
  end;
  if (select total from public.purchase_orders where id=poid)<>10 then raise exception 'Failed save changed the header'; end if;
  if (select count(*) from public.purchase_order_items where po_id=poid)<>1 then raise exception 'Failed save lost the original lines'; end if;
  perform public.filey_receive_purchase_order(poid,1);
  perform public.filey_receive_purchase_order(poid,1);
  select quantity into qty from public.products where id=pid;
  if qty<>12.5 then raise exception 'Repeated receipt duplicated stock: %',qty; end if;
  if (select count(*) from public.stock_movements where product_id=pid)<>1 then raise exception 'Repeated receipt duplicated movement'; end if;
  qid := public.filey_save_document('quotations',jsonb_build_object('number',test_number,'status','draft','quote_date',current_date),jsonb_build_array(jsonb_build_object('product','Verified item','qty',2,'rate',10,'discount',0,'tax',0)));
  perform public.filey_save_document('quotations',jsonb_build_object('customer_name','Verification updated'),jsonb_build_array(jsonb_build_object('product','Replacement item','qty',3,'rate',10,'discount',0,'tax',0)),qid);
  if (select count(*) from public.quotation_items where quotation_id=qid)<>1 then raise exception 'Quotation replacement duplicated lines'; end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon','public.filey_save_document(text,jsonb,jsonb,bigint)','execute') then raise exception 'Anonymous save allowed'; end if;
  if has_function_privilege('anon','public.filey_receive_purchase_order(bigint,numeric)','execute') then raise exception 'Anonymous receive allowed'; end if;
end $$;
rollback;
