-- Installed without changing business records. Recovery runs only after an
-- explicit device/cloud preference and is limited to the owner's retired orgs.
begin;

create or replace function public.filey_can_restore_sync_org(p_source text, p_target text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and p_source <> p_target
    and p_target = public.current_org()
    and exists(select 1 from public.organizations where id::text=p_source and owner_id=auth.uid())
    and exists(select 1 from public.organizations where id::text=p_target and owner_id=auth.uid())
    and not exists(select 1 from public.profiles where org_id=p_source)
    and not exists(select 1 from public.org_members where org_id=p_source and user_id<>auth.uid())
$$;
revoke all on function public.filey_can_restore_sync_org(text,text) from public,anon,authenticated;

create or replace function public.force_org_id()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then return new; end if;
  if TG_OP='INSERT' then
    new.org_id := public.current_org();
  elsif new.org_id is distinct from old.org_id then
    -- Normal updates remain pinned. Only an owner's own rows can leave a
    -- retired workspace for that same owner's active workspace.
    if (to_jsonb(old)->>'user_id') is distinct from auth.uid()::text
      or (to_jsonb(new)->>'user_id') is distinct from auth.uid()::text
      or not public.filey_can_restore_sync_org(old.org_id,new.org_id) then
      new.org_id := old.org_id;
    end if;
  end if;
  return new;
end $$;

create or replace function public.filey_prepare_workspace_sync(p_source_orgs text[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_target text := public.current_org();
  v_source text;
  t text;
begin
  if v_uid is null then raise exception 'Sign in before syncing' using errcode='42501'; end if;
  if p_source_orgs is null or cardinality(p_source_orgs) not between 1 and 16
    or array_position(p_source_orgs,null) is not null then
    raise exception 'Invalid workspace selection' using errcode='22023';
  end if;
  -- ponytail: a rare recovery locks membership tables for this transaction;
  -- use organization-scoped advisory locks if recovery becomes frequent.
  lock table public.organizations, public.profiles, public.org_members in share mode;
  foreach v_source in array p_source_orgs loop
    if not public.filey_can_restore_sync_org(v_source,v_target) then
      raise exception 'Only your retired workspaces can be reconnected' using errcode='42501';
    end if;
  end loop;
  foreach t in array array[
    'company_profile','app_settings','suppliers','crm_customers','products',
    'orders','order_items','invoice_docs','invoice_doc_items','work_items',
    'invoice_payments','invoice_recurrence','quotations','quotation_items',
    'quotation_templates','purchase_orders','purchase_order_items','po_payments',
    'payment_receipts','accounts','expenses','transactions','advances',
    'stock_movements','employees','attendance','payroll','crm_leads','crm_people',
    'crm_opportunities','crm_activities','crm_notes','crm_tasks','follow_ups',
    'entity_links','org_channels','org_messages','email_messages','call_logs',
    'tool_runs','user_folders','user_files','user_assets','email_optouts','campaigns'
  ] loop
    if to_regclass('public.'||t) is null then continue; end if;
    if not exists(select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='user_id')
      or not exists(select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='org_id') then continue; end if;
    if t='company_profile' then
      -- The active company profile is reconciled by business key by the client.
      -- Keep old profiles archived instead of creating competing singletons.
      if exists(select 1 from public.company_profile where org_id=v_target) then continue; end if;
      if (select count(*) from public.company_profile where user_id=v_uid and org_id=any(p_source_orgs))>1 then
        raise exception 'Choose one company profile before reconnecting' using errcode='22023';
      end if;
    end if;
    execute format('update public.%I set org_id=$1 where user_id=$2 and org_id=any($3)',t)
      using v_target,v_uid,p_source_orgs;
  end loop;
  return jsonb_build_object('org_id',v_target,'recovered_orgs',to_jsonb(p_source_orgs));
end $$;
revoke all on function public.filey_prepare_workspace_sync(text[]) from public,anon;
grant execute on function public.filey_prepare_workspace_sync(text[]) to authenticated;

-- Legacy invoice links are nullable in the schema. Preserve unattached rows
-- as private owner data. Linked items/payments still inherit invoice access.
do $$ declare t text; begin
  foreach t in array array['invoice_doc_items','invoice_payments'] loop
    execute format('drop policy if exists %I on public.%I',t||'_unlinked_owner',t);
    execute format('create policy %I on public.%I for all to authenticated
      using (invoice_id is null and user_id=(select auth.uid()) and org_id=(select public.current_org()))
      with check (invoice_id is null and user_id=(select auth.uid()) and org_id=(select public.current_org()))',t||'_unlinked_owner',t);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
