-- Child lines/payments are part of their parent document. A caller must not
-- inject their own row into another author's private/shared document, or use
-- an independently shared line to expose a private parent. Additive and safe
-- to repeat; no existing business rows or foreign keys are rewritten.
begin;
do $$
declare item record; visible_parent text; writable_parent text;
begin
  for item in select * from (values
    ('order_items','orders','order_id'),
    ('quotation_items','quotations','quotation_id'),
    ('purchase_order_items','purchase_orders','po_id'),
    ('po_payments','purchase_orders','po_id')
  ) as children(child_table,parent_table,parent_key) loop
    if to_regclass('public.'||item.child_table) is null
      or to_regclass('public.'||item.parent_table) is null then continue; end if;
    -- Parent SELECT runs as the caller, so parent module/sharing/MFA gates
    -- still apply. Nullable legacy child rows remain private owner data.
    visible_parent := format('org_id=(select public.current_org()) and '
      ||'((%I is null and user_id=(select auth.uid())) or exists '
      ||'(select 1 from public.%I d where d.id=%I.%I and d.org_id=%I.org_id))',
      item.parent_key,item.parent_table,item.child_table,item.parent_key,item.child_table);
    writable_parent := format('org_id=(select public.current_org()) and '
      ||'((%I is null and user_id=(select auth.uid())) or exists '
      ||'(select 1 from public.%I d where d.id=%I.%I and d.org_id=%I.org_id '
      ||'and (d.user_id=(select auth.uid()) or (select public.is_org_admin()))))',
      item.parent_key,item.parent_table,item.child_table,item.parent_key,item.child_table);
    execute format('drop policy if exists %I on public.%I',item.child_table||'_read',item.child_table);
    execute format('create policy %I on public.%I for select to authenticated using (%s)',
      item.child_table||'_read',item.child_table,visible_parent);
    -- Restrictive gates also constrain legacy permissive ALL/owner policies.
    execute format('drop policy if exists filey_parent_read on public.%I',item.child_table);
    execute format('create policy filey_parent_read on public.%I as restrictive for select to authenticated using (%s)',item.child_table,visible_parent);
    execute format('drop policy if exists filey_parent_insert on public.%I',item.child_table);
    execute format('create policy filey_parent_insert on public.%I as restrictive for insert to authenticated with check (%s)',item.child_table,writable_parent);
    execute format('drop policy if exists filey_parent_update on public.%I',item.child_table);
    execute format('create policy filey_parent_update on public.%I as restrictive for update to authenticated using (%s) with check (%s)',item.child_table,writable_parent,writable_parent);
    execute format('drop policy if exists filey_parent_delete on public.%I',item.child_table);
    execute format('create policy filey_parent_delete on public.%I as restrictive for delete to authenticated using (%s)',item.child_table,writable_parent);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
