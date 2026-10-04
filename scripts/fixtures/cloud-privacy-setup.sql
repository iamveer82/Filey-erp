-- Isolated synthetic identities; no production accounts or stored bytes.
insert into auth.users(id,email,email_confirmed_at) values
 ('c0000000-0000-4000-8000-000000000001','alpha@privacy.invalid',now()),
 ('c0000000-0000-4000-8000-000000000002','beta@privacy.invalid',now()),
 ('c0000000-0000-4000-8000-000000000003','third@privacy.invalid',now());

insert into storage.objects(bucket_id,name,owner,metadata) values
 ('tool-outputs','c0000000-0000-4000-8000-000000000001/baseline/out.pdf','c0000000-0000-4000-8000-000000000001','{"size":4,"mimetype":"application/pdf"}'),
 ('tool-outputs','c0000000-0000-4000-8000-000000000002/baseline/out.pdf','c0000000-0000-4000-8000-000000000002','{"size":4,"mimetype":"application/pdf"}');
insert into public.tool_runs(id,user_id,org_id,tool,storage_paths,created_at)
 select 990001,id,org_id,'fixture',array[id::text||'/baseline/out.pdf'],now()-interval '1 hour'
 from public.profiles where id='c0000000-0000-4000-8000-000000000001'
 union all
 select 990002,id,org_id,'fixture',array[id::text||'/baseline/out.pdf'],now()-interval '1 hour'
 from public.profiles where id='c0000000-0000-4000-8000-000000000002';
update storage.buckets set public=true where id in ('files','tool-inputs','tool-outputs','team-attachments');
update storage.buckets set file_size_limit=123456,allowed_mime_types=array['application/pdf'] where id='files';
insert into storage.buckets(id,name,public) values('unrelated-public','unrelated-public',true);
