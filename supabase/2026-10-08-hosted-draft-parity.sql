-- Hosted drafts share the app's numbering lock and saved invoice identity.
-- Existing documents and numbers are untouched; no data conversion is needed.
begin;
-- Private reservation algorithm called only after each entry point checks its
-- own authenticated or delegated authority. Client roles cannot call it.
create or replace function public.filey_reserve_document_number_internal(
  p_kind text,p_pattern text,p_year integer,p_request uuid,p_actor uuid,p_org text
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_namespace text; v_module text; v_pattern text; v_token text; v_tokens text[];
  v_prefix text; v_suffix text; v_seq numeric; v_max numeric:=0; v_value text; v_digits text;
  v_saved public.document_number_reservations; v_uid uuid:=p_actor;
begin
  if p_actor is null or nullif(btrim(p_org),'') is null then raise exception 'Document identity is required'; end if;
  case p_kind
    when 'invoice' then v_namespace:='invoice'; v_module:='invoicing';
    when 'purchase_invoice' then v_namespace:='invoice'; v_module:='purchase-invoices';
    when 'quote' then v_namespace:='quote'; v_module:='quoting';
    when 'purchase_order' then v_namespace:='purchase_order'; v_module:='purchase-orders';
    when 'sales_order' then v_namespace:='sales_order'; v_module:='orders';
    when 'payment_receipt' then v_namespace:='payment_receipt'; v_module:='payment-receipts';
    when 'letter' then v_namespace:='letter'; v_module:='letters';
    when 'packaging_list' then v_namespace:='packaging_list'; v_module:='packaging-list';
    when 'delivery_challan' then v_namespace:='delivery_challan'; v_module:='delivery-challans';
    when 'declaration_letter' then v_namespace:='declaration_letter'; v_module:='declaration';
    else raise exception 'Unsupported number type';
  end case;
  if p_request is null or p_pattern is null or length(p_pattern)>120 or p_pattern~'[[:cntrl:]]'
    or p_year is null or p_year not between 1900 and 9999 then raise exception 'Invalid document number format'; end if;
  select array_agg(x[1]) into v_tokens from regexp_matches(p_pattern,'\{([0-9]+)\}','g') x;
  if coalesce(array_length(v_tokens,1),0)<>1 or length(v_tokens[1])>12 then raise exception 'Number format needs one bounded counter'; end if;
  v_token:='{'||v_tokens[1]||'}';
  v_pattern:=regexp_replace(regexp_replace(p_pattern,'\{YYYY\}',p_year::text,'gi'),'\{YY\}',right(p_year::text,2),'gi');
  v_prefix:=split_part(v_pattern,v_token,1); v_suffix:=substr(v_pattern,length(v_prefix)+length(v_token)+1);
  perform pg_advisory_xact_lock(hashtextextended('filey:number:'||p_org||':'||v_namespace,0));
  select * into v_saved from public.document_number_reservations r
    where r.org_id=p_org and r.namespace=v_namespace and r.request_id=p_request;
  if found then
    if v_saved.user_id<>v_uid or v_saved.pattern<>p_pattern or v_saved.year<>p_year then raise exception 'Number request was already used differently'; end if;
    return v_saved.number;
  end if;
  for v_value in select n.number from public.filey_document_numbers(v_namespace,p_org) n
    union all select r.number from public.document_number_reservations r where r.org_id=p_org and r.namespace=v_namespace loop
    if lower(left(v_value,length(v_prefix)))=lower(v_prefix) and lower(right(v_value,length(v_suffix)))=lower(v_suffix)
      and length(v_value)>=length(v_prefix)+length(v_suffix)+1 then
      v_digits:=substr(v_value,length(v_prefix)+1,length(v_value)-length(v_prefix)-length(v_suffix));
      if v_digits~'^[0-9]{1,160}$' then v_max:=greatest(v_max,v_digits::numeric); end if;
    end if;
  end loop;
  v_seq:=greatest(v_max+1,greatest(v_tokens[1]::numeric,1));
  if v_seq>9007199254740991 then raise exception 'Document number counter exhausted'; end if;
  v_value:=v_prefix||lpad(v_seq::text,greatest(length(v_tokens[1]),length(v_seq::text)),'0')||v_suffix;
  if exists(select 1 from public.filey_document_numbers(v_namespace,p_org) n where lower(btrim(n.number))=lower(btrim(v_value))) then raise exception 'Document number collision'; end if;
  insert into public.document_number_reservations(org_id,namespace,request_id,user_id,pattern,year,number)
    values(p_org,v_namespace,p_request,v_uid,p_pattern,p_year,v_value);
  return v_value;
end $$;
revoke all on function public.filey_reserve_document_number_internal(text,text,integer,uuid,uuid,text) from public,anon,authenticated,service_role;

create or replace function public.filey_reserve_document_number(
  p_kind text,p_pattern text,p_year integer,p_request uuid,p_actor uuid,p_org text
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_module text;
begin
  if auth.uid() is null or auth.uid() is distinct from p_actor or public.current_org() is distinct from p_org
    or not exists(select 1 from public.org_members m where m.org_id=p_org and m.user_id=auth.uid()) then
    raise exception 'Document number workspace access denied' using errcode='42501';
  end if;
  v_module:=case p_kind when 'invoice' then 'invoicing' when 'purchase_invoice' then 'purchase-invoices'
    when 'quote' then 'quoting' when 'purchase_order' then 'purchase-orders' when 'sales_order' then 'orders'
    when 'payment_receipt' then 'payment-receipts' when 'letter' then 'letters' when 'packaging_list' then 'packaging-list'
    when 'delivery_challan' then 'delivery-challans' when 'declaration_letter' then 'declaration' end;
  if v_module is null then raise exception 'Unsupported number type'; end if;
  if not public.filey_can_use(v_module) then raise exception 'Document module access denied' using errcode='42501'; end if;
  return public.filey_reserve_document_number_internal(p_kind,p_pattern,p_year,p_request,p_actor,p_org);
end $$;
revoke all on function public.filey_reserve_document_number(text,text,integer,uuid,uuid,text) from public,anon;
grant execute on function public.filey_reserve_document_number(text,text,integer,uuid,uuid,text) to authenticated;

-- Match the app's readEInvoiceParty whitelist, including serialized customers.
create or replace function public.filey_channel_party_identity(p_value jsonb)
returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare v jsonb:=p_value;
begin
  if jsonb_typeof(v)='string' then
    begin v:=(v#>>'{}')::jsonb; exception when invalid_text_representation then return '{}'; end;
  end if;
  if jsonb_typeof(v) is distinct from 'object' then return '{}'; end if;
  return coalesce((select jsonb_object_agg(key,value) from jsonb_each(v) where
    key=any(array['corporate_trn','tin','endpoint_id','endpoint_scheme','legal_id','legal_id_type','legal_authority','identifier','phone'])
    and jsonb_typeof(value)='string'),'{}');
end $$;
revoke all on function public.filey_channel_party_identity(jsonb) from public,anon,authenticated,service_role;

create or replace function public.filey_channel_create_draft(
  p_owner uuid, p_org text, p_kind text, p_input jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id bigint; v_number text; v_name text; v_currency text;
  v_items jsonb; v_item jsonb; v_qty numeric; v_price numeric;
  v_tax numeric := 0; v_total numeric := 0; v_position integer := 0;
  v_allowed text[]; v_line_allowed text[]; v_supplier bigint;
  v_pattern text; v_number_kind text; v_company jsonb; v_customer jsonb; v_count integer;
  v_seller_identity jsonb:='{}'; v_buyer_identity jsonb:='{}'; v_legal_id text; v_legal_type text;
  v_columns jsonb:='[]'; v_price_by text:=''; v_keys text[]; v_multiplier numeric; v_field jsonb; v_label text;
  v_issue_date date:=current_date; v_due_date date; v_date_key text; v_date date;
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
    v_allowed := array['customer_name','customer_email','items','currency','tax_rate','custom_columns','price_by','issue_date','due_date','notes','terms'];
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
  if p_kind='invoice' then
    foreach v_date_key in array array['issue_date','due_date'] loop
      if not p_input ? v_date_key then continue; end if;
      if jsonb_typeof(p_input->v_date_key)<>'string' then raise exception 'Invoice dates must be YYYY-MM-DD' using errcode='22023'; end if;
      if v_date_key='due_date' and p_input->>v_date_key='' then continue; end if;
      if p_input->>v_date_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invoice dates must be YYYY-MM-DD' using errcode='22023'; end if;
      begin v_date:=(p_input->>v_date_key)::date;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'Invoice dates must be real calendar dates' using errcode='22023'; end;
      if v_date_key='issue_date' then v_issue_date:=v_date; else v_due_date:=v_date; end if;
    end loop;
    foreach v_date_key in array array['notes','terms'] loop
      if p_input ? v_date_key and (jsonb_typeof(p_input->v_date_key)<>'string' or length(p_input->>v_date_key)>4096) then
        raise exception 'Invoice notes and terms must be text within 4096 characters' using errcode='22023'; end if;
    end loop;
    v_columns:=coalesce(p_input->'custom_columns','[]');
    v_price_by:=coalesce(p_input->>'price_by','');
    if jsonb_typeof(v_columns)<>'array' or jsonb_array_length(v_columns)>12
      or (p_input ? 'price_by' and jsonb_typeof(p_input->'price_by')<>'string') then
      raise exception 'Invalid invoice calculation fields' using errcode='22023'; end if;
    for v_field in select value from jsonb_array_elements(v_columns) loop
      -- JavaScript trim() also removes non-ASCII whitespace. Match it so a
      -- heading accepted here cannot disappear when the editor sanitizes it.
      v_label:=lower(btrim(v_field->>'label', E' \t\n\r\f'||U&'\000B\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'));
      if jsonb_typeof(v_field)<>'object' or jsonb_typeof(v_field->'key') is distinct from 'string'
        or v_field->>'key' !~ '^[A-Za-z][A-Za-z0-9_]{0,39}$'
        or v_field->>'key'=any(array['description','qty','unit','unit_price','amount','tax','discount','product_id','id',
          '__calc_mode','__manual_amount','__formula_a','__formula_b'])
        or jsonb_typeof(v_field->'label') is distinct from 'string' or v_label='' or length(v_field->>'label')>80
        or v_label=any(array['description','qty','unit','unit price','amount','tax','discount'])
        or exists(select 1 from jsonb_object_keys(v_field) k where k not in ('key','label')) then
        raise exception 'Invalid invoice custom column' using errcode='22023'; end if;
    end loop;
    select coalesce(array_agg(value->>'key'),array[]::text[]) into v_keys from jsonb_array_elements(v_columns);
    if (select count(distinct k) from unnest(v_keys) k)<>cardinality(v_keys)
      or (v_price_by not in ('','qty') and not v_price_by=any(v_keys)) then
      raise exception 'Choose an existing unique invoice pricing column' using errcode='22023'; end if;
    -- Ambiguous presets must not select an arbitrary business. This is before
    -- allocation, so rejected inputs consume neither records nor numbers.
    select count(*),(jsonb_agg(to_jsonb(c))->0) into v_count,v_company from public.company_profile c where c.org_id=p_org;
    if v_count>1 then raise exception 'Multiple company profiles require review in Filey' using errcode='22023'; end if;
    select count(*),(jsonb_agg(to_jsonb(c))->0) into v_count,v_customer from public.crm_customers c where c.org_id=p_org
      and (lower(btrim(c.name))=lower(v_name) or lower(btrim(c.company))=lower(v_name));
    if v_count>1 then raise exception 'Multiple customers match this name. Choose the customer in Filey' using errcode='22023'; end if;
    v_currency:=upper(coalesce(p_input->>'currency',nullif(v_company->>'currency',''),'AED'));
    v_tax:=coalesce((p_input->>'tax_rate')::numeric,
      case when v_company->>'tax_type'='None' then 0 else (v_company->>'default_tax_rate')::numeric end,5);
    if v_tax not between 0 and 100 or v_currency !~ '^[A-Z]{3}$' then
      raise exception 'Company currency or tax defaults need review in Filey' using errcode='22023'; end if;
    if v_tax<>round(v_tax,3) then raise exception 'Invoice tax rate has unsupported precision; use at most three decimals' using errcode='22023'; end if;
    v_seller_identity:=public.filey_channel_party_identity(v_company->'einvoice');
    v_buyer_identity:=public.filey_channel_party_identity(v_customer->'custom_fields'->'einvoice_identity');
    v_legal_id:=coalesce(nullif(btrim(v_company->>'legal_id'),''),v_seller_identity->>'legal_id');
    v_legal_type:=coalesce(nullif(btrim(v_company->>'legal_id_type'),''),v_seller_identity->>'legal_id_type');
    v_seller_identity:=v_seller_identity||jsonb_strip_nulls(jsonb_build_object('legal_id',v_legal_id,'legal_id_type',v_legal_type));
    v_buyer_identity:=v_buyer_identity||jsonb_strip_nulls(jsonb_build_object('phone',coalesce(nullif(btrim(v_customer->>'phone'),''),v_customer->>'phone_e164')));
  end if;
  v_line_allowed := array['description','qty',case when p_kind='po' then 'unit_cost' else 'unit_price' end];
  if p_kind='invoice' then v_line_allowed:=v_line_allowed||array['unit','custom']; end if;
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
    v_multiplier:=v_qty;
    if p_kind='invoice' then
      if (v_item ? 'unit' and (jsonb_typeof(v_item->'unit')<>'string' or length(v_item->>'unit')>40))
        or (v_item ? 'custom' and jsonb_typeof(v_item->'custom')<>'object') then
        raise exception 'Invalid invoice unit or calculation fields' using errcode='22023'; end if;
      if exists(select 1 from jsonb_each(coalesce(v_item->'custom','{}')) f where
        not f.key=any(v_keys) or jsonb_typeof(f.value)<>'string' or length(f.value#>>'{}')>128) then
        raise exception 'Unsupported invoice custom field. Keep the original values and use Filey to review this invoice' using errcode='22023'; end if;
      if v_price_by not in ('','qty') then
        if coalesce(btrim(v_item->'custom'->>v_price_by),'') !~ '^[0-9]+([.][0-9]+)?$' then
          raise exception 'Every invoice line needs a numeric pricing multiplier' using errcode='22023'; end if;
        v_multiplier:=(v_item->'custom'->>v_price_by)::numeric;
        if v_multiplier>1000000000 then raise exception 'Invoice pricing multiplier is too large' using errcode='22023'; end if;
      end if;
    end if;
    -- Match Filey's document totals: round each line amount before summing.
    v_total := v_total + round(v_multiplier*v_price,2);
  end loop;
  v_total := round(v_total*(1+v_tax/100),2);
  if v_total>999999999999.99 then raise exception 'Draft total is too large' using errcode='22023'; end if;
  v_number_kind:=case p_kind when 'po' then 'purchase_order' else p_kind end;
  select value into v_pattern from public.app_settings where org_id=p_org and user_id=p_owner
    and key=case p_kind when 'invoice' then 'invoice_number_format' when 'quote' then 'quote_number_format' else 'purchase_order_number_format' end
    order by id limit 1;
  if v_pattern is null or v_pattern !~ '\{[0-9]+\}' then
    v_pattern:=case p_kind when 'invoice' then 'INV' when 'quote' then 'QT' else 'PO' end||'-{YYYY}-{0001}'; end if;
  -- Use the shared lock after the service-only gate and locked membership;
  -- never impersonate the owner by rewriting JWT claims.
  v_number:=public.filey_reserve_document_number_internal(v_number_kind,v_pattern,extract(year from current_date)::int,gen_random_uuid(),p_owner,p_org);
  if p_kind='invoice' then
    insert into public.invoice_docs(user_id,org_id,number,status,currency,customer_name,customer_email,customer_id,
      customer_address,customer_trn,buyer_city,buyer_country_subdivision,buyer_country_code,
      seller_name,seller_address,seller_trn,seller_email,seller_phone,seller_city,seller_country_subdivision,
      seller_legal_id,seller_legal_id_type,tax_country_code,einvoice,template,accent,logo,doc_type,tax_rate,issue_date,due_date,notes,terms,custom_columns,unit_price_formula)
    values(p_owner,p_org,v_number,'draft',v_currency,v_name,coalesce(p_input->>'customer_email',v_customer->>'email'),
      (v_customer->>'id')::bigint,v_customer->>'address',v_customer->>'trn',v_customer->>'city',
      v_customer->>'country_subdivision',v_customer->>'country_code',
      v_company->>'name',v_company->>'address',coalesce(nullif(btrim(v_company->>'trn'),''),v_company->>'vat_number'),
      v_company->>'email',v_company->>'phone',v_company->>'city',v_company->>'country_subdivision',
      v_legal_id,v_legal_type,v_company->>'country_code',
      jsonb_build_object('uuid',gen_random_uuid(),'seller',v_seller_identity,'buyer',v_buyer_identity),
      coalesce(nullif(v_company->>'default_template',''),'minimal'),coalesce(nullif(v_company->>'default_accent',''),'#222222'),
      v_company->>'logo','invoice',v_tax,v_issue_date,v_due_date,p_input->>'notes',p_input->>'terms',v_columns,
      case when v_price_by<>'' then jsonb_build_object('a',v_price_by,'b','unit_price') end) returning id into v_id;
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
      insert into public.invoice_doc_items(user_id,org_id,invoice_id,description,qty,unit_price,position,unit,custom)
      values(p_owner,p_org,v_id,trim(v_item->>'description'),v_qty,(v_item->>'unit_price')::numeric,v_position,v_item->>'unit',v_item->'custom');
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
