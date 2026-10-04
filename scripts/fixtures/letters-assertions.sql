-- Synthetic data inside the disposable PostgreSQL runner only.
begin;
insert into app_settings(id,user_id,org_id,key,value) values
  (5201,'00000000-0000-0000-0000-000000000001','a','letters','[{"form":{"blocks":[],"body":"original-a"}}]'),
  (5202,'00000000-0000-0000-0000-000000000001','b','letters','[{"form":{"blocks":[],"body":"original-b"}}]'),
  (5203,'00000000-0000-0000-0000-000000000001','a','letter_fixture_other','original-other'),
  (5207,'00000000-0000-0000-0000-000000000001','a','letter_number_format','LTR-{001}');
do $$ begin
  begin
    insert into app_settings(id,user_id,org_id,key,value) values
      (5204,'00000000-0000-0000-0000-000000000002','a','letters','[]');
    raise exception 'Separate users created two Letter collections in one org';
  exception when unique_violation then null; end;
  begin
    insert into app_settings(id,user_id,org_id,key,value) values
      (5205,'00000000-0000-0000-0000-000000000001','b','letter_fixture_other','duplicate');
    raise exception 'Letter migration broadened unrelated user/key uniqueness';
  exception when unique_violation then null; end;
  if (select count(*) from app_settings where key='letters') <> 2 then
    raise exception 'Same user cannot retain letters in separate orgs'; end if;
end $$;
update org_members set modules=array['inventory'] where user_id in
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
set local role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000001',true);
do $$ declare n integer; begin
  if exists(select 1 from app_settings where key in ('letters','letter_number_format')) then
    raise exception 'Denied module exposed Letter content or numbering'; end if;
  update app_settings set value='forbidden' where id=5201; get diagnostics n=row_count;
  if n <> 0 then raise exception 'Denied module updated letters'; end if;
  delete from app_settings where id=5201; get diagnostics n=row_count;
  if n <> 0 then raise exception 'Denied module deleted letters'; end if;
  begin
    insert into app_settings(id,key,value) values(5206,'letters','[]');
    raise exception 'Denied module inserted letters';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update org_members set modules=array['letters'] where user_id='00000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$ declare n integer; outcome jsonb; begin
  if not exists(select 1 from app_settings where id=5201) or exists(select 1 from app_settings where id=5202) then
    raise exception 'Letter module failed workspace isolation'; end if;
  if public.filey_setting_access('packaging_lists',false) or public.filey_setting_access('bank_accounts',false) then
    raise exception 'Letter permission exposed another business module'; end if;
  if not exists(select 1 from app_settings where id=5207) then raise exception 'Letter staff cannot read saved numbering'; end if;
  update app_settings set value='staff-numbering' where id=5207; get diagnostics n=row_count;
  if n <> 0 then raise exception 'Letter staff changed admin numbering'; end if;
  update app_settings set value='[{"form":{"blocks":[],"body":"edited-a"}}]' where id=5201 and sync_revision=1; get diagnostics n=row_count;
  if n <> 1 then raise exception 'Permitted Letter CAS update failed'; end if;
  update app_settings set value='stale' where id=5201 and sync_revision=1; get diagnostics n=row_count;
  if n <> 0 then raise exception 'Stale Letter update overwrote saved content'; end if;
  update app_settings set value='forbidden' where id=5202; get diagnostics n=row_count;
  if n <> 0 then raise exception 'Cross-workspace Letter update allowed'; end if;
  outcome := public.sync_record('app_settings',jsonb_build_object('id',5221,'key','letters','value','[{"form":{"blocks":[],"body":"offline-version"}}]'),null,false);
  if outcome->>'conflict' is distinct from 'true' or (select value::jsonb#>>'{0,form,body}' from app_settings where id=5201) <> 'edited-a' then
    raise exception 'Offline Letter collection did not preserve cloud content as a reviewable conflict'; end if;
end $$;
do $$ declare v_style jsonb; v_bad jsonb; v_good jsonb; v_saved text; begin
  v_good := '[{"form":{"blocks":[{"style":{"font":"mono","align":"right","fontSize":8,"bold":false,"italic":true,"underline":false,"color":"#aB23EF","lineSpacing":1,"paragraphSpacing":0}}],"show_reference":false,"show_company_header":false,"text_style":{"font":"classic","align":"center","fontSize":36,"lineSpacing":2.5,"paragraphSpacing":32},"title_style":{"fontSize":18,"bold":true}},"issued_snapshot":{"blocks":[],"title_style":{"fontSize":11}}}]'::jsonb;
  update app_settings set value=v_good::text where id=5201;
  select value into v_saved from app_settings where id=5201;
  for v_style in select value from jsonb_array_elements('[null,"bold",[],{"font":"Arial"},{"align":"justify"},{"fontSize":"12"},{"fontSize":7.9},{"fontSize":36.1},{"lineSpacing":0.9},{"lineSpacing":2.6},{"paragraphSpacing":-1},{"paragraphSpacing":32.1},{"bold":1},{"italic":"false"},{"underline":null},{"color":"red"},{"color":"#abc"},{"color":"url(secret)"},{"css":"position:absolute"}]'::jsonb) loop
    foreach v_bad in array array[
      jsonb_set(v_good,'{0,form,text_style}',v_style),
      jsonb_set(v_good,'{0,form,title_style}',v_style),
      jsonb_set(v_good,'{0,form,blocks,0,style}',v_style),
      jsonb_set(v_good,'{0,issued_snapshot,title_style}',v_style)
    ] loop
      begin
        update app_settings set value=v_bad::text where id=5201;
        raise exception 'Malformed Letter style passed the database formatting guard: %',v_style;
      exception when check_violation then null; end;
      if (select value from app_settings where id=5201)<>v_saved then raise exception 'Rejected formatting changed saved Letter content'; end if;
    end loop;
  end loop;
  foreach v_bad in array array[
    jsonb_set(v_good,'{0,form,show_reference}','"false"'),
    jsonb_set(v_good,'{0,form,show_company_header}','null'),
    jsonb_set(v_good,'{0,form,blocks}','"text"'),
    jsonb_set(v_good,'{0,issued_snapshot}','{}')
  ] loop
    begin
      update app_settings set value=v_bad::text where id=5201;
      raise exception 'Malformed Letter flag or block data passed the database formatting guard';
    exception when check_violation then null; end;
  end loop;
  -- Legacy forms without the new optional flags/style remain valid.
  update app_settings set value='[{"form":{"blocks":[],"body":"legacy"}}]' where id=5201;
  -- Other app settings are outside this Letter-only formatting guard.
  update app_settings set value='legacy-setting-not-json' where id=5207;
  if (select value from app_settings where id=5207)<>'LTR-{001}' then
    raise exception 'Formatting guard changed Letter numbering permissions'; end if;
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  if not exists(select 1 from app_settings where id=5201) then raise exception 'Admin Letter access denied'; end if;
end $$;
reset role;
do $$ begin
  if (select value::jsonb#>>'{0,form,body}' from app_settings where id=5202) <> 'original-b' or
    (select value from app_settings where id=5203) <> 'original-other' then raise exception 'Unrelated data changed'; end if;
end $$;
rollback;
select 'PASS: Letter settings preserve org/module/numbering permissions, CAS, offline conflicts and legacy uniqueness; safe formatting is enforced for form, blocks and issued snapshots; migration is repeatable.';
