-- Synthetic rich Letter documents only; runs in a disposable PostgreSQL cluster.
begin;
create temporary table filey_rich_letter_fixture(key text,value text);
create trigger rich_letter_format before insert or update of key,value on filey_rich_letter_fixture
  for each row when (new.key='letters') execute function public.filey_validate_letter_setting();

do $$
declare v_good jsonb; v_bad jsonb; v_node jsonb; v_attrs jsonb; v_saved text; v_deep jsonb; v_marks jsonb; v_max jsonb;
begin
  v_good:='{"type":"doc","content":[{"type":"heading","attrs":{"level":2,"textAlign":"center"},"content":[{"type":"text","text":"Authorization","marks":[{"type":"bold"}]}]},{"type":"paragraph","attrs":{"textAlign":"justify","lineSpacing":1.4,"paragraphSpacing":6},"content":[{"type":"text","text":"Plain <script> text and 😀","marks":[{"type":"italic"},{"type":"underline"},{"type":"textStyle","attrs":{"fontFamily":"Georgia","fontSize":"12.5pt","color":"#aAbBcC"}}]},{"type":"hardBreak"},{"type":"text","text":"Next line"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"First item"}]}]}]},{"type":"orderedList","attrs":{"start":2},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Second item"}]}]}]},{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"Quoted wording"}]}]},{"type":"companySignature","attrs":{"label":"Authorized person","textAlign":"right"}},{"type":"companyStamp","attrs":{"label":"Company stamp","textAlign":"left"}}]}'::jsonb;
  if not public.filey_letter_rich_document_valid(v_good) then raise exception 'Safe rich document rejected'; end if;
  if public.filey_letter_rich_text_units('A😀B')<>4 then raise exception 'Unicode units differ from frontend'; end if;
  insert into filey_rich_letter_fixture values('letters',jsonb_build_array(jsonb_build_object(
    'form',jsonb_build_object('blocks','[]'::jsonb,'rich_document',v_good),
    'issued_snapshot',jsonb_build_object('blocks','[]'::jsonb,'rich_document',v_good)))::text);
  select value into v_saved from filey_rich_letter_fixture;

  for v_node in select value from jsonb_array_elements('[
    {"type":"image","attrs":{"src":"https://tracker"}},
    {"type":"paragraph","attrs":{"style":"background:url(secret)"}},
    {"type":"paragraph","attrs":{"lineSpacing":0.9}},
    {"type":"paragraph","attrs":{"paragraphSpacing":33}},
    {"type":"paragraph","attrs":{"textAlign":"unknown"}},
    {"type":"heading","attrs":{"level":4}},
    {"type":"heading","attrs":{}},
    {"type":"bulletList","attrs":{},"content":[{"type":"listItem","content":[{"type":"paragraph"}]}]},
    {"type":"bulletList","content":[{"type":"paragraph"}]},
    {"type":"listItem","content":[{"type":"paragraph"}]},
    {"type":"paragraph","content":[{"type":"paragraph"}]},
    {"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":"javascript:bad"}}]}]},
    {"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"bold"},{"type":"bold"}]}]},
    {"type":"companySignature","attrs":{"label":"Signature","src":"asset-private"}},
    {"type":"companyStamp","attrs":{"label":"Stamp","textAlign":"justify"}},
    {"type":"companyStamp","attrs":{"label":"Stamp"},"content":[]},
    {"type":"companySignature"},
    {"type":"text","text":"top-level"},
    {"type":"hardBreak"}
  ]'::jsonb) loop
    v_bad:=jsonb_build_object('type','doc','content',jsonb_build_array(v_node));
    if public.filey_letter_rich_document_valid(v_bad) then raise exception 'Unsafe rich node accepted: %',v_node; end if;
    begin
      update filey_rich_letter_fixture set value=jsonb_build_array(jsonb_build_object('form',jsonb_build_object('blocks','[]'::jsonb,'rich_document',v_bad)))::text;
      raise exception 'Unsafe form canvas passed database trigger';
    exception when check_violation then null;
    end;
    begin
      update filey_rich_letter_fixture set value=jsonb_build_array(jsonb_build_object('form',jsonb_build_object('blocks','[]'::jsonb),'issued_snapshot',jsonb_build_object('blocks','[]'::jsonb,'rich_document',v_bad)))::text;
      raise exception 'Unsafe issued canvas passed database trigger';
    exception when check_violation then null;
    end;
    if (select value from filey_rich_letter_fixture)<>v_saved then raise exception 'Rejected rich document changed saved data'; end if;
  end loop;

  for v_attrs in select value from jsonb_array_elements('[{"fontFamily":"Inter; background:url(secret)"},{"fontFamily":"Unknown"},{"fontSize":"7pt"},{"fontSize":"37pt"},{"fontSize":"12px"},{"fontSize":"12pt;display:none"},{"color":"red"},{"color":"#abc"},{"color":"url(secret)"},{"opacity":0.5}]'::jsonb) loop
    v_bad:=jsonb_build_object('type','doc','content',jsonb_build_array(jsonb_build_object('type','paragraph','content',jsonb_build_array(
      jsonb_build_object('type','text','text','Text','marks',jsonb_build_array(jsonb_build_object('type','textStyle','attrs',v_attrs)))))));
    if public.filey_letter_rich_document_valid(v_bad) then raise exception 'Arbitrary rich CSS accepted: %',v_attrs; end if;
  end loop;
  if not public.filey_letter_rich_document_valid('{"type":"doc","content":[{"type":"paragraph","attrs":{"textAlign":null,"lineSpacing":null,"paragraphSpacing":null},"content":[{"type":"text","text":"Defaults","marks":[{"type":"textStyle","attrs":{"fontFamily":null,"fontSize":null,"color":null}}]}]}]}') then raise exception 'Safe null editor defaults rejected'; end if;
  foreach v_bad in array array['null'::jsonb,'[]'::jsonb,'{}'::jsonb,'{"type":"doc","content":[]}'::jsonb,
    '{"type":"doc","content":[{"type":"paragraph"}],"html":"private"}'::jsonb] loop
    if public.filey_letter_rich_document_valid(v_bad) then raise exception 'Malformed rich root accepted'; end if;
  end loop;
  v_deep:='{"type":"paragraph"}'::jsonb;
  for i in 1..17 loop v_deep:=jsonb_build_object('type','blockquote','content',jsonb_build_array(v_deep)); end loop;
  if public.filey_letter_rich_document_valid(jsonb_build_object('type','doc','content',jsonb_build_array(v_deep))) then raise exception 'Unbounded rich depth accepted'; end if;
  if public.filey_letter_rich_node_stats(v_deep,'doc',-1,0) is not null then raise exception 'Direct helper caller bypassed depth bounds'; end if;
  select jsonb_build_object('type','doc','content',jsonb_agg('{"type":"paragraph"}'::jsonb)) into v_bad from generate_series(1,20001);
  if public.filey_letter_rich_document_valid(v_bad) then raise exception 'Unbounded rich node count accepted'; end if;
  v_bad:=jsonb_build_object('type','doc','content',jsonb_build_array(jsonb_build_object('type','paragraph','content',jsonb_build_array(jsonb_build_object('type','text','text',repeat('x',250001))))));
  if public.filey_letter_rich_document_valid(v_bad) then raise exception 'Unbounded rich content accepted'; end if;
  select jsonb_agg(jsonb_build_object('type',case when i%2=0 then 'companyStamp' else 'companySignature' end,'attrs',jsonb_build_object('label','','textAlign','left'))) into v_marks from generate_series(1,89) i;
  v_max:=jsonb_build_object('type','doc','content',jsonb_build_array(jsonb_build_object('type','paragraph','content',jsonb_build_array(
    jsonb_build_object('type','text','text',repeat('x',49999)||'😀'||repeat('x',199910)))))||v_marks);
  if not public.filey_letter_rich_document_valid(v_max) then raise exception 'Maximum Unicode-safe prose plus 89 company marks rejected'; end if;
  v_bad:=jsonb_build_object('type','doc','content',jsonb_build_array('{"type":"paragraph"}'::jsonb)||v_marks||jsonb_build_array('{"type":"companySignature","attrs":{"label":""}}'::jsonb));
  if public.filey_letter_rich_document_valid(v_bad) then raise exception 'The 90th company mark passed the legacy projection bound'; end if;
  v_bad:=jsonb_build_object('type','doc','content',jsonb_build_array(jsonb_build_object('type','blockquote','content',v_marks))||jsonb_build_array('{"type":"companyStamp","attrs":{"label":""}}'::jsonb));
  if public.filey_letter_rich_document_valid(v_bad) then raise exception 'Nested company marks bypassed the aggregate bound'; end if;
  -- The optional field must not alter existing saved legacy forms.
  if not public.filey_letter_form_format_valid('{"blocks":[],"body":"legacy"}') then raise exception 'Legacy form rejected by rich migration'; end if;
end $$;
rollback;
select 'PASS: rich Letter JSON is bounded, matches safe frontend schema, preserves legacy forms and is checked on drafts, offline sync and issued snapshots.';
