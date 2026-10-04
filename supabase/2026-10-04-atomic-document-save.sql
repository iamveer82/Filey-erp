-- Atomic invoice/quote/purchase-order header and replacement lines. Caller RLS
-- remains authoritative; shared recipients cannot replace another author's lines.
begin;
-- Boolean-only authority check sees legacy lines hidden by ordinary RLS. A
-- non-admin cannot replace another creator's children; an admin may reconcile
-- same-org creators, but no caller can replace foreign/null-org footprints.
create or replace function public.filey_document_lines_replaceable(p_table text,p_id bigint)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_child text; v_key text; v_owner uuid; v_org text; v_module text; v_ok boolean;
begin
  if auth.uid() is null or not public.filey_is_workspace_member(public.current_org()) then return false; end if;
  case p_table
    when 'invoice_docs' then v_child:='invoice_doc_items'; v_key:='invoice_id';
      select user_id,org_id,case when doc_type='purchase' then 'purchase-invoices' else 'invoicing' end into v_owner,v_org,v_module from public.invoice_docs where id=p_id;
    when 'quotations' then v_child:='quotation_items'; v_key:='quotation_id'; v_module:='quoting';
      select user_id,org_id into v_owner,v_org from public.quotations where id=p_id;
    when 'purchase_orders' then v_child:='purchase_order_items'; v_key:='po_id'; v_module:='purchase-orders';
      select user_id,org_id into v_owner,v_org from public.purchase_orders where id=p_id;
    else return false;
  end case;
  if v_owner is null or v_org is distinct from public.current_org() or not public.filey_can_use(v_module)
    or (v_owner is distinct from auth.uid() and not public.is_org_admin()) then return false; end if;
  execute format('select not exists(select 1 from public.%I where %I=$1 and (org_id is distinct from $2 or (not public.is_org_admin() and user_id is distinct from $3)))',v_child,v_key)
    into v_ok using p_id,v_org,auth.uid();
  return v_ok;
end $$;
revoke all on function public.filey_document_lines_replaceable(text,bigint) from public,anon;
grant execute on function public.filey_document_lines_replaceable(text,bigint) to authenticated;
-- Header and replacement lines commit together; a rejected line preserves the original.
create or replace function public.filey_save_document(p_table text, p_header jsonb, p_items jsonb, p_id bigint default null)
returns bigint language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  item_table text; fk text; header jsonb; item jsonb; cols text; vals text;
  result_id bigint; ordinal integer := 0; allowed text[]; original_status text; original_author uuid; original_org text;
begin
  if auth.uid() is null then raise exception 'Sign in to save documents'; end if;
  case p_table
    when 'invoice_docs' then item_table := 'invoice_doc_items'; fk := 'invoice_id';
    when 'quotations' then item_table := 'quotation_items'; fk := 'quotation_id';
    when 'purchase_orders' then item_table := 'purchase_order_items'; fk := 'po_id';
    else raise exception 'Unsupported document type';
  end case;
  if p_header is null or p_items is null or jsonb_typeof(p_header) <> 'object' or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 or octet_length(p_header::text)+octet_length(p_items::text)>8388608 then
    raise exception 'Invalid document payload';
  end if;
  header := p_header - array['id','user_id','org_id','created_at','updated_at','shared','shared_with','share_token','stock_received'];
  select array_agg(column_name::text) into allowed from information_schema.columns where table_schema='public' and table_name=p_table;
  if exists(select 1 from jsonb_object_keys(header) k where not (k = any(allowed))) then raise exception 'Unknown document field'; end if;
  if p_id is not null then
    execute format('select id, status, user_id, org_id from public.%I where id=$1 for update', p_table) into result_id, original_status, original_author, original_org using p_id;
    if result_id is null or original_org is distinct from public.current_org() or (original_author is distinct from auth.uid() and not public.is_org_admin()) then raise exception 'Document not found or edit access denied' using errcode='42501'; end if;
    if not public.filey_document_lines_replaceable(p_table,p_id) then raise exception 'Historic document lines require ownership reconciliation before replacement' using errcode='42501'; end if;
    if p_table in ('invoice_docs','purchase_orders') and current_user<>'filey_workflow_executor'
      and (original_status is distinct from 'draft' or coalesce(header->>'status',original_status) is distinct from 'draft') then
      raise exception 'Use the document workflow to change a finalized invoice or purchase order' using errcode='42501'; end if;
    select string_agg(format('%I = (jsonb_populate_record(null::public.%I, $1)).%I', k, p_table, k), ',') into vals from jsonb_object_keys(header) k;
    if vals is not null then execute format('update public.%I set %s where id=$2 returning id',p_table,vals) into result_id using header,p_id; end if;
    if result_id is null then raise exception 'Document update denied'; end if;
    execute format('delete from public.%I where %I=$1',item_table,fk) using p_id;
  else
    if p_table in ('invoice_docs','purchase_orders') and current_user<>'filey_workflow_executor'
      and coalesce(header->>'status','draft') is distinct from 'draft' then
      raise exception 'Use the document workflow to finalize an invoice or purchase order' using errcode='42501'; end if;
    original_author:=auth.uid(); original_org:=public.current_org();
    select string_agg(format('%I', k), ','), string_agg(format('(jsonb_populate_record(null::public.%I,$1)).%I',p_table,k), ',') into cols,vals from jsonb_object_keys(header) k;
    if cols is null then raise exception 'Document header is required'; end if;
    execute format('insert into public.%I (%s) select %s returning id',p_table,cols,vals) into result_id using header;
  end if;
  select array_agg(column_name::text) into allowed from information_schema.columns where table_schema='public' and table_name=item_table;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item)<>'object' then raise exception 'Invalid document line'; end if;
    item := (item - array['id','user_id','org_id','created_at','updated_at','shared']) || jsonb_build_object(fk,result_id,'position',ordinal,'user_id',original_author,'org_id',original_org);
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

notify pgrst,'reload schema';
commit;
