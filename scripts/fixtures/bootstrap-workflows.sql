-- Exercise the actual installed application definitions, not helper stubs.
set role authenticated;
set request.jwt.claim.sub='b0000000-0000-4000-8000-000000000003';
set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
do $$ declare own_org text:=public.current_org(); begin
  if own_org is null or (select count(*) from public.filey_workspaces())<>1
    or not exists(select 1 from public.filey_workspaces() where id=own_org and role='owner') then
    raise exception 'Pre-existing Auth account did not receive its private owner workspace';
  end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and email='existing@bootstrap.invalid' and name='Existing Auth account') then
    raise exception 'Pre-existing Auth profile did not use trusted Auth account identity';
  end if;
  update public.profiles set company='Existing account edited its own company' where id=auth.uid();
  if not found or public.current_org()<>own_org then raise exception 'Existing account profile edit contract failed'; end if;
end $$;
reset role;
reset request.jwt.claim.sub;
reset request.jwt.claims;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('b0000000-0000-4000-8000-000000000001','alpha@bootstrap.invalid',now(),'{"name":"Alpha"}'),
 ('b0000000-0000-4000-8000-000000000002','beta@bootstrap.invalid',now(),'{"name":"Beta"}');
insert into org_members(org_id,user_id,role)
  select p.org_id,'b0000000-0000-4000-8000-000000000001','staff' from profiles p where p.id='b0000000-0000-4000-8000-000000000002';
-- A user's data in another valid workspace must not be retagged to the active
-- profile workspace when the full installer is repeated.
insert into products(id,user_id,org_id,sku,name,quantity)
 select 900001,'b0000000-0000-4000-8000-000000000001',org_id,'KEEP-B','Historical workspace stock',7
 from profiles where id='b0000000-0000-4000-8000-000000000002';
insert into invoice_docs(id,user_id,org_id,number,status,customer_name,notes)
 select 900001,'b0000000-0000-4000-8000-000000000001',org_id,'KEEP-B','draft','Historical customer','Keep customer notes'
 from profiles where id='b0000000-0000-4000-8000-000000000002';
insert into ai_credit_accounts(user_id,balance_micros,task_limit_micros,daily_limit_micros)
 values('b0000000-0000-4000-8000-000000000001',1234567,2000000,6000000);
set role authenticated;
set request.jwt.claim.sub='b0000000-0000-4000-8000-000000000001';
set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
do $$ declare own_org text:=public.current_org(); other_org text; created_org text; invited jsonb; msg jsonb; msg_id bigint; begin
  if (select count(*) from public.filey_workspaces())<>2 then raise exception 'Workspace listing does not include both memberships'; end if;
  created_org:=public.filey_create_workspace('Bootstrap additional workspace');
  perform public.filey_switch_workspace(created_org);
  if public.current_org()<>created_org then raise exception 'Workspace creation/switch failed'; end if;
  perform public.filey_switch_workspace(own_org);
  invited:=public.filey_prepare_invitation('beta@bootstrap.invalid','staff',array['team']);
  if invited->>'email'<>'beta@bootstrap.invalid' then raise exception 'Verified invitation preparation failed'; end if;
  insert into org_messages(body,channel) values('Bootstrap public team message','general') returning id into msg_id;
  msg:=public.filey_message_page('general',null,30);
  if jsonb_array_length(msg->'rows')<>1 then raise exception 'Installed team page RPC failed'; end if;
  perform public.filey_mark_channel_read('general',msg_id);
  if not exists(select 1 from org_channel_reads where user_id=auth.uid() and org_id=own_org and last_message_id=msg_id) then raise exception 'Installed channel read state failed'; end if;
  begin perform public.filey_switch_workspace('ffffffff-ffff-4fff-8fff-ffffffffffff'); raise exception 'Foreign switch unexpectedly succeeded';
  exception when others then if sqlerrm<>'You are not a member of this workspace' then raise; end if; end;
end $$;
set request.jwt.claim.sub='b0000000-0000-4000-8000-000000000002';
do $$ declare invites jsonb; token uuid; begin
  invites:=public.filey_my_invitations();
  if jsonb_array_length(invites)<>1 then raise exception 'Verified invitation listing failed'; end if;
  token:=(invites->0->>'id')::uuid;
  perform public.accept_invitation(token);
  if not exists(select 1 from public.filey_workspaces() where id=public.current_org() and role='staff') then raise exception 'Invitation did not create staff membership'; end if;
  if not exists(select 1 from public.filey_team_members() where user_id='b0000000-0000-4000-8000-000000000001') then raise exception 'Installed team member RPC failed'; end if;
end $$;
reset role;
reset request.jwt.claim.sub;
reset request.jwt.claims;
select 'PASS: existing Auth account provisioning/edit, real signup, workspace create/list/switch/denial, invitation prepare/list/accept, team members/page/channel read workflows.';
