-- Parse each document/header line once, including inline company artwork.
-- Repeating jsonb_populate_record for every field made real invoice saves exceed
-- the API statement timeout. Keep caller RLS, omitted-column defaults, atomic
-- replacement and existing function ownership/privileges unchanged.
begin;
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
    select string_agg(format('%I = r.%I', k, k), ',') into vals from jsonb_object_keys(header) k;
    if vals is not null then execute format('update public.%I d set %s from jsonb_populate_record(null::public.%I,$1) r where d.id=$2 returning d.id',p_table,vals,p_table) into result_id using header,p_id; end if;
    if result_id is null then raise exception 'Document update denied'; end if;
    execute format('delete from public.%I where %I=$1',item_table,fk) using p_id;
  else
    if p_table in ('invoice_docs','purchase_orders') and current_user<>'filey_workflow_executor'
      and coalesce(header->>'status','draft') is distinct from 'draft' then
      raise exception 'Use the document workflow to finalize an invoice or purchase order' using errcode='42501'; end if;
    original_author:=auth.uid(); original_org:=public.current_org();
    select string_agg(format('%I', k), ','), string_agg(format('r.%I',k), ',') into cols,vals from jsonb_object_keys(header) k;
    if cols is null then raise exception 'Document header is required'; end if;
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) r returning id',p_table,cols,vals,p_table) into result_id using header;
  end if;
  select array_agg(column_name::text) into allowed from information_schema.columns where table_schema='public' and table_name=item_table;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item)<>'object' then raise exception 'Invalid document line'; end if;
    item := (item - array['id','user_id','org_id','created_at','updated_at','shared']) || jsonb_build_object(fk,result_id,'position',ordinal,'user_id',original_author,'org_id',original_org);
    if exists(select 1 from jsonb_object_keys(item) k where not (k = any(allowed))) then raise exception 'Unknown line field'; end if;
    select string_agg(format('%I',k),','), string_agg(format('r.%I',k),',') into cols,vals from jsonb_object_keys(item) k;
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) r',item_table,cols,vals,item_table) using item;
    ordinal := ordinal + 1;
  end loop;
  return result_id;
end;
$$;
notify pgrst,'reload schema';
commit;
