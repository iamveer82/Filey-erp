-- Version every synchronized row, including updates made directly by web clients.
-- Existing IDs/content are preserved. Apply after shared-record-permissions.
begin;
create or replace function public.version_synced_record() returns trigger
language plpgsql set search_path = public as $$
begin
  new.sync_revision := case when TG_OP = 'INSERT' then 1 else old.sync_revision + 1 end;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array[
    'company_profile','app_settings','suppliers','crm_customers','products','orders','order_items',
    'invoice_docs','invoice_doc_items','work_items','invoice_payments','invoice_recurrence',
    'quotations','quotation_items','quotation_templates','purchase_orders','purchase_order_items',
    'po_payments','payment_receipts','accounts','expenses','transactions','advances','stock_movements',
    'employees','attendance','payroll','crm_leads','crm_people','crm_opportunities','crm_activities',
    'crm_notes','crm_tasks','follow_ups','entity_links','org_channels','org_messages','email_messages',
    'call_logs','tool_runs','user_folders','user_files','user_assets','email_optouts','campaigns'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I add column if not exists sync_revision bigint not null default 1',t);
    execute format('drop trigger if exists sync_revision on public.%I',t);
    execute format('create trigger sync_revision before insert or update on public.%I for each row execute function public.version_synced_record()',t);
  end loop;
end $$;

-- SECURITY INVOKER retains all table/RLS permissions. No service-role bypass.
-- Lock/read/compare/write is one transaction, not a racing browser preflight.
create or replace function public.sync_record(
  p_table text, p_row jsonb, p_expected bigint default null, p_delete boolean default false
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  current_row jsonb;
  saved jsonb;
  normalized jsonb;
  payload jsonb := p_row - array['sync_revision','user_id','org_id'];
  columns_sql text;
  values_sql text;
begin
  if auth.uid() is null then raise insufficient_privilege; end if;
  if p_table <> all(array[
    'company_profile','app_settings','suppliers','crm_customers','products','orders','order_items',
    'invoice_docs','invoice_doc_items','work_items','invoice_payments','invoice_recurrence',
    'quotations','quotation_items','quotation_templates','purchase_orders','purchase_order_items',
    'po_payments','payment_receipts','accounts','expenses','transactions','advances','stock_movements',
    'employees','attendance','payroll','crm_leads','crm_people','crm_opportunities','crm_activities',
    'crm_notes','crm_tasks','follow_ups','entity_links','org_channels','org_messages','email_messages',
    'call_logs','tool_runs','user_folders','user_files','user_assets','email_optouts','campaigns'
  ]) or jsonb_typeof(payload) <> 'object' or payload->>'id' is null then
    raise exception 'Invalid sync record';
  end if;
  -- Comparing typed IDs keeps the primary-key index usable for bigint and UUID tables.
  execute format('select to_jsonb(r) from public.%1$I r where id = '
    || '(jsonb_populate_record(null::public.%1$I,$1)).id for update',p_table)
    into current_row using payload;
  if p_delete then
    if current_row is null then return jsonb_build_object('ok',true); end if;
    if p_expected is null or (current_row->>'sync_revision')::bigint <> p_expected then
      return jsonb_build_object('ok',false,'conflict',true);
    end if;
    execute format('delete from public.%1$I where id = (jsonb_populate_record(null::public.%1$I,$1)).id returning to_jsonb(%1$I)',p_table)
      into saved using payload;
    if saved is null then raise insufficient_privilege; end if;
    return jsonb_build_object('ok',true);
  end if;
  if current_row is not null then
    if p_expected is null or (current_row->>'sync_revision')::bigint <> p_expected then
      -- A lost response is safe to retry only when the complete submitted values
      -- still match. New-row retries also require the same creation timestamp.
      execute format('select to_jsonb(jsonb_populate_record(null::public.%I,$1))',p_table) into normalized using payload;
      if not exists(select 1 from jsonb_object_keys(payload - array['updated_at','revision']) k
        where normalized->k is distinct from current_row->k)
        and (p_expected is not null or (payload ? 'created_at' and normalized->'created_at' = current_row->'created_at')) then
        return jsonb_build_object('ok',true,'revision',current_row->'sync_revision');
      end if;
      return jsonb_build_object('ok',false,'conflict',true);
    end if;
    payload := payload - array['id','created_at'];
  elsif p_expected is not null then
    return jsonb_build_object('ok',false,'conflict',true);
  end if;
  -- Reject unknown/generated fields instead of silently dropping saved data.
  if exists(select 1 from jsonb_object_keys(payload) k where not exists(
    select 1 from pg_attribute where attrelid=to_regclass('public.'||p_table)
      and attname=k and attnum>0 and not attisdropped and attgenerated=''
  )) then raise exception 'Sync schema is out of date'; end if;
  select string_agg(format('%I',k),','), string_agg(format('x.%I',k),',')
    into columns_sql, values_sql from jsonb_object_keys(payload) k;
  if current_row is null then
    begin
      execute format('insert into public.%1$I (%2$s) select %3$s from jsonb_populate_record(null::public.%1$I,$1) x returning to_jsonb(%1$I)',p_table,columns_sql,values_sql)
        into saved using payload;
    exception when unique_violation then
      -- Another device won the insert race, or the ID belongs to an invisible row.
      return jsonb_build_object('ok',false,'conflict',true);
    end;
  else
    execute format('update public.%1$I set (%2$s) = (select %3$s from jsonb_populate_record(null::public.%1$I,$1) x) '
      || 'where id = (jsonb_populate_record(null::public.%1$I,$2)).id returning to_jsonb(%1$I)',p_table,columns_sql,values_sql)
      into saved using payload,p_row;
    if saved is null then raise insufficient_privilege; end if;
  end if;
  return jsonb_build_object('ok',true,'revision',saved->'sync_revision');
end $$;
revoke all on function public.sync_record(text,jsonb,bigint,boolean) from public,anon;
grant execute on function public.sync_record(text,jsonb,bigint,boolean) to authenticated;

-- Random offline IDs occupy the upper half of JS's safe integer range.
-- Never advance a cloud sequence into that range (or beyond Number.MAX_SAFE_INTEGER).
create or replace function public.sync_bump_sequences() returns void
language plpgsql security definer set search_path = public as $$
declare t record; seq text; mx bigint;
begin
  for t in select table_name from information_schema.columns
    where table_schema='public' and column_name='sync_revision' loop
    seq := pg_get_serial_sequence('public.' || quote_ident(t.table_name),'id');
    if seq is null then continue; end if;
    execute format('select coalesce(max(id),0) from public.%I where id < 4503599627370496',t.table_name) into mx;
    if mx > 0 then
      execute format('select setval(%L,greatest(last_value,$1)) from %s',seq,seq) using mx;
    end if;
  end loop;
end $$;
revoke all on function public.sync_bump_sequences() from public,anon;
grant execute on function public.sync_bump_sequences() to authenticated;
notify pgrst, 'reload schema';
commit;
