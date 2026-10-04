set role authenticated;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000002';
set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
do $$ begin
  if exists(select 1 from public.tool_runs where id=990001) then raise exception 'Baseline caller unexpectedly reads another owner run'; end if;
  perform public.prune_tool_runs(interval '-1 day');
end $$;
reset role;reset request.jwt.claim.sub;reset request.jwt.claims;
do $$ begin
  if exists(select 1 from public.tool_runs where id in (990001,990002)) or exists(select 1 from storage.objects where name like '%/baseline/out.pdf') then
    raise exception 'Baseline retention Execute bypass was not reproduced';
  end if;
end $$;
select 'BASELINE REPRODUCED: a client unable to read another owner run deletes both owners runs and outputs through the legacy definer RPC.';

-- Cross-owner paths are writable on an otherwise valid own run. Even without
-- client Execute, the old service cron trusts this attacker-controlled list.
insert into storage.objects(bucket_id,name,owner,metadata) values
 ('tool-outputs','c0000000-0000-4000-8000-000000000002/foreign/protected.pdf','c0000000-0000-4000-8000-000000000002','{"size":4}');
set role authenticated;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';
set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
insert into public.tool_runs(id,tool,storage_paths,created_at) values(990003,'fixture',array['c0000000-0000-4000-8000-000000000002/foreign/protected.pdf'],now()-interval '31 days');
reset role;reset request.jwt.claim.sub;reset request.jwt.claims;
set role service_role;set request.jwt.claims='{"role":"service_role"}';
select public.prune_tool_runs();
reset role;reset request.jwt.claims;
do $$ begin
  if exists(select 1 from storage.objects where name='c0000000-0000-4000-8000-000000000002/foreign/protected.pdf') then
    raise exception 'Baseline forged retention path was not reproduced';
  end if;
end $$;
select 'BASELINE REPRODUCED: service retention follows a forged old own-run path and deletes the other owner output.';

insert into storage.buckets(id,name,public) values('files','files',false) on conflict(id) do nothing;
insert into storage.buckets(id,name,public) values('tool-inputs','tool-inputs',false) on conflict(id) do nothing;
insert into storage.buckets(id,name,public) values('tool-outputs','tool-outputs',false) on conflict(id) do nothing;
do $$ begin
  if (select count(*) from storage.buckets where id in ('files','tool-inputs','tool-outputs') and public)<>3 then
    raise exception 'Baseline public bucket drift was not reproduced';
  end if;
end $$;
select 'BASELINE REPRODUCED: legacy ON CONFLICT DO NOTHING preserves three unintended public buckets.';
