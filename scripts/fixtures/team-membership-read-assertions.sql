set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000002';
do $$ begin
  assert current_org()='10000000-0000-0000-0000-000000000001','Repair must not rewrite active workspace';
  assert (select count(*) from org_members where org_id=current_org())=0,'Removed member reads former roster';
  assert (select count(*) from org_members)=1,'Own other-workspace membership must remain readable';
  assert (select count(*) from profiles)=1,'Removed member reads former colleague profiles';
  assert (select id from profiles)=auth.uid(),'Own profile must remain readable';
  assert (select count(*) from company_profile)=0,'Removed member reads company/bank identity';
  assert (select count(*) from organizations)=1,'Removed member reads former organization';
  assert (select owner_id from organizations)=auth.uid(),'Own organization must remain readable';
  assert not filey_cloud_access(),'Removed member retains cloud allowance';
  assert filey_invoice_usage()=0,'Removed member reads former company activity';
  assert not filey_is_workspace_member('10000000-0000-0000-0000-000000000001');
  assert filey_is_workspace_member('10000000-0000-0000-0000-000000000002');
  assert (select count(*) from audit_log)=0,'Removed member reads private audit diffs';
  assert (select count(*) from app_users)=0,'Removed member reads legacy users';
  update app_users set active=false where id=1;
  begin
    insert into app_users values(2,current_org(),auth.uid(),'forged','Forged user',true);
    raise exception 'Removed member creates legacy user';
  exception when insufficient_privilege then null; end;
  begin
    insert into audit_log(id,org_id,user_id,entity) values(9,current_org(),auth.uid(),'forged');
    raise exception 'Removed member appends audit';
  exception when insufficient_privilege then null; end;
end $$;
set test.uid='00000000-0000-0000-0000-000000000003';
do $$ begin
  assert (select count(*) from org_members)=2,'Current member loses team roster';
  assert (select count(*) from profiles)=3,'Current member loses colleague identities';
  assert (select count(*) from company_profile)=1,'Current member loses company identity';
  assert (select count(*) from organizations)=1,'Current member loses organization';
  assert filey_cloud_access(),'Current member loses cloud allowance';
  assert filey_invoice_usage()=19,'Current member loses permitted activity counter';
  assert not filey_is_workspace_member('10000000-0000-0000-0000-000000000002'),'Membership helper crosses companies';
  update company_profile set bank_details='Forged bank';
  assert (select bank_details from company_profile)='Synthetic bank details','Member rewrites company identity';
  assert (select count(*) from audit_log)=0,'Restricted member reads private record audit';
  assert (select count(*) from app_users)=1,'Current member loses legacy user compatibility';
  assert (select active from app_users where id=1),'Removed member changed legacy user';
  insert into audit_log(id,org_id,user_id,entity) values(3,current_org(),auth.uid(),'member_event');
  begin
    insert into audit_log(id,org_id,user_id,entity) values(8,current_org(),'00000000-0000-0000-0000-000000000001','impersonation');
    raise exception 'Member impersonates another audit actor';
  exception when insufficient_privilege then null; end;
end $$;
-- Explicit self-leaving must immediately revoke reads without a profile rewrite.
delete from org_members where org_id=current_org() and user_id=auth.uid();
do $$ begin
  assert (select count(*) from company_profile)=0,'Leaving retains company identity';
  assert (select count(*) from org_members)=0,'Leaving retains roster';
  assert (select count(*) from profiles)=1,'Leaving retains coworker profiles';
  assert not filey_cloud_access(),'Leaving retains cloud access';
  assert filey_invoice_usage()=0,'Leaving retains activity counter';
  assert (select count(*) from audit_log)=0,'Leaving retains audit access';
  assert (select count(*) from app_users)=0,'Leaving retains legacy users';
end $$;
reset role;
-- A limited current member may read shared identity, never restricted usage.
insert into org_members values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','staff',array['team']);
set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000003';
do $$ begin
  assert (select count(*) from company_profile)=1,'Limited member loses shared identity';
  assert filey_invoice_usage()=0,'Activity RPC bypasses Invoicing module denial';
end $$;
set test.uid='00000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from profiles)=3,'Owner loses team identities';
  assert (select count(*) from org_members)=2,'Owner loses team roster';
  update company_profile set bank_details='Owner updated synthetic bank';
  assert (select bank_details from company_profile)='Owner updated synthetic bank','Owner cannot edit company identity';
  assert filey_invoice_usage()=19,'Owner loses activity counter';
  assert (select count(*) from audit_log)=3,'Owner loses private audit history or member append';
  assert (select user_id from audit_log where id=3)='00000000-0000-0000-0000-000000000003','Member append attribution changed';
  assert (select changes->'_created'->>'salary' from audit_log where id=2)='8000','Audit history was rewritten';
  update audit_log set entity='changed';
  delete from audit_log;
  assert (select count(*) from audit_log)=3,'Audit history is no longer append only';
  assert (select entity from audit_log where id=2)='payroll','Audit history is editable';
end $$;
set test.uid='00000000-0000-0000-0000-000000000099';
do $$ begin
  assert (select count(*) from company_profile)=0,'No-profile caller reads company';
  assert not filey_cloud_access(),'No-profile caller gets cloud access';
  assert filey_invoice_usage()=0,'Default workspace cast causes failure or activity leak';
end $$;
reset role;
do $$ begin
  assert not has_function_privilege('anon','filey_is_workspace_member(text)','EXECUTE'),'Anonymous membership enumeration allowed';
  assert not has_function_privilege('anon','filey_cloud_access()','EXECUTE');
  assert not has_function_privilege('anon','filey_invoice_usage()','EXECUTE');
  assert has_function_privilege('authenticated','filey_is_workspace_member(text)','EXECUTE');
end $$;
select 'PASS: removed/leaving users denied; private audits admin-only and immutable, own-event appends protected, legacy users fenced; current/limited members, owner, missing profiles and ACLs verified.';
