-- Column-only REVOKEs cannot override a table-level INSERT/UPDATE grant.
-- Keep direct workspace creation/renaming, but billing and ownership changes
-- belong to trusted server code. DELETE is reserved to the actual owner.
-- Additive and repeatable; no workspace or customer records are rewritten.
begin;
revoke insert, update, delete on public.organizations from public, anon, authenticated;

-- Remove older column grants too before granting the small editable set.
do $$ declare columns text; begin
  select string_agg(quote_ident(attname), ', ') into columns
    from pg_attribute where attrelid='public.organizations'::regclass
      and attnum>0 and not attisdropped;
  execute format('revoke insert (%s), update (%s) on public.organizations from public, anon, authenticated', columns, columns);
end $$;
grant insert (id, name, owner_id), update (name) on public.organizations to authenticated;
grant delete on public.organizations to authenticated;

drop policy if exists organizations_access on public.organizations;
drop policy if exists organizations_read on public.organizations;
drop policy if exists organizations_create on public.organizations;
drop policy if exists organizations_rename on public.organizations;
drop policy if exists organizations_remove on public.organizations;
create policy organizations_read on public.organizations for select to authenticated
  using (id::text=public.current_org() or owner_id=auth.uid());
create policy organizations_create on public.organizations for insert to authenticated
  with check (owner_id=auth.uid());
create policy organizations_rename on public.organizations for update to authenticated
  using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy organizations_remove on public.organizations for delete to authenticated
  using (owner_id=auth.uid());
notify pgrst, 'reload schema';
commit;
