begin;
alter table public.purchase_orders add column if not exists stock_received boolean not null default false;
update public.purchase_orders set stock_received=true where status='received' and not stock_received;

-- Header and replacement lines commit together; a rejected line preserves the original.
create or replace function public.filey_save_document(p_table text, p_header jsonb, p_items jsonb, p_id bigint default null)
returns bigint language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  item_table text; fk text; header jsonb; item jsonb; cols text; vals text;
  result_id bigint; ordinal integer := 0; allowed text[]; original_status text;
begin
  if auth.uid() is null then raise exception 'Sign in to save documents'; end if;
  case p_table
    when 'quotations' then item_table := 'quotation_items'; fk := 'quotation_id';
    when 'purchase_orders' then item_table := 'purchase_order_items'; fk := 'po_id';
    else raise exception 'Unsupported document type';
  end case;
  if p_header is null or p_items is null or jsonb_typeof(p_header) <> 'object' or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then
    raise exception 'Invalid document payload';
  end if;
  header := p_header - array['id','user_id','org_id','created_at','updated_at','shared','shared_with','share_token','stock_received'];
  select array_agg(column_name::text) into allowed from information_schema.columns where table_schema='public' and table_name=p_table;
  if exists(select 1 from jsonb_object_keys(header) k where not (k = any(allowed))) then raise exception 'Unknown document field'; end if;
  if p_id is not null then
    execute format('select id, status from public.%I where id=$1 for update', p_table) into result_id, original_status using p_id;
    if result_id is null then raise exception 'Document not found or access denied'; end if;
    select string_agg(format('%I = (jsonb_populate_record(null::public.%I, $1)).%I', k, p_table, k), ',') into vals from jsonb_object_keys(header) k;
    if vals is not null then execute format('update public.%I set %s where id=$2 returning id',p_table,vals) into result_id using header,p_id; end if;
    if result_id is null then raise exception 'Document update denied'; end if;
    execute format('delete from public.%I where %I=$1',item_table,fk) using p_id;
  else
    select string_agg(format('%I', k), ','), string_agg(format('(jsonb_populate_record(null::public.%I,$1)).%I',p_table,k), ',') into cols,vals from jsonb_object_keys(header) k;
    if cols is null then raise exception 'Document header is required'; end if;
    execute format('insert into public.%I (%s) select %s returning id',p_table,cols,vals) into result_id using header;
  end if;
  select array_agg(column_name::text) into allowed from information_schema.columns where table_schema='public' and table_name=item_table;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item)<>'object' then raise exception 'Invalid document line'; end if;
    item := (item - array['id','user_id','org_id','created_at','updated_at','shared']) || jsonb_build_object(fk,result_id,'position',ordinal);
    if exists(select 1 from jsonb_object_keys(item) k where not (k = any(allowed))) then raise exception 'Unknown line field'; end if;
    select string_agg(format('%I',k),','), string_agg(format('(jsonb_populate_record(null::public.%I,$1)).%I',item_table,k),',') into cols,vals from jsonb_object_keys(item) k;
    execute format('insert into public.%I (%s) select %s',item_table,cols,vals) using item;
    ordinal := ordinal + 1;
  end loop;
  return result_id;
end;
$$;
revoke all on function public.filey_save_document(text,jsonb,jsonb,bigint) from public, anon;
grant execute on function public.filey_save_document(text,jsonb,jsonb,bigint) to authenticated;

-- Receive once under a row lock. Stock, cost and movement history commit together.
create or replace function public.filey_receive_purchase_order(p_id bigint, p_fx numeric default 1)
returns bigint language plpgsql security invoker set search_path = public, pg_temp as $$
declare po public.purchase_orders%rowtype; line record; product public.products%rowtype; new_cost numeric;
begin
  if auth.uid() is null then raise exception 'Sign in to receive stock'; end if;
  if p_fx is null or p_fx <= 0 or p_fx::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid exchange rate'; end if;
  select * into po from public.purchase_orders where id=p_id for update;
  if not found then raise exception 'Purchase order not found or access denied'; end if;
  if po.status='received' or po.stock_received then return po.id; end if;
  if po.status='cancelled' then raise exception 'A cancelled purchase order cannot be received'; end if;
  for line in select * from public.purchase_order_items where po_id=p_id order by product_id,id loop
    if line.quantity <= 0 or line.quantity is null or line.quantity::text in ('NaN','Infinity','-Infinity') or line.unit_cost is null or line.unit_cost < 0 or line.unit_cost::text in ('NaN','Infinity','-Infinity') then raise exception 'Receipt quantities must be positive'; end if;
    if line.product_id is null then continue; end if;
    select * into product from public.products where id=line.product_id for update;
    if not found then raise exception 'Linked product not found or access denied'; end if;
    new_cost := case when product.cost_price>0 and product.quantity>0
      then round((product.quantity*product.cost_price+line.quantity*line.unit_cost*p_fx)/(product.quantity+line.quantity),2)
      else round(line.unit_cost*p_fx,2) end;
    update public.products set quantity=coalesce(quantity,0)+line.quantity, cost_price=new_cost where id=product.id;
    if not found then raise exception 'Product update denied'; end if;
    insert into public.stock_movements(product_id,qty,type,ref,moved_at) values(product.id,line.quantity,'purchase','PO '||po.po_number,now());
  end loop;
  update public.purchase_orders set status='received', stock_received=true where id=po.id;
  if not found then raise exception 'Purchase order update denied'; end if;
  return po.id;
end;
$$;
revoke all on function public.filey_receive_purchase_order(bigint,numeric) from public, anon;
grant execute on function public.filey_receive_purchase_order(bigint,numeric) to authenticated;
notify pgrst, 'reload schema';
commit;
