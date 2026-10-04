-- Reserve automatic numbers under an organization lock. Historical duplicates
-- remain intact, but every new/renumbered document is checked under that lock.
begin;
create table if not exists public.document_number_reservations (
  org_id text not null, namespace text not null, request_id uuid not null,
  user_id uuid not null, pattern text not null, year integer not null,
  number text not null, created_at timestamptz not null default now(),
  primary key(org_id,namespace,request_id), unique(org_id,namespace,number)
);
alter table public.document_number_reservations enable row level security;
revoke all on public.document_number_reservations from public,anon,authenticated;

create or replace function public.filey_document_numbers(p_namespace text,p_org text)
returns table(number text, identity text, setting_id bigint)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_table text; v_column text; v_key text;
begin
  case p_namespace
    when 'invoice' then v_table:='invoice_docs'; v_column:='number';
    when 'quote' then v_table:='quotations'; v_column:='number';
    when 'purchase_order' then v_table:='purchase_orders'; v_column:='po_number';
    when 'sales_order' then v_table:='orders'; v_column:='order_number';
    when 'payment_receipt' then v_table:='payment_receipts'; v_column:='number';
    when 'letter' then v_key:='letters';
    when 'packaging_list' then v_key:='packaging_lists';
    when 'delivery_challan' then v_key:='delivery_challans';
    when 'declaration_letter' then v_key:='declaration_letters';
    else raise exception 'Unsupported number type';
  end case;
  if v_table is not null then
    return query execute format('select %I::text,id::text,null::bigint from public.%I where org_id=$1',v_column,v_table) using p_org;
  else
    return query select coalesce(r->'form'->>'number',r->>'number',r->>'ref'),r->>'id',s.id
      from public.app_settings s cross join lateral jsonb_array_elements(s.value::jsonb) r
      where s.org_id=p_org and s.key=v_key;
  end if;
end $$;
revoke all on function public.filey_document_numbers(text,text) from public,anon,authenticated;

create or replace function public.filey_reserve_document_number(
  p_kind text,p_pattern text,p_year integer,p_request uuid,p_actor uuid,p_org text
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_namespace text; v_module text; v_pattern text; v_token text; v_tokens text[];
  v_prefix text; v_suffix text; v_seq numeric; v_max numeric:=0; v_value text; v_digits text;
  v_saved public.document_number_reservations; v_uid uuid:=auth.uid();
begin
  if v_uid is null or v_uid is distinct from p_actor or public.current_org() is distinct from p_org
    or not exists(select 1 from public.org_members m where m.org_id=p_org and m.user_id=v_uid) then
    raise exception 'Document number workspace access denied' using errcode='42501';
  end if;
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
  if not public.filey_can_use(v_module) then raise exception 'Document module access denied' using errcode='42501'; end if;
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
revoke all on function public.filey_reserve_document_number(text,text,integer,uuid,uuid,text) from public,anon;
grant execute on function public.filey_reserve_document_number(text,text,integer,uuid,uuid,text) to authenticated;

create or replace function public.filey_document_number_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_new jsonb:=to_jsonb(new); v_old jsonb; v_namespace text:=tg_argv[0]; v_column text:=tg_argv[1];
  v_number text; v_org text:=v_new->>'org_id'; v_id text:=v_new->>'id';
begin
  if tg_op='UPDATE' then v_old:=to_jsonb(old); end if;
  v_number:=v_new->>v_column;
  if tg_op='UPDATE' and v_number is not distinct from v_old->>v_column and v_org is not distinct from v_old->>'org_id' then return new; end if;
  if v_org is null or v_number is null or btrim(v_number)='' or length(v_number)>160 or v_number~'[[:cntrl:]]' then raise exception 'A valid workspace document number is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('filey:number:'||v_org||':'||v_namespace,0));
  if exists(select 1 from public.filey_document_numbers(v_namespace,v_org) n where n.identity is distinct from v_id and lower(btrim(n.number))=lower(btrim(v_number))) then
    raise exception 'This document number is already in use. Choose another number.' using errcode='23505';
  end if;
  if auth.uid() is not null and exists(select 1 from public.document_number_reservations r
    where r.org_id=v_org and r.namespace=v_namespace and lower(btrim(r.number))=lower(btrim(v_number)) and r.user_id<>auth.uid()) then
    raise exception 'This document number is reserved by another user' using errcode='23505';
  end if;
  return new;
end $$;
revoke all on function public.filey_document_number_guard() from public,anon,authenticated;
do $$ declare s text[]; begin
  foreach s slice 1 in array array[
    ['invoice_docs','invoice','number'],['quotations','quote','number'],['purchase_orders','purchase_order','po_number'],
    ['orders','sales_order','order_number'],['payment_receipts','payment_receipt','number']
  ] loop
    execute format('drop trigger if exists zz_filey_document_number on public.%I',s[1]);
    execute format('create trigger zz_filey_document_number before insert or update on public.%I for each row execute function public.filey_document_number_guard(%L,%L)',s[1],s[2],s[3]);
  end loop;
end $$;

-- JSON-backed documents retain historical duplicate numbers unchanged. Newly
-- added or renamed record identities cannot introduce another duplicate.
create or replace function public.filey_setting_number_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_namespace text; v_records jsonb; v_old jsonb:='[]'::jsonb; r jsonb; other jsonb; v_number text; v_identity text;
begin
  v_namespace:=case new.key when 'letters' then 'letter' when 'packaging_lists' then 'packaging_list'
    when 'delivery_challans' then 'delivery_challan' when 'declaration_letters' then 'declaration_letter' end;
  if v_namespace is null then return new; end if;
  v_records:=new.value::jsonb;
  if jsonb_typeof(v_records)<>'array' or jsonb_array_length(v_records)>10000 or new.org_id is null then raise exception 'Invalid numbered document collection'; end if;
  if tg_op='UPDATE' and old.key=new.key and old.org_id is not distinct from new.org_id then v_old:=old.value::jsonb; end if;
  perform pg_advisory_xact_lock(hashtextextended('filey:number:'||new.org_id||':'||v_namespace,0));
  for r in select value from jsonb_array_elements(v_records) loop
    v_number:=coalesce(r->'form'->>'number',r->>'number',r->>'ref'); v_identity:=r->>'id';
    if (select count(*) from jsonb_array_elements(v_records) n where n->>'id' is not distinct from v_identity)>
      greatest(1,(select count(*) from jsonb_array_elements(v_old) o where o->>'id' is not distinct from v_identity)) then
      raise exception 'A document identity cannot be duplicated. Create a new document.' using errcode='23505';
    end if;
    if (select count(*) from jsonb_array_elements(v_old) o where o->>'id' is not distinct from v_identity and coalesce(o->'form'->>'number',o->>'number',o->>'ref') is not distinct from v_number)>=
      (select count(*) from jsonb_array_elements(v_records) n where n->>'id' is not distinct from v_identity and coalesce(n->'form'->>'number',n->>'number',n->>'ref') is not distinct from v_number) then continue; end if;
    if v_identity is null or btrim(v_identity)='' then raise exception 'A new document needs a valid identity'; end if;
    if v_number is null or btrim(v_number)='' or length(v_number)>160 or v_number~'[[:cntrl:]]' then raise exception 'A valid document number is required'; end if;
    if auth.uid() is not null and exists(select 1 from public.document_number_reservations n
      where n.org_id=new.org_id and n.namespace=v_namespace and lower(btrim(n.number))=lower(btrim(v_number)) and n.user_id<>auth.uid()) then
      raise exception 'This document number is reserved by another user' using errcode='23505';
    end if;
    if exists(select 1 from public.filey_document_numbers(v_namespace,new.org_id) n where (n.setting_id is distinct from new.id or n.identity is distinct from v_identity) and lower(btrim(n.number))=lower(btrim(v_number)))
      or (select count(*) from jsonb_array_elements(v_records) o where lower(btrim(coalesce(o->'form'->>'number',o->>'number',o->>'ref')))=lower(btrim(v_number)))>1 then
      raise exception 'This document number is already in use. Choose another number.' using errcode='23505';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.filey_setting_number_guard() from public,anon,authenticated;
drop trigger if exists zz_filey_setting_number on public.app_settings;
create trigger zz_filey_setting_number before insert or update on public.app_settings for each row execute function public.filey_setting_number_guard();
notify pgrst,'reload schema';
commit;
