-- Synthetic data only. Exercise the actual authenticated workflow and audit
-- trigger with non-repeating artwork, not a highly compressible repeat('A').
do $$ declare source jsonb; snapshot jsonb; begin
  if has_function_privilege('anon','public.filey_audit_snapshot(jsonb)','execute')
    or has_function_privilege('authenticated','public.filey_audit_snapshot(jsonb)','execute') then
    raise exception 'Audit snapshot helper must not be a client RPC';
  end if;
  source:=jsonb_build_object('logo','https://example.invalid/logo.png','stamp',null,
    'signature','short image','amount',123.45,'notes',repeat('keep notes ',1000),'custom','{"liters":"300"}'::jsonb);
  snapshot:=public.filey_audit_snapshot(source);
  if snapshot is distinct from source then raise exception 'Non-artwork or small values changed'; end if;
end $$;
set role authenticated;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';
set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
set statement_timeout='8s';
do $$ declare
  artwork text; header jsonb; items jsonb; payload jsonb; result jsonb;
  doc bigint; saved jsonb; created jsonb; changed jsonb; deleted jsonb; audit_count bigint;
  started timestamptz; elapsed numeric; digest text; request uuid:=gen_random_uuid();
begin
  select string_agg(md5(g::text),'') into artwork from generate_series(1,100000) g;
  header:=jsonb_build_object('number','AUDIT-ARTWORK-INV','status','draft','currency','AED',
    'customer_id',910001,'customer_name','Workflow customer','issue_date','2026-10-08',
    'tax_rate',5,'discount',0,'notes','Original notes','logo',artwork,
    'stamp',jsonb_build_object('data',left(artwork,160000),'x',75,'y',70,'opacity',100),
    'signature',jsonb_build_object('data',left(artwork,68000),'x',75,'y',85),
    'custom_columns','[{"key":"liters","label":"T.Liters"}]'::jsonb,
    'unit_price_formula','{"a":"liters","b":"unit_price"}'::jsonb);
  items:='[{"description":"H/O 68 PAIL 20L","qty":50,"unit_price":0.20,"unit":"L","custom":{"liters":"1000"}},
    {"description":"15W40 PAIL 20L","qty":15,"unit_price":0.20,"unit":"L","custom":{"liters":"300"}},
    {"description":"20W50 PAIL 20L","qty":15,"unit_price":0.20,"unit":"L","custom":{"liters":"300"}}]';
  payload:=jsonb_build_object('header',header,'items',items);
  started:=clock_timestamp();
  result:=public.filey_business_workflow('invoice','save',payload,request,auth.uid(),public.current_org());
  elapsed:=round(extract(epoch from clock_timestamp()-started)*1000,1);
  doc:=(result->>'id')::bigint;
  select to_jsonb(d) into saved from public.invoice_docs d where id=doc;
  select changes->'_created' into created from public.audit_log
    where entity='invoice_docs' and details='invoice_docs #'||doc and action='insert';
  digest:=encode(sha256(convert_to((header->'logo')::text,'UTF8')),'hex');
  if created is null or octet_length(created::text)>12000
    or created->'logo'->>'sha256' is distinct from digest
    or (created->'logo'->>'bytes')::integer is distinct from octet_length((header->'logo')::text)
    or created->'logo'->>'json_type' is distinct from 'string'
    or created->'stamp'->>'json_type' is distinct from 'object'
    or created->'signature'->>'_filey_audit_artwork' is distinct from 'true'
    or (created-array['logo','stamp','signature']) is distinct from (saved-array['logo','stamp','signature']) then
    raise exception 'Create audit lost business fields or duplicated large artwork';
  end if;
  if saved->'logo' is distinct from header->'logo' or saved->'stamp' is distinct from header->'stamp'
    or saved->'signature' is distinct from header->'signature'
    or (public.filey_workflow_totals(saved,items)->>'total')::numeric<>336 then
    raise exception 'Audit transform changed the original artwork or financial total';
  end if;
  perform set_config('filey.fixture.audit_save_ms',elapsed::text,false);
  perform set_config('filey.fixture.audit_snapshot_bytes',octet_length(created::text)::text,false);
  select count(*) into audit_count from public.audit_log where entity='invoice_docs' and details='invoice_docs #'||doc;
  if public.filey_business_workflow('invoice','save',payload,request,auth.uid(),public.current_org()) is distinct from result
    or (select count(*) from public.audit_log where entity='invoice_docs' and details='invoice_docs #'||doc)<>audit_count then
    raise exception 'Idempotent replay duplicated audit records';
  end if;
  header:=header||'{"discount":1.25,"tax_rate":7.5,"notes":null}'::jsonb;
  payload:=jsonb_build_object('id',doc,'header',header,'items',items);
  perform public.filey_business_workflow('invoice','save',payload,gen_random_uuid(),auth.uid(),public.current_org());
  select changes into changed from public.audit_log where entity='invoice_docs' and details='invoice_docs #'||doc
    and action='update' order by id desc limit 1;
  if changed->'discount' is distinct from '{"old":0,"new":1.25}'::jsonb
    or changed->'tax_rate' is distinct from '{"old":5,"new":7.5}'::jsonb
    or changed->'notes' is distinct from '{"old":"Original notes","new":null}'::jsonb
    or changed ?| array['logo','stamp','signature','updated_at'] then
    raise exception 'Update audit lost financial/null differences or falsely changed unchanged artwork';
  end if;
  header:=header||jsonb_build_object('logo',artwork||'changed');
  perform public.filey_business_workflow('invoice','save',jsonb_build_object('id',doc,'header',header,'items',items),gen_random_uuid(),auth.uid(),public.current_org());
  select changes into changed from public.audit_log where entity='invoice_docs' and details='invoice_docs #'||doc
    and action='update' order by id desc limit 1;
  if changed->'logo'->'old'->>'sha256' is distinct from digest
    or changed->'logo'->'new'->>'sha256' is distinct from encode(sha256(convert_to((header->'logo')::text,'UTF8')),'hex')
    or octet_length(changed::text)>2000 then
    raise exception 'Changed artwork must have distinct compact before/after fingerprints';
  end if;
  select to_jsonb(d) into saved from public.invoice_docs d where id=doc;
  perform public.filey_business_workflow('invoice','delete',jsonb_build_object('id',doc),gen_random_uuid(),auth.uid(),public.current_org());
  select changes->'_deleted' into deleted from public.audit_log
    where entity='invoice_docs' and details='invoice_docs #'||doc and action='delete';
  if deleted is null or octet_length(deleted::text)>12000
    or deleted->'logo' is distinct from changed->'logo'->'new'
    or (deleted-array['logo','stamp','signature']) is distinct from (saved-array['logo','stamp','signature']) then
    raise exception 'Delete audit lost the final business snapshot or duplicated artwork';
  end if;
end $$;
select 'Authenticated 3.4 MB artwork/custom invoice save: '||current_setting('filey.fixture.audit_save_ms')||' ms; audit snapshot: '||current_setting('filey.fixture.audit_snapshot_bytes')||' bytes';
reset statement_timeout;
reset role;
-- Isolate no-op behavior from invoice sync_revision (which changes on writes).
create temporary table audit_noop_fixture(id bigint, amount numeric, logo text, updated_at timestamptz);
create trigger audit_noop_fixture after insert or update or delete on audit_noop_fixture
  for each row execute function public.log_audit();
insert into audit_noop_fixture values(1,12.5,'small',now());
do $$ declare before_count bigint; begin
  select count(*) into before_count from public.audit_log where entity='audit_noop_fixture';
  if before_count<>1 then raise exception 'No-op fixture initial audit missing'; end if;
  update audit_noop_fixture set updated_at=now()+interval '1 second';
  if (select count(*) from public.audit_log where entity='audit_noop_fixture')<>before_count then
    raise exception 'Timestamp-only update produced an audit row';
  end if;
end $$;
drop table audit_noop_fixture;
select 'PASS: compact INSERT/UPDATE/DELETE artwork audit; exact business fields, financial/null diffs, unchanged artwork, no-op updates, original images and idempotent replay.';
