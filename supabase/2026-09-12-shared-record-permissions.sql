-- Shared records are readable, never writable, by ordinary recipients.
-- Apply AFTER all feature migrations. No business rows are modified.
begin;

alter table public.invoice_docs
  add column if not exists shared_with jsonb not null default '[]'::jsonb;

do $$
declare
  t text;
  p text;
  can_read text;
  can_write text;
begin
  foreach t in array array[
    'products','orders','order_items','employees','attendance','payroll',
    'accounts','expenses','transactions','crm_leads','crm_customers',
    'crm_opportunities','crm_activities','crm_people','crm_notes','crm_tasks',
    'invoice_docs','invoice_doc_items','invoice_payments','quotations',
    'quotation_items','quotation_templates','tool_runs','suppliers',
    'purchase_orders','purchase_order_items','stock_movements','advances',
    'po_payments','payment_receipts','entity_links','campaigns','email_optouts',
    'org_channels','email_messages','call_logs','invoice_recurrence'
  ] loop
    -- Optional feature tables may not have been installed yet.
    if to_regclass('public.' || t) is null then continue; end if;
    can_write := 'org_id = (select public.current_org()) and '
      || '(user_id = (select auth.uid()) or (select public.is_org_admin()))';
    can_read := 'org_id = (select public.current_org()) and '
      || '(user_id = (select auth.uid()) or (select public.is_org_admin()) or shared = true';
    if t = 'invoice_docs' then
      can_read := can_read || ' or shared_with ? (select auth.uid())::text';
    end if;
    can_read := can_read || ')';

    if t in ('invoice_doc_items', 'invoice_payments', 'invoice_recurrence') then
      -- Child rows inherit the invoice's visibility, including targeted shares.
      -- An unrelated member must not create a payment/item on a shared invoice.
      can_read := format('org_id = (select public.current_org()) and exists '
        || '(select 1 from public.invoice_docs d where d.id = %I.%I)',
        t, case when t = 'invoice_recurrence' then 'base_invoice_id' else 'invoice_id' end);
      can_write := can_write || format(' and exists '
        || '(select 1 from public.invoice_docs d where d.id = %I.%I '
        || 'and (d.user_id = (select auth.uid()) or (select public.is_org_admin())))',
        t, case when t = 'invoice_recurrence' then 'base_invoice_id' else 'invoice_id' end);
    end if;

    foreach p in array array['_owner','_org','_access','_read','_write'] loop
      execute format('drop policy if exists %I on public.%I', t || p, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (%s)',
      t || '_read', t, can_read);
    execute format('create policy %I on public.%I for all to authenticated using (%s) with check (%s)',
      t || '_write', t, can_write, can_write);
  end loop;
end $$;

-- SECURITY DEFINER bypasses RLS: explicitly check both organization and owner.
-- Replace the entire target list atomically, including turning whole-org sharing off.
create or replace function public.share_invoice(
  p_id bigint, p_all boolean, p_user_ids jsonb default '[]'::jsonb
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.invoice_docs;
  v_targets jsonb := coalesce(p_user_ids, '[]'::jsonb);
begin
  if v_uid is null then
    return json_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  select * into v_row from public.invoice_docs
    where id = p_id and org_id = public.current_org() for update;
  if v_row.id is null then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.user_id <> v_uid and not public.is_org_admin() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if jsonb_typeof(v_targets) <> 'array' then
    return json_build_object('ok', false, 'reason', 'invalid_members');
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_targets) x
    where jsonb_typeof(x) <> 'string' or not exists (
      select 1 from public.org_members m
      where m.org_id = v_row.org_id and m.user_id::text = (x #>> '{}')
    )
  ) then
    return json_build_object('ok', false, 'reason', 'invalid_members');
  end if;
  update public.invoice_docs set shared = coalesce(p_all, false),
    shared_with = case when p_all then '[]'::jsonb else v_targets end,
    updated_at = now() where id = p_id;
  return json_build_object('ok', true);
end $$;
revoke all on function public.share_invoice(bigint, boolean, jsonb) from public, anon;
grant execute on function public.share_invoice(bigint, boolean, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
