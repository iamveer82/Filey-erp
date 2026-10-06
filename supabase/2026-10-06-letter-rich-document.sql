-- Safe Word-style Letter editor JSON in the existing org-scoped collection.
-- Additive: no business rows or issued snapshots are rewritten.
begin;

create or replace function public.filey_letter_rich_text_units(p_text text) returns integer
language sql immutable set search_path=public,pg_temp as $$
  select case when length(p_text)>250000 then 250001 else length(p_text) + coalesce((select count(*)::integer
    from regexp_split_to_table(p_text,'') as chars(character) where ascii(character)>65535),0) end
$$;

-- Returns [node count, bounded content units, plain-text units, company marks], or null for an
-- invalid node. Depth is checked before following any child references.
create or replace function public.filey_letter_rich_node_stats(p_node jsonb,p_parent text,p_depth integer,p_position integer)
returns integer[] language plpgsql immutable set search_path=public,pg_temp as $$
declare
  v_type text; v_key text; v_value jsonb; v_attrs jsonb; v_mark jsonb; v_child jsonb;
  v_seen text[]:=array[]::text[]; v_stats integer[]; v_nodes integer:=1; v_units integer:=0;
  v_plain integer:=0; v_marks integer:=0; v_index integer:=0; v_start integer:=1; v_count integer;
begin
  if p_depth is null or p_depth<1 or p_depth>16 or p_position is null or p_position<0 or p_position>20000 or
    p_parent is null or p_parent not in ('doc','paragraph','heading','bulletList','orderedList','listItem','blockquote') or
    jsonb_typeof(p_node) is distinct from 'object' or octet_length(p_node::text)>2000000 then return null; end if;
  if exists(select 1 from jsonb_object_keys(p_node) k where k not in ('type','attrs','content','text','marks')) then return null; end if;
  if jsonb_typeof(p_node->'type') is distinct from 'string' then return null; end if;
  v_type:=p_node->>'type';
  if p_parent in ('paragraph','heading') then
    if v_type not in ('text','hardBreak') then return null; end if;
  elsif p_parent in ('bulletList','orderedList') then
    if v_type<>'listItem' then return null; end if;
  else
    if v_type not in ('paragraph','heading','bulletList','orderedList','blockquote','companySignature','companyStamp') then return null; end if;
    if p_parent='listItem' and p_position=0 and v_type<>'paragraph' then return null; end if;
  end if;

  if v_type='text' then
    if p_node?'attrs' or p_node?'content' or jsonb_typeof(p_node->'text') is distinct from 'string' or length(p_node->>'text')=0 then return null; end if;
    v_units:=public.filey_letter_rich_text_units(p_node->>'text');
    if v_units>250000 then return null; end if;
    if p_node?'marks' then
      if jsonb_typeof(p_node->'marks') is distinct from 'array' or jsonb_array_length(p_node->'marks')>4 then return null; end if;
      for v_mark in select value from jsonb_array_elements(p_node->'marks') loop
        if jsonb_typeof(v_mark) is distinct from 'object' or jsonb_typeof(v_mark->'type') is distinct from 'string' then return null; end if;
        if (v_mark->>'type')=any(v_seen) then return null; end if;
        v_seen:=array_append(v_seen,v_mark->>'type');
        if v_mark->>'type' in ('bold','italic','underline') then
          if exists(select 1 from jsonb_object_keys(v_mark) k where k<>'type') then return null; end if;
        elsif v_mark->>'type'='textStyle' then
          if exists(select 1 from jsonb_object_keys(v_mark) k where k not in ('type','attrs')) or jsonb_typeof(v_mark->'attrs') is distinct from 'object' then return null; end if;
          v_attrs:=v_mark->'attrs';
          for v_key,v_value in select key,value from jsonb_each(v_attrs) loop
            if v_key not in ('fontFamily','fontSize','color') then return null; end if;
            if v_value='null'::jsonb then continue; end if;
            if jsonb_typeof(v_value)<>'string' then return null; end if;
            if v_key='fontFamily' and (v_value#>>'{}') not in ('Inter','Arial','Georgia','Times New Roman','Courier New','Lora','IBM Plex Mono') then return null; end if;
            if v_key='fontSize' then
              if (v_value#>>'{}') !~ '^\d{1,2}(\.\d{1,2})?pt$' then return null; end if;
              if replace(v_value#>>'{}','pt','')::numeric<8 or replace(v_value#>>'{}','pt','')::numeric>36 then return null; end if;
            end if;
            if v_key='color' and (v_value#>>'{}') !~* '^#[0-9a-f]{6}$' then return null; end if;
          end loop;
        else return null;
        end if;
      end loop;
    end if;
    return array[1,v_units,v_units,0];
  elsif v_type='hardBreak' then
    if exists(select 1 from jsonb_object_keys(p_node) k where k<>'type') then return null; end if;
    return array[1,1,1,0];
  end if;

  if p_node?'text' or p_node?'marks' then return null; end if;
  if v_type in ('companySignature','companyStamp') then
    if p_node?'content' or jsonb_typeof(p_node->'attrs') is distinct from 'object' then return null; end if;
    v_attrs:=p_node->'attrs';
    if exists(select 1 from jsonb_object_keys(v_attrs) k where k not in ('label','textAlign')) then return null; end if;
    if jsonb_typeof(v_attrs->'label') is distinct from 'string' or public.filey_letter_rich_text_units(v_attrs->>'label')>200 or (v_attrs->>'label')~ E'[\r\n]' then return null; end if;
    if v_attrs?'textAlign' and v_attrs->'textAlign'<>'null'::jsonb and
      (jsonb_typeof(v_attrs->'textAlign')<>'string' or v_attrs->>'textAlign' not in ('left','center','right')) then return null; end if;
    return array[1,0,0,1];
  end if;
  if p_node?'attrs' then
    if v_type not in ('orderedList','paragraph','heading') then return null; end if;
    if jsonb_typeof(p_node->'attrs') is distinct from 'object' then return null; end if;
    v_attrs:=p_node->'attrs';
    for v_key,v_value in select key,value from jsonb_each(v_attrs) loop
      if v_type='orderedList' then
        if v_key<>'start' then return null; end if;
        if v_value='null'::jsonb then continue; end if;
        if jsonb_typeof(v_value)<>'number' or (v_value#>>'{}')::numeric<1 or (v_value#>>'{}')::numeric>9999 or trunc((v_value#>>'{}')::numeric)<>(v_value#>>'{}')::numeric then return null; end if;
        v_start:=(v_value#>>'{}')::integer;
      elsif v_type in ('paragraph','heading') then
        if v_key not in ('textAlign','lineSpacing','paragraphSpacing') and not(v_type='heading' and v_key='level') then return null; end if;
        if v_value='null'::jsonb and v_key<>'level' then continue; end if;
        if v_key='textAlign' then
          if jsonb_typeof(v_value)<>'string' or (v_value#>>'{}') not in ('left','center','right','justify') then return null; end if;
        else
          if jsonb_typeof(v_value)<>'number' then return null; end if;
          if v_key='level' and ((v_value#>>'{}')::numeric not in (1,2,3)) then return null; end if;
          if v_key='lineSpacing' and ((v_value#>>'{}')::numeric<1 or (v_value#>>'{}')::numeric>2.5) then return null; end if;
          if v_key='paragraphSpacing' and ((v_value#>>'{}')::numeric<0 or (v_value#>>'{}')::numeric>32) then return null; end if;
        end if;
      else return null;
      end if;
    end loop;
  elsif v_type='heading' then return null;
  end if;
  if v_type='heading' and not(p_node->'attrs'?'level') then return null; end if;
  if p_node?'content' and jsonb_typeof(p_node->'content') is distinct from 'array' then return null; end if;
  v_count:=coalesce(jsonb_array_length(p_node->'content'),0);
  if v_type not in ('paragraph','heading') and v_count=0 then return null; end if;
  for v_child in select value from jsonb_array_elements(coalesce(p_node->'content','[]'::jsonb)) loop
    v_stats:=public.filey_letter_rich_node_stats(v_child,v_type,p_depth+1,v_index);
    if v_stats is null then return null; end if;
    v_nodes:=v_nodes+v_stats[1]; v_units:=v_units+v_stats[2]; v_plain:=v_plain+v_stats[3]; v_marks:=v_marks+v_stats[4];
    if v_type='bulletList' then v_plain:=v_plain+2;
    elsif v_type='orderedList' then v_plain:=v_plain+length((v_start+v_index)::text)+2;
    end if;
    if v_nodes>20000 or v_units>250000 or v_plain>250000 or v_marks>89 then return null; end if;
    v_index:=v_index+1;
  end loop;
  v_units:=v_units+1;
  if v_type not in ('paragraph','heading') then v_plain:=v_plain+greatest(v_count-1,0); end if;
  if v_units>250000 or v_plain>250000 then return null; end if;
  return array[v_nodes,v_units,v_plain,v_marks];
exception when numeric_value_out_of_range or invalid_text_representation then return null;
end $$;

create or replace function public.filey_letter_rich_document_valid(p_document jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare v_child jsonb; v_stats integer[]; v_nodes integer:=0; v_units integer:=0; v_plain integer:=0; v_marks integer:=0; v_count integer;
begin
  if jsonb_typeof(p_document) is distinct from 'object' or p_document->>'type' is distinct from 'doc' or
    exists(select 1 from jsonb_object_keys(p_document) k where k not in ('type','content')) then return false; end if;
  if jsonb_typeof(p_document->'content') is distinct from 'array' then return false; end if;
  v_count:=jsonb_array_length(p_document->'content');
  if v_count=0 or v_count>20000 or octet_length(p_document::text)>2000000 then return false; end if;
  for v_child in select value from jsonb_array_elements(p_document->'content') loop
    v_stats:=public.filey_letter_rich_node_stats(v_child,'doc',1,0);
    if v_stats is null then return false; end if;
    v_nodes:=v_nodes+v_stats[1]; v_units:=v_units+v_stats[2]; v_plain:=v_plain+v_stats[3]; v_marks:=v_marks+v_stats[4];
    -- At most eleven projected text tails + 89 company slots fit 100 legacy blocks.
    if v_nodes>20000 or v_units>250000 or v_plain+v_count-1>250000 or v_marks>89 then return false; end if;
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
  if p_form?'rich_document' and not public.filey_letter_rich_document_valid(p_form->'rich_document') then return false; end if;
  return true;
end $$;

revoke all on function public.filey_letter_rich_text_units(text) from public,anon;
revoke all on function public.filey_letter_rich_node_stats(jsonb,text,integer,integer) from public,anon;
revoke all on function public.filey_letter_rich_document_valid(jsonb) from public,anon;
grant execute on function public.filey_letter_rich_text_units(text) to authenticated,service_role;
grant execute on function public.filey_letter_rich_node_stats(jsonb,text,integer,integer) to authenticated,service_role;
grant execute on function public.filey_letter_rich_document_valid(jsonb) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
