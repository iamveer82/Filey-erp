set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000001';
do $$ declare spec jsonb; denied boolean; begin
  for spec in select value from jsonb_array_elements('[{"status":"done"},{"status":"processing"},{"output_paths":["00000000-0000-0000-0000-000000000001/fake.pdf"]},{"error":"fake"},{"engine":"unknown"},{"tool":"unknown"},{"tool":"ocr","engine":"edge"},{"tool":"rotate","engine":"worker"},{"params":[]}]') loop
    denied:=false;
    begin
      insert into tool_jobs(tool,input_path,status,engine,params,output_paths,error)
        values(coalesce(spec->>'tool','rotate'),auth.uid()::text||'/original.pdf',coalesce(spec->>'status','pending'),
          coalesce(spec->>'engine','edge'),coalesce(spec->'params','{}'::jsonb),
          coalesce(array(select jsonb_array_elements_text(spec->'output_paths')),'{}'::text[]),spec->>'error');
    exception when insufficient_privilege or invalid_parameter_value then denied:=true; end;
    if not denied then raise exception 'Unsafe client job admitted: %',spec; end if;
  end loop;
end $$;
-- The same per-user admission protects direct REST worker jobs and edge jobs.
insert into tool_jobs(id,tool,engine,input_path) select
  ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  case when n%2=0 then 'ocr' else 'rotate' end,case when n%2=0 then 'worker' else 'edge' end,
  auth.uid()::text||'/source.pdf' from generate_series(1,15) n;
do $$ declare denied boolean:=false; begin
  begin insert into tool_jobs(tool,engine,input_path) values('ocr','worker',auth.uid()::text||'/source.pdf');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Direct worker INSERT bypassed job quota'; end if;
  denied:=false;
  begin update tool_jobs set status='done',params='{"degrees":180}' where id='50000000-0000-4000-8000-000000000001';
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Client can rewrite status/specification after admission'; end if;
end $$;
delete from tool_jobs where id='50000000-0000-4000-8000-000000000015';
reset role;
do $$ begin
  if (select used from edge_rate_limits where action='tool_job_create')<>15 then raise exception 'Admission did not count exactly the valid jobs'; end if;
  if has_column_privilege('authenticated','tool_jobs','status','UPDATE') then raise exception 'Legacy update grant survived'; end if;
end $$;
-- Server claims/results stay possible; active client deletion cannot cancel a
-- different server claim, and foreign account visibility remains denied.
set role service_role;
set test.role='service_role';
update tool_jobs set status='processing',updated_at=clock_timestamp() where id='50000000-0000-4000-8000-000000000001';
reset role;
set test.role='authenticated';
set role authenticated;
do $$ declare n bigint; begin
  delete from tool_jobs where id='50000000-0000-4000-8000-000000000001';
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Client deleted an active server claim'; end if;
end $$;
set test.uid='00000000-0000-0000-0000-000000000002';
do $$ begin if exists(select 1 from tool_jobs) then raise exception 'Other account jobs exposed'; end if; end $$;
insert into tool_jobs(tool,input_path) values('rotate',auth.uid()::text||'/own.pdf');
reset role;
select 'PASS: job admission/quota, immutable specs/results, pending cancellation, server claims and account separation.';
