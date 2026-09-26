-- One paged metadata request instead of one HTTP request per collection.
-- SECURITY INVOKER: the caller's existing grants and RLS remain authoritative.
begin;
create or replace function public.filey_sync_manifest(
  p_tables text[], p_offset integer default 0, p_limit integer default 1000
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare t text; rows jsonb; result jsonb:='{}'; version_column text;
begin
  if auth.uid() is null then raise insufficient_privilege; end if;
  if p_tables is null or cardinality(p_tables) not between 1 and 45
    or array_position(p_tables,null) is not null
    or p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 1000
    or not p_tables <@ array[
      'company_profile','app_settings','suppliers','crm_customers','products','orders','order_items',
      'invoice_docs','invoice_doc_items','work_items','invoice_payments','invoice_recurrence',
      'quotations','quotation_items','quotation_templates','purchase_orders','purchase_order_items',
      'po_payments','payment_receipts','accounts','expenses','transactions','advances','stock_movements',
      'employees','attendance','payroll','crm_leads','crm_people','crm_opportunities','crm_activities',
      'crm_notes','crm_tasks','follow_ups','entity_links','org_channels','org_messages','email_messages',
      'call_logs','tool_runs','user_folders','user_files','user_assets','email_optouts','campaigns'
    ]::text[] then raise exception 'Invalid sync manifest request'; end if;
  for t in select distinct unnest(p_tables) loop
    version_column:=case when exists(select 1 from pg_attribute
      where attrelid=to_regclass('public.'||t) and attname='updated_at' and not attisdropped)
      then 'updated_at' else 'null::timestamptz as updated_at' end;
    execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from '
      ||'(select id,sync_revision,%s from public.%I order by id limit $1 offset $2) r',version_column,t)
      into rows using p_limit,p_offset;
    result:=result||jsonb_build_object(t,rows);
  end loop;
  return result;
end $$;
revoke all on function public.filey_sync_manifest(text[],integer,integer) from public,anon;
grant execute on function public.filey_sync_manifest(text[],integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
