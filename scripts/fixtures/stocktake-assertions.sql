begin;
set local role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000001',true);
do $$ declare result numeric; request uuid := 'e0000000-0000-4000-8000-000000000001'; begin
  result := public.filey_record_stocktake(8001,12.5,10,request);
  if result<>12.5 then raise exception 'Fractional count was not preserved'; end if;
  -- The first response can be lost: its repeat must return the receipt.
  perform public.filey_record_stocktake(8001,12.5,10,request);
  if (select quantity from products where id=8001)<>12.5 then raise exception 'Repeated count changed stock'; end if;
  if (select count(*) from stock_movements where product_id=8001)<>1 then raise exception 'Repeated count duplicated movement'; end if;
  if (select qty from stock_movements where product_id=8001)<>2.5 then raise exception 'Wrong adjustment delta'; end if;
  update products set quantity=13.5 where id=8001;
  perform public.filey_record_stocktake(8001,12.5,10,request);
  if (select quantity from products where id=8001)<>13.5 then raise exception 'Old receipt overwrote newer stock'; end if;
  begin
    perform public.filey_record_stocktake(8001,14,10,request);
    raise exception 'Nonce payload mismatch accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.filey_record_stocktake(8002,12.5,10,request);
    raise exception 'Nonce target mismatch accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.filey_record_stocktake(8001,15,10,'e0000000-0000-4000-8000-000000000002');
    raise exception 'Concurrent stock change overwritten';
  exception when serialization_failure then null; end;
  if exists(select 1 from stocktake_requests where request_id='e0000000-0000-4000-8000-000000000002') then raise exception 'Rejected count left a receipt'; end if;
  begin
    perform public.filey_record_stocktake(8001,790.5,13.5,'e0000000-0000-4000-8000-000000000003');
    raise exception 'Movement failure accepted';
  exception when raise_exception then
    if sqlerrm<>'Fixture stock movement failure' then raise; end if;
  end;
  if (select quantity from products where id=8001)<>13.5 then raise exception 'Failed movement changed stock'; end if;
  if exists(select 1 from stocktake_requests where request_id='e0000000-0000-4000-8000-000000000003') then raise exception 'Failed movement left a receipt'; end if;
  if (select count(*) from stock_movements where product_id=8001)<>1 then raise exception 'Failed movement changed history'; end if;
  begin
    perform public.filey_record_stocktake(8001,12.1234,13.5,'e0000000-0000-4000-8000-000000000004');
    raise exception 'Excess precision accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.filey_record_stocktake(8001,'NaN',13.5,'e0000000-0000-4000-8000-000000000004');
    raise exception 'Non-finite quantity accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.filey_record_stocktake(8001,-1,13.5,'e0000000-0000-4000-8000-000000000004');
    raise exception 'Negative physical count accepted';
  exception when invalid_parameter_value then null; end;
  begin
    insert into stocktake_requests(request_id,user_id,org_id,product_id,expected_quantity,counted_quantity)
      values('e0000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000002','a',8001,13.5,14);
    raise exception 'Receipt forged for another user';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('test.uid','00000000-0000-0000-0000-000000000002',true);
do $$ begin
  if exists(select 1 from stocktake_requests) then raise exception 'Another user can see count receipts'; end if;
  begin
    perform public.filey_record_stocktake(8001,14,13.5,'e0000000-0000-4000-8000-000000000005');
    raise exception 'Shared reader changed stock';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into products(id,user_id,org_id,quantity) values
  (9002,'00000000-0000-0000-0000-000000000002','a',4),
  (9005,'00000000-0000-0000-0000-000000000005','b',4);
set local role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000002',true);
select public.filey_record_stocktake(9002,5,4,'e0000000-0000-4000-8000-000000000001');
select set_config('test.uid','00000000-0000-0000-0000-000000000005',true);
select public.filey_record_stocktake(9005,5,4,'e0000000-0000-4000-8000-000000000001');
do $$ begin
  begin
    perform public.filey_record_stocktake(8001,14,13.5,'e0000000-0000-4000-8000-000000000005');
    raise exception 'Cross-tenant stock changed';
  exception when insufficient_privilege then null; end;
  if (select count(*) from stocktake_requests)<>1 then raise exception 'Receipt scope crossed workspaces'; end if;
end $$;
reset role;
update org_members set modules='{}' where user_id='00000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000001',true);
do $$ begin
  begin
    perform public.filey_record_stocktake(8001,14,13.5,'e0000000-0000-4000-8000-000000000005');
    raise exception 'Forbidden inventory module allowed stocktake';
  exception when insufficient_privilege then null; end;
  if exists(select 1 from stocktake_requests) then raise exception 'Forbidden module read receipts'; end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon','public.filey_record_stocktake(bigint,numeric,numeric,uuid)','execute') then raise exception 'Anonymous stocktake allowed'; end if;
  if (select prosecdef from pg_proc where oid='public.filey_record_stocktake(bigint,numeric,numeric,uuid)'::regprocedure) then raise exception 'Stocktake bypasses RLS'; end if;
  if has_table_privilege('authenticated','public.stocktake_requests','UPDATE') or has_table_privilege('authenticated','public.stocktake_requests','DELETE') then raise exception 'Count receipts can be rewritten'; end if;
end $$;
rollback;
select 'PASS: stocktakes deduplicate lost acknowledgements, preserve fractions, reject changed stock, atomically log movements, and enforce user/org/module RLS.';
