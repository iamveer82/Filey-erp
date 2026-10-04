-- Correspondence uses the existing org-scoped settings and sync revisions.
-- Apply after the packaging/module-access migrations. No business rows change.
begin;

alter table public.app_settings drop constraint if exists app_settings_user_id_key;
alter table public.app_settings drop constraint if exists app_settings_user_id_key_key;
drop index if exists public.app_settings_user_id_key;
drop index if exists public.app_settings_user_id_key_key;
drop index if exists public.app_settings_user_setting_key;
create unique index app_settings_user_setting_key
  on public.app_settings(user_id,key) where key not in ('packaging_lists','letters');
create unique index if not exists app_settings_packaging_org_key
  on public.app_settings(org_id,key) where key = 'packaging_lists';
create unique index if not exists app_settings_letters_org_key
  on public.app_settings(org_id,key) where key = 'letters';

create or replace function public.filey_setting_access(p_key text,p_write boolean default false) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.org_members m
    where m.user_id=auth.uid() and m.org_id=public.current_org() and
      (m.role in ('owner','admin') or
        case when p_key in ('bank_accounts','cheque_register','declaration_letters','delivery_challans','packaging_lists','letters') then
          m.modules is null or (case p_key when 'bank_accounts' then 'bank-accounts'
            when 'cheque_register' then 'cheques' when 'declaration_letters' then 'declaration'
            when 'delivery_challans' then 'delivery-challans' when 'packaging_lists' then 'packaging-list'
            when 'letters' then 'letters' end)=any(m.modules)
        when p_key in ('packaging_list_number_format','letter_number_format') then not p_write and
          (m.modules is null or (case p_key when 'packaging_list_number_format' then 'packaging-list' else 'letters' end)=any(m.modules))
        else not p_write and (m.modules is null or p_key in
          ('modules.disabled','company_letterhead','company_stamp','company_signature','company_bank','doc_presets','custom_templates')
          or p_key like 'custom_fields_%' or p_key like 'number_format_%' or p_key like 'notify.%') end))
$$;
revoke all on function public.filey_setting_access(text,boolean) from public,anon;
grant execute on function public.filey_setting_access(text,boolean) to authenticated;

-- Formatting is structured data, not arbitrary CSS. This guard also covers
-- direct cloud writes and offline sync, including the issued snapshot.
create or replace function public.filey_letter_text_style_valid(p_style jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare v_key text; v_value jsonb;
begin
  if p_style is null then return true; end if;
  if jsonb_typeof(p_style) <> 'object' then return false; end if;
  for v_key,v_value in select key,value from jsonb_each(p_style) loop
    if v_key='font' then
      if jsonb_typeof(v_value)<>'string' or (v_value#>>'{}') not in ('modern','classic','mono') then return false; end if;
    elsif v_key='align' then
      if jsonb_typeof(v_value)<>'string' or (v_value#>>'{}') not in ('left','center','right') then return false; end if;
    elsif v_key='color' then
      if jsonb_typeof(v_value)<>'string' or (v_value#>>'{}') !~* '^#[0-9a-f]{6}$' then return false; end if;
    elsif v_key in ('bold','italic','underline') then
      if jsonb_typeof(v_value)<>'boolean' then return false; end if;
    elsif v_key in ('fontSize','lineSpacing','paragraphSpacing') then
      if jsonb_typeof(v_value)<>'number' then return false; end if;
      if v_key='fontSize' and ((v_value#>>'{}')::numeric<8 or (v_value#>>'{}')::numeric>36) then return false; end if;
      if v_key='lineSpacing' and ((v_value#>>'{}')::numeric<1 or (v_value#>>'{}')::numeric>2.5) then return false; end if;
      if v_key='paragraphSpacing' and ((v_value#>>'{}')::numeric<0 or (v_value#>>'{}')::numeric>32) then return false; end if;
    else return false;
    end if;
  end loop;
  return true;
end $$;

create or replace function public.filey_letter_form_format_valid(p_form jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare v_key text; v_block jsonb;
begin
  if jsonb_typeof(p_form) is distinct from 'object' then return false; end if;
  foreach v_key in array array['show_reference','show_company_header'] loop
    if p_form?v_key and jsonb_typeof(p_form->v_key)<>'boolean' then return false; end if;
  end loop;
  foreach v_key in array array['text_style','title_style'] loop
    if p_form?v_key and not public.filey_letter_text_style_valid(p_form->v_key) then return false; end if;
  end loop;
  if jsonb_typeof(p_form->'blocks') is distinct from 'array' then return false; end if;
  for v_block in select value from jsonb_array_elements(p_form->'blocks') loop
    if jsonb_typeof(v_block)<>'object' then return false; end if;
    if v_block?'style' and not public.filey_letter_text_style_valid(v_block->'style') then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public.filey_validate_letter_setting() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare v_records jsonb; v_record jsonb;
begin
  if new.key<>'letters' then return new; end if;
  begin v_records:=new.value::jsonb;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Letter content or formatting could not be read' using errcode='23514';
  end;
  if jsonb_typeof(v_records) is distinct from 'array' then
    raise exception 'Letter content must be a collection' using errcode='23514'; end if;
  for v_record in select value from jsonb_array_elements(v_records) loop
    if jsonb_typeof(v_record)<>'object' or not public.filey_letter_form_format_valid(v_record->'form') then
      raise exception 'Letter formatting is invalid' using errcode='23514'; end if;
    if v_record?'issued_snapshot' and v_record->'issued_snapshot'<>'null'::jsonb
      and not public.filey_letter_form_format_valid(v_record->'issued_snapshot') then
      raise exception 'Issued Letter formatting is invalid' using errcode='23514'; end if;
  end loop;
  return new;
end $$;
drop trigger if exists filey_letter_format on public.app_settings;
create trigger filey_letter_format before insert or update of key,value on public.app_settings
  for each row when (new.key='letters') execute function public.filey_validate_letter_setting();

notify pgrst,'reload schema';
commit;
