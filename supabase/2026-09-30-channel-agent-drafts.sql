-- Hosted relay only: draft header, lines and audit trail commit together.
-- Apply before deploying the hardened channel-webhook. No customer rows change.
begin;
create or replace function public.filey_channel_create_draft(
  p_owner uuid, p_org text, p_kind text, p_input jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id bigint; v_number text; v_name text; v_currency text;
  v_items jsonb; v_item jsonb; v_qty numeric; v_price numeric;
  v_tax numeric := 0; v_total numeric := 0; v_position integer := 0;
  v_allowed text[]; v_line_allowed text[]; v_supplier bigint;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Hosted agent access required' using errcode='42501';
  end if;
  -- Service role bypasses RLS: pin the current workspace and active admin
  -- membership, and hold both rows until the document transaction commits.
  perform 1 from public.profiles p join public.org_members m
    on m.user_id=p.id and m.org_id=p.org_id
    where p.id=p_owner and p.org_id=p_org and m.role in ('owner','admin')
    for share of p,m;
  if not found then raise exception 'Workspace access denied' using errcode='42501'; end if;
  if p_kind='invoice' then
    v_allowed := array['customer_name','customer_email','items','currency','tax_rate'];
  elsif p_kind='quote' then
    v_allowed := array['customer_name','items','currency'];
  elsif p_kind='po' then
    v_allowed := array['supplier_name','items','currency'];
  else raise exception 'Unsupported draft type' using errcode='22023'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object'
    or exists(select 1 from jsonb_object_keys(p_input) k where not k=any(v_allowed)) then
    raise exception 'Invalid draft fields' using errcode='22023';
  end if;
  v_name := trim(p_input->>case when p_kind='po' then 'supplier_name' else 'customer_name' end);
  v_currency := upper(coalesce(p_input->>'currency','AED'));
  v_items := p_input->'items';
  if jsonb_typeof(p_input->case when p_kind='po' then 'supplier_name' else 'customer_name' end) is distinct from 'string'
    or (p_input ? 'currency' and jsonb_typeof(p_input->'currency')<>'string')
    or v_name is null or length(v_name) not between 1 and 200 or v_currency !~ '^[A-Z]{3}$'
    or v_items is null or jsonb_typeof(v_items)<>'array' then
    raise exception 'Invalid draft name, currency or items' using errcode='22023';
  end if;
  if jsonb_array_length(v_items) not between 1 and 30 then
    raise exception 'A draft needs 1 to 30 lines' using errcode='22023';
  end if;
  if p_kind='invoice' then
    if p_input ? 'tax_rate' and jsonb_typeof(p_input->'tax_rate')<>'number' then raise exception 'Invalid tax rate' using errcode='22023'; end if;
    v_tax := coalesce((p_input->>'tax_rate')::numeric,5);
    if v_tax not between 0 and 100 then raise exception 'Invalid tax rate' using errcode='22023'; end if;
    if p_input ? 'customer_email' and (jsonb_typeof(p_input->'customer_email')<>'string'
      or length(p_input->>'customer_email')>200) then raise exception 'Invalid customer email' using errcode='22023'; end if;
  end if;
  v_line_allowed := array['description','qty',case when p_kind='po' then 'unit_cost' else 'unit_price' end];
  for v_item in select value from jsonb_array_elements(v_items) loop
    if jsonb_typeof(v_item)<>'object'
      or exists(select 1 from jsonb_object_keys(v_item) k where not k=any(v_line_allowed))
      or jsonb_typeof(v_item->'description') is distinct from 'string'
      or length(trim(v_item->>'description')) not between 1 and 300
      or jsonb_typeof(v_item->case when p_kind='po' then 'unit_cost' else 'unit_price' end) is distinct from 'number'
      or (v_item ? 'qty' and jsonb_typeof(v_item->'qty')<>'number') then
      raise exception 'Invalid draft line' using errcode='22023';
    end if;
    v_qty := coalesce((v_item->>'qty')::numeric,1);
    v_price := (v_item->>case when p_kind='po' then 'unit_cost' else 'unit_price' end)::numeric;
    if v_qty not between 0.001 and 1000000 or v_price not between 0 and 1000000000 then
      raise exception 'Invalid draft quantity or price' using errcode='22023';
    end if;
    -- Numeric columns retain 3 quantity decimals and 2 price decimals. Do
    -- not report a total from values that would be rounded on insertion.
    if v_qty<>round(v_qty,3) or v_price<>round(v_price,2) then
      raise exception 'Draft quantity or price has unsupported precision' using errcode='22023';
    end if;
    -- Match Filey's document totals: round each line amount before summing.
    v_total := v_total + round(v_qty*v_price,2);
  end loop;
  v_total := round(v_total*(1+v_tax/100),2);
  if v_total>999999999999.99 then raise exception 'Draft total is too large' using errcode='22023'; end if;
  v_number := (case p_kind when 'invoice' then 'INV' when 'quote' then 'Q' else 'PO' end)
    || '-' || extract(year from current_date)::text || '-A' || left(replace(gen_random_uuid()::text,'-',''),12);
  if p_kind='invoice' then
    insert into public.invoice_docs(user_id,org_id,number,status,currency,customer_name,customer_email,doc_type,tax_rate,issue_date)
    values(p_owner,p_org,v_number,'draft',v_currency,v_name,nullif(p_input->>'customer_email',''),'invoice',v_tax,current_date) returning id into v_id;
  elsif p_kind='quote' then
    insert into public.quotations(user_id,org_id,number,status,currency,customer_name,quote_date)
    values(p_owner,p_org,v_number,'draft',v_currency,v_name,current_date) returning id into v_id;
  else
    -- Exact, unique supplier match only; never choose the first fuzzy match.
    select min(id) into v_supplier from public.suppliers where org_id=p_org and lower(name)=lower(v_name) having count(*)=1;
    insert into public.purchase_orders(user_id,org_id,po_number,status,currency,supplier_id,supplier_name,total,order_date)
    values(p_owner,p_org,v_number,'draft',v_currency,v_supplier,v_name,v_total,current_date) returning id into v_id;
  end if;
  for v_item in select value from jsonb_array_elements(v_items) loop
    v_qty := coalesce((v_item->>'qty')::numeric,1);
    if p_kind='invoice' then
      insert into public.invoice_doc_items(user_id,org_id,invoice_id,description,qty,unit_price,position)
      values(p_owner,p_org,v_id,trim(v_item->>'description'),v_qty,(v_item->>'unit_price')::numeric,v_position);
    elsif p_kind='quote' then
      insert into public.quotation_items(user_id,org_id,quotation_id,product,qty,rate,position)
      values(p_owner,p_org,v_id,trim(v_item->>'description'),v_qty,(v_item->>'unit_price')::numeric,v_position);
    else
      insert into public.purchase_order_items(user_id,org_id,po_id,description,quantity,unit_cost,position)
      values(p_owner,p_org,v_id,trim(v_item->>'description'),v_qty,(v_item->>'unit_cost')::numeric,v_position);
    end if;
    v_position := v_position+1;
  end loop;
  insert into public.audit_log(user_id,actor,action,entity,details)
    values(p_owner,'agent','agent.create_draft_'||p_kind,p_kind||':'||v_id,v_number||' saved as a draft');
  return jsonb_build_object('created','draft','id',v_id,'number',v_number,'total',v_total,'currency',v_currency,
    'note','Draft saved in Filey for review. It has not been sent.');
end;
$$;
revoke all on function public.filey_channel_create_draft(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.filey_channel_create_draft(uuid,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
