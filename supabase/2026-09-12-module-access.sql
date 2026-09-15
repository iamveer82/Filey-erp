-- Apply after shared-record permissions and all feature migrations.
-- Module gates intersect existing organization/ownership policies; they never
-- grant access to another user's private rows. No business records are changed.
begin;

create or replace function public.filey_module_access() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select jsonb_build_object('allowed',true,
      'admin',m.role in ('owner','admin'),'modules',m.modules)
    from public.org_members m
    where m.org_id=public.current_org() and m.user_id=auth.uid() limit 1),
    jsonb_build_object('allowed',false,'admin',false,'modules','[]'::jsonb))
$$;
create or replace function public.filey_can_use(p_module text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.org_members m
    where m.org_id=public.current_org() and m.user_id=auth.uid()
      and (m.role in ('owner','admin') or m.modules is null or p_module=any(m.modules)))
$$;
revoke all on function public.filey_module_access(), public.filey_can_use(text) from public, anon;
grant execute on function public.filey_module_access(), public.filey_can_use(text) to authenticated;

do $$ declare item record; begin
  for item in select * from (values
    ('products','inventory'),('stock_movements','inventory'),
    ('orders','orders'),('order_items','orders'),
    ('employees','people'),('attendance','people'),('payroll','people'),('advances','people'),
    ('accounts','accounting'),('expenses','accounting'),('transactions','accounting'),
    ('crm_customers','customers'),('crm_leads','crm'),('crm_people','crm'),
    ('crm_opportunities','crm'),('crm_activities','crm'),('crm_notes','crm'),('crm_tasks','crm'),
    ('quotations','quoting'),('quotation_items','quoting'),('quotation_templates','quoting'),
    ('suppliers','suppliers'),('purchase_orders','purchase-orders'),('purchase_order_items','purchase-orders'),('po_payments','purchase-orders'),
    ('payment_receipts','payment-receipts'),('follow_ups','follow-ups'),
    ('tool_runs','tools'),('user_files','files'),('user_folders','files'),('user_assets','files'),
    ('campaigns','marketing'),('email_optouts','marketing'),
    ('org_channels','team'),('org_messages','team'),('email_messages','comms'),('call_logs','comms'),
    ('sms_templates','sms-templates'),('sms_providers','integrations')
  ) as modules(table_name,module_id) loop
    if to_regclass('public.'||item.table_name) is null then continue; end if;
    execute format('drop policy if exists filey_module_gate on public.%I',item.table_name);
    execute format('create policy filey_module_gate on public.%I as restrictive for all to authenticated using ((select public.filey_can_use(%L))) with check ((select public.filey_can_use(%L)))',item.table_name,item.module_id,item.module_id);
  end loop;
end $$;

drop policy if exists filey_module_gate on public.invoice_docs;
create policy filey_module_gate on public.invoice_docs as restrictive for all to authenticated
  using (public.filey_can_use(case when doc_type='purchase' then 'purchase-invoices' else 'invoicing' end))
  with check (public.filey_can_use(case when doc_type='purchase' then 'purchase-invoices' else 'invoicing' end));
-- Existing child policies select the visible parent invoice. This also prevents
-- entering payments/items for an invoice in a forbidden document module.

do $$ begin
  if to_regclass('public.work_items') is not null then
    execute 'drop policy if exists filey_module_gate on public.work_items';
    execute $policy$create policy filey_module_gate on public.work_items as restrictive for all to authenticated
      using (public.filey_can_use(case when kind='ticket' then 'helpdesk' else 'projects' end))
      with check (public.filey_can_use(case when kind='ticket' then 'helpdesk' else 'projects' end))$policy$;
  end if;
end $$;

-- Edges can reveal labels/IDs from another module; require both endpoints.
create or replace function public.filey_can_use_entity(p_type text) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
  select public.filey_can_use(case p_type when 'invoice' then 'invoicing'
    when 'quotation' then 'quoting' when 'purchase_order' then 'purchase-orders'
    when 'customer' then 'customers' when 'supplier' then 'suppliers'
    when 'product' then 'inventory' when 'lead' then 'crm'
    when 'follow_up' then 'follow-ups' when 'receipt' then 'payment-receipts'
    when 'expense' then 'accounting' else '__unknown__' end)
$$;
revoke all on function public.filey_can_use_entity(text) from public,anon;
grant execute on function public.filey_can_use_entity(text) to authenticated;
drop policy if exists filey_module_gate on public.entity_links;
create policy filey_module_gate on public.entity_links as restrictive for all to authenticated
  using (public.filey_can_use_entity(from_type) and public.filey_can_use_entity(to_type))
  with check (public.filey_can_use_entity(from_type) and public.filey_can_use_entity(to_type));

-- The sharing RPC needs no RLS bypass: its owner/admin checks remain, and the
-- invoker must now also be allowed to access the invoice's business module.
alter function public.share_invoice(bigint,boolean,jsonb) security invoker;

-- Some existing tools keep their records in JSON settings. Those rows are
-- business data too; hiding their pages must not expose the settings payload.
create or replace function public.filey_setting_access(p_key text,p_write boolean default false) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.org_members m
    where m.user_id=auth.uid() and m.org_id=public.current_org() and
      (m.role in ('owner','admin') or
        case when p_key in ('bank_accounts','cheque_register','declaration_letters','delivery_challans') then
          m.modules is null or (case p_key when 'bank_accounts' then 'bank-accounts'
            when 'cheque_register' then 'cheques' when 'declaration_letters' then 'declaration'
            when 'delivery_challans' then 'delivery-challans' end)=any(m.modules)
        else not p_write and (m.modules is null or p_key in
          ('modules.disabled','company_letterhead','company_stamp','company_signature','company_bank','doc_presets','custom_templates')
          or p_key like 'custom_fields_%' or p_key like 'number_format_%' or p_key like 'notify.%') end))
$$;
revoke all on function public.filey_setting_access(text,boolean) from public,anon;
grant execute on function public.filey_setting_access(text,boolean) to authenticated;
do $$ declare command text; begin
  if to_regclass('public.app_settings') is not null then
    foreach command in array array['select','insert','update','delete'] loop
      execute format('drop policy if exists %I on public.app_settings','filey_setting_'||command);
      if command='select' then
        execute 'create policy filey_setting_select on public.app_settings as restrictive for select to authenticated using (public.filey_setting_access(key,false))';
      elsif command='insert' then
        execute 'create policy filey_setting_insert on public.app_settings as restrictive for insert to authenticated with check (public.filey_setting_access(key,true))';
      else
        execute format('create policy %I on public.app_settings as restrictive for %s to authenticated using (public.filey_setting_access(key,true))', 'filey_setting_'||command,command);
      end if;
    end loop;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
