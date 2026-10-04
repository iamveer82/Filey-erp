-- Independent quantity/shipping documents use the existing workspace store.
-- No invoice, inventory or accounting rows are changed.
begin;

-- Keep the exact legacy uniqueness for all other settings. Packaging lists
-- are org-shared and must allow one owner to use separate organizations.
alter table public.app_settings drop constraint if exists app_settings_user_id_key;
alter table public.app_settings drop constraint if exists app_settings_user_id_key_key;
drop index if exists public.app_settings_user_id_key;
drop index if exists public.app_settings_user_id_key_key;
create unique index if not exists app_settings_user_setting_key
  on public.app_settings(user_id,key) where key <> 'packaging_lists';
create unique index if not exists app_settings_packaging_org_key
  on public.app_settings(org_id,key) where key = 'packaging_lists';

create or replace function public.filey_setting_access(p_key text,p_write boolean default false) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.org_members m
    where m.user_id=auth.uid() and m.org_id=public.current_org() and
      (m.role in ('owner','admin') or
        case when p_key in ('bank_accounts','cheque_register','declaration_letters','delivery_challans','packaging_lists') then
          m.modules is null or (case p_key when 'bank_accounts' then 'bank-accounts'
            when 'cheque_register' then 'cheques' when 'declaration_letters' then 'declaration'
            when 'delivery_challans' then 'delivery-challans' when 'packaging_lists' then 'packaging-list' end)=any(m.modules)
        when p_key='packaging_list_number_format' then not p_write and
          (m.modules is null or 'packaging-list'=any(m.modules))
        else not p_write and (m.modules is null or p_key in
          ('modules.disabled','company_letterhead','company_stamp','company_signature','company_bank','doc_presets','custom_templates')
          or p_key like 'custom_fields_%' or p_key like 'number_format_%' or p_key like 'notify.%') end))
$$;
revoke all on function public.filey_setting_access(text,boolean) from public,anon;
grant execute on function public.filey_setting_access(text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
