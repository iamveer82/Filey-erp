begin;

-- A quote converts once. Header, lines and accepted status commit together.
-- Existing invoice duplicates are preserved; repeat conversion returns the oldest.
create or replace function public.filey_convert_quotation(
  p_id bigint, p_header jsonb, p_items jsonb, p_updated_at timestamptz default null
) returns bigint language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  source public.quotations%rowtype;
  result_id bigint; header jsonb; item jsonb; cols text; vals text;
  allowed text[]; ordinal integer := 0;
begin
  if auth.uid() is null then raise exception 'Sign in to convert quotations'; end if;
  select * into source from public.quotations
    where id=p_id and org_id is not distinct from public.current_org() for update;
  if not found then raise exception 'Quotation not found or access denied'; end if;
  select id into result_id from public.invoice_docs where quotation_id=p_id order by id limit 1;
  if result_id is not null then return result_id; end if;
  if source.updated_at is distinct from p_updated_at then raise exception 'Quotation changed. Refresh before converting'; end if;
  if p_header is null or jsonb_typeof(p_header)<>'object' or p_items is null or jsonb_typeof(p_items)<>'array'
    or jsonb_array_length(p_items) not between 1 and 500 then raise exception 'Invalid invoice payload'; end if;
  header := (p_header - array['id','user_id','org_id','created_at','updated_at','shared','shared_with','share_token'])
    || jsonb_build_object('quotation_id',p_id,'status','draft','doc_type','invoice','customer_id',source.customer_id);
  select array_agg(column_name::text) into allowed from information_schema.columns where table_schema='public' and table_name='invoice_docs';
  if exists(select 1 from jsonb_object_keys(header) k where not(k=any(allowed))) then raise exception 'Unknown invoice field'; end if;
  select string_agg(format('%I',k),','), string_agg(format('(jsonb_populate_record(null::public.invoice_docs,$1)).%I',k),',') into cols,vals from jsonb_object_keys(header) k;
  execute format('insert into public.invoice_docs (%s) select %s returning id',cols,vals) into result_id using header;
  select array_agg(column_name::text) into allowed from information_schema.columns where table_schema='public' and table_name='invoice_doc_items';
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item)<>'object' then raise exception 'Invalid invoice line'; end if;
    item := (item - array['id','user_id','org_id','created_at','updated_at','shared']) || jsonb_build_object('invoice_id',result_id,'position',ordinal);
    if exists(select 1 from jsonb_object_keys(item) k where not(k=any(allowed))) then raise exception 'Unknown invoice line field'; end if;
    select string_agg(format('%I',k),','), string_agg(format('(jsonb_populate_record(null::public.invoice_doc_items,$1)).%I',k),',') into cols,vals from jsonb_object_keys(item) k;
    execute format('insert into public.invoice_doc_items (%s) select %s',cols,vals) using item;
    ordinal := ordinal+1;
  end loop;
  update public.quotations set status='accepted' where id=p_id;
  if not found then raise exception 'Quotation update denied'; end if;
  return result_id;
end;
$$;
revoke all on function public.filey_convert_quotation(bigint,jsonb,jsonb,timestamptz) from public, anon;
grant execute on function public.filey_convert_quotation(bigint,jsonb,jsonb,timestamptz) to authenticated;
notify pgrst, 'reload schema';
commit;
