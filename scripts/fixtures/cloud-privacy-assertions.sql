do $$ begin
  if exists(select 1 from storage.buckets where id in ('files','tool-inputs','tool-outputs','team-attachments') and public is distinct from false) then raise exception 'Intended-private bucket remains public'; end if;
  if not exists(select 1 from storage.buckets where id='files' and file_size_limit=123456 and allowed_mime_types=array['application/pdf']) then raise exception 'Privacy repair changed existing file limits'; end if;
  if not exists(select 1 from storage.buckets where id='unrelated-public' and public) then raise exception 'Privacy repair changed unrelated bucket'; end if;
end $$;
insert into storage.objects(bucket_id,name,owner,metadata) values
 ('files','c0000000-0000-4000-8000-000000000001/private.pdf','c0000000-0000-4000-8000-000000000001','{"size":4}'),
 ('files','c0000000-0000-4000-8000-000000000002/private.pdf','c0000000-0000-4000-8000-000000000002','{"size":4}'),
 ('tool-inputs','c0000000-0000-4000-8000-000000000001/input/source.pdf','c0000000-0000-4000-8000-000000000001','{"size":4}'),
 ('tool-inputs','c0000000-0000-4000-8000-000000000002/input/source.pdf','c0000000-0000-4000-8000-000000000002','{"size":4}'),
 ('tool-outputs','c0000000-0000-4000-8000-000000000001/retention/own.pdf','c0000000-0000-4000-8000-000000000001','{"size":4}'),
 ('tool-outputs','c0000000-0000-4000-8000-000000000002/retention/protected.pdf','c0000000-0000-4000-8000-000000000002','{"size":4}');
set role authenticated;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
do $$ begin
  begin perform public.prune_tool_runs(interval '-1 day');raise exception 'Client retention access survived';exception when insufficient_privilege then null;end;
  begin perform public.filey_agent_workspace_allowed(auth.uid(),public.current_org());raise exception 'Client scheduled helper access survived';exception when insufficient_privilege then null;end;
  if (select count(*) from storage.objects)<>3 then raise exception 'Personal storage owner read boundary failed';end if;
  update storage.objects set metadata='{"forged":true}' where name='c0000000-0000-4000-8000-000000000002/retention/protected.pdf';
  if found then raise exception 'Foreign output update allowed';end if;
  delete from storage.objects where name='c0000000-0000-4000-8000-000000000002/retention/protected.pdf';
  if found then raise exception 'Foreign output delete allowed';end if;
  begin insert into storage.objects(bucket_id,name) values('tool-inputs','c0000000-0000-4000-8000-000000000002/forged.pdf');raise exception 'Foreign input upload allowed';exception when insufficient_privilege then null;end;
end $$;
insert into public.tool_runs(id,tool,storage_paths,created_at) values(990010,'fixture',array[
 'c0000000-0000-4000-8000-000000000001/retention/own.pdf',
 'c0000000-0000-4000-8000-000000000002/retention/protected.pdf'],now()-interval '31 days');
reset role;reset request.jwt.claim.sub;reset request.jwt.claims;
set role service_role;set request.jwt.claims='{"role":"service_role"}';select public.prune_tool_runs();reset role;reset request.jwt.claims;
do $$ begin
  if exists(select 1 from public.tool_runs where id=990010) or exists(select 1 from storage.objects where name='c0000000-0000-4000-8000-000000000001/retention/own.pdf') then raise exception 'Own old retention cleanup failed';end if;
  if not exists(select 1 from storage.objects where name='c0000000-0000-4000-8000-000000000002/retention/protected.pdf') then raise exception 'Forged retention path deleted another user output';end if;
end $$;
select 'PASS: client retention/scheduled RPCs denied; cross-owner reads, writes, deletes and upload denied; service cleanup preserves foreign paths and deletes valid own output.';

-- Secret columns are inaccessible even to the key's owner; metadata is useful.
insert into public.integration_keys(user_id,provider,api_key) values('c0000000-0000-4000-8000-000000000001','composio','synthetic-private-key');
insert into public.agent_channels(user_id,provider,credentials) values('c0000000-0000-4000-8000-000000000001','telegram','{"bot_token":"synthetic-bot-secret"}');
set role authenticated;set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
do $$ begin
  if (select count(*) from public.integration_keys where provider='composio')<>1 then raise exception 'Own key metadata read failed';end if;
  begin perform api_key from public.integration_keys;raise exception 'Own integration secret readable';exception when insufficient_privilege then null;end;
  begin perform credentials from public.agent_channels;raise exception 'Own channel secrets readable';exception when insufficient_privilege then null;end;
end $$;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000002';
do $$ begin if exists(select user_id from public.integration_keys) then raise exception 'Other user key metadata readable';end if;end $$;
reset role;reset request.jwt.claim.sub;reset request.jwt.claims;

insert into public.tool_jobs(id,user_id,tool,status,engine,input_path,output_paths) values
 ('c1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','rotate','done','edge','c0000000-0000-4000-8000-000000000001/input/source.pdf',array['c0000000-0000-4000-8000-000000000001/result/out.pdf']),
 ('c1000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002','rotate','done','edge','c0000000-0000-4000-8000-000000000002/input/source.pdf',array['c0000000-0000-4000-8000-000000000002/result/out.pdf']);
set role authenticated;set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
do $$ begin
  if (select count(*) from public.tool_jobs)<>1 then raise exception 'Tool job output scope failed';end if;
  begin update public.tool_jobs set output_paths=array['c0000000-0000-4000-8000-000000000002/forged.pdf'];raise exception 'Client job output mutation allowed';exception when insufficient_privilege then null;end;
  begin insert into public.tool_jobs(tool,input_path) values('rotate','c0000000-0000-4000-8000-000000000002/input/source.pdf');raise exception 'Cross-user job input allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;reset request.jwt.claim.sub;reset request.jwt.claims;
insert into auth.mfa_factors(id,user_id,status,factor_type) values('c2000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','verified','totp');
set role authenticated;set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
do $$ begin if exists(select 1 from storage.objects) or exists(select 1 from public.tool_jobs) then raise exception 'AAL1 bypassed storage/Realtime job MFA policy';end if;end $$;
set request.jwt.claims='{"role":"authenticated","aal":"aal2"}';
do $$ begin if (select count(*) from storage.objects)<>2 or (select count(*) from public.tool_jobs)<>1 then raise exception 'AAL2 owner reads failed';end if;end $$;
reset role;reset request.jwt.claim.sub;reset request.jwt.claims;
delete from auth.mfa_factors;
select 'PASS: integration/channel secrets, cross-user job outputs/specifications and AAL1 storage/Realtime reads remain isolated; own metadata and AAL2 reads work.';

-- One active workspace for a direct conversation, including a third-party admin.
insert into public.org_members(org_id,user_id,role) select org_id,'c0000000-0000-4000-8000-000000000002','staff' from public.profiles where id='c0000000-0000-4000-8000-000000000001';
insert into public.org_members(org_id,user_id,role) select org_id,'c0000000-0000-4000-8000-000000000003','admin' from public.profiles where id='c0000000-0000-4000-8000-000000000001';
update public.profiles set org_id=(select org_id from public.profiles where id='c0000000-0000-4000-8000-000000000001') where id in ('c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000003');
set role authenticated;set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
insert into storage.objects(bucket_id,name,owner,metadata) values('team-attachments',public.current_org()||'/c0000000-0000-4000-8000-000000000001/c3000000-0000-4000-8000-000000000001.pdf',auth.uid(),'{"size":4,"mimetype":"application/pdf"}');
insert into public.org_messages(body,channel,recipient_id,attachments) values('Synthetic direct-only document','general','c0000000-0000-4000-8000-000000000002',jsonb_build_array(jsonb_build_object('name','Private.pdf','size',4,'mime','application/pdf','path',public.current_org()||'/c0000000-0000-4000-8000-000000000001/c3000000-0000-4000-8000-000000000001.pdf')));
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000002';
do $$ begin if (select count(*) from storage.objects where bucket_id='team-attachments')<>1 then raise exception 'DM recipient cannot read shared file';end if;end $$;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000003';
do $$ begin if exists(select 1 from storage.objects where bucket_id='team-attachments') or exists(select 1 from public.org_messages where recipient_id is not null) then raise exception 'Unrelated admin reads private direct attachment/chat';end if;end $$;
reset role;reset request.jwt.claim.sub;reset request.jwt.claims;

set role service_role;set request.jwt.claims='{"role":"service_role"}';
do $$ begin if public.filey_agent_workspace_allowed('c0000000-0000-4000-8000-000000000001',(select org_id from public.profiles where id='c0000000-0000-4000-8000-000000000001')) is not true then raise exception 'Stable admin cannot receive scheduled job';end if;end $$;
reset role;reset request.jwt.claims;
update public.org_members set role='staff' where user_id='c0000000-0000-4000-8000-000000000001';
set role service_role;set request.jwt.claims='{"role":"service_role"}';
do $$ begin if public.filey_agent_workspace_allowed('c0000000-0000-4000-8000-000000000001',(select org_id from public.profiles where id='c0000000-0000-4000-8000-000000000001')) then raise exception 'Demoted owner allowed scheduled private output';end if;end $$;
reset role;reset request.jwt.claims;
update public.org_members set role='owner' where user_id='c0000000-0000-4000-8000-000000000001';
delete from public.org_members where user_id='c0000000-0000-4000-8000-000000000001';
set role service_role;set request.jwt.claims='{"role":"service_role"}';
do $$ begin if public.filey_agent_workspace_allowed('c0000000-0000-4000-8000-000000000001',(select org_id from public.profiles where id='c0000000-0000-4000-8000-000000000001')) then raise exception 'Removed membership allowed scheduled private output';end if;end $$;
reset role;reset request.jwt.claims;
insert into public.org_members(org_id,user_id,role) select org_id,id,'owner' from public.profiles where id='c0000000-0000-4000-8000-000000000001';
update public.profiles set org_id='changed-synthetic-workspace' where id='c0000000-0000-4000-8000-000000000001';
set role service_role;set request.jwt.claims='{"role":"service_role"}';
do $$ begin if public.filey_agent_workspace_allowed('c0000000-0000-4000-8000-000000000001',(select org_id from public.org_members where user_id='c0000000-0000-4000-8000-000000000001')) then raise exception 'Changed workspace allowed old scheduled private output';end if;end $$;
reset role;reset request.jwt.claims;
update public.profiles set org_id=(select org_id from public.org_members where user_id='c0000000-0000-4000-8000-000000000001') where id='c0000000-0000-4000-8000-000000000001';
select 'PASS: DM recipient file sharing works; unrelated workspace admin cannot read DM/chat file; scheduled helper denies revoked role, removed membership and changed active workspace.';

insert into public.invoice_docs(id,user_id,org_id,number,status,customer_name,shared,public_shared,share_token)
 select 990100,id,org_id,'PRIVACY-1','draft','Synthetic public customer',true,true,'c4000000-0000-4000-8000-000000000001' from public.profiles where id='c0000000-0000-4000-8000-000000000001';
insert into public.invoice_doc_items(invoice_id,user_id,org_id,description,qty,unit_price,position)
 select 990100,id,org_id,'Intended public item',1,1,0 from public.profiles where id='c0000000-0000-4000-8000-000000000001';
insert into public.invoice_doc_items(invoice_id,user_id,org_id,description,qty,unit_price,position)
 select 990100,owner_id,id::text,'Unrelated private organization item',1,999,1 from public.organizations where owner_id='c0000000-0000-4000-8000-000000000002';
-- Insert/import cannot publish a document or preserve an inherited bearer link.
do $$ begin
  if (select public_shared or share_token='c4000000-0000-4000-8000-000000000001'::uuid from public.invoice_docs where id=990100) then raise exception 'Insert inherited public access';end if;
end $$;
select set_config('filey.test_private_token',(select share_token::text from public.invoice_docs where id=990100),false);
set role anon;set request.jwt.claims='{"role":"anon"}';
do $$ declare document jsonb;begin
  begin perform public.prune_tool_runs();raise exception 'Anon retention allowed';exception when insufficient_privilege then null;end;
  if exists(select 1 from storage.objects) or exists(select 1 from public.invoice_docs) then raise exception 'Anonymous table/private file read allowed';end if;
  if public.get_shared_invoice(current_setting('filey.test_private_token')::uuid) is not null then raise exception 'Team-only document became public';end if;
  if public.get_shared_invoice('c4000000-0000-4000-8000-000000000001') is not null then raise exception 'Inherited token leaked document';end if;
end $$;
reset role;reset request.jwt.claims;
set role authenticated;set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
select set_config('filey.test_public_token',public.filey_set_public_document_link('invoice',990100,true,public.current_org())::text,false);
-- Team visibility and explicit public-link access are independent.
update public.invoice_docs set shared=false where id=990100;
reset role;reset request.jwt.claim.sub;reset request.jwt.claims;
set role anon;set request.jwt.claims='{"role":"anon"}';
do $$ declare document jsonb;begin
  document:=public.get_shared_invoice(current_setting('filey.test_public_token')::uuid);
  if document is null or document->'doc' ?| array['user_id','org_id','shared','shared_with','public_shared','share_token'] or jsonb_array_length(document->'items')<>1 then raise exception 'Token-scoped public document gate failed';end if;
  if document->'items'->0->>'description' is distinct from 'Intended public item' then raise exception 'Public document included another organization item';end if;
  if public.get_shared_invoice(current_setting('filey.test_private_token')::uuid) is not null then raise exception 'Pre-enable token became public';end if;
  if public.get_shared_invoice('c4000000-0000-4000-8000-000000000002') is not null then raise exception 'Unknown token leaked document';end if;
end $$;
reset role;reset request.jwt.claims;
set role authenticated;set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
select public.filey_set_public_document_link('invoice',990100,false,public.current_org());
update public.invoice_docs set shared=true where id=990100;
reset role;reset request.jwt.claim.sub;reset request.jwt.claims;
set role anon;set request.jwt.claims='{"role":"anon"}';
do $$ begin if public.get_shared_invoice(current_setting('filey.test_public_token')::uuid) is not null then raise exception 'Revoked share remains public';end if;end $$;
reset role;reset request.jwt.claims;
select 'PASS: anonymous storage/table/maintenance denied; only an owner-enabled public link works without authority fields or foreign items; team-only, inherited, unknown and revoked links stay private.';
