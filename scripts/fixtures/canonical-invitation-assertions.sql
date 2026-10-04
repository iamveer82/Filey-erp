insert into invitations(id,org_id,email,role) values
  ('80000000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000001','staff@example.invalid','admin'),
  ('80000000-0000-4000-8000-000000000002','10000000-0000-0000-0000-000000000001','staff@example.invalid','staff'),
  ('80000000-0000-4000-8000-000000000003','10000000-0000-0000-0000-000000000001','stranger@example.invalid','staff'),
  ('80000000-0000-4000-8000-000000000004','10000000-0000-0000-0000-000000000001','unverified@example.invalid','staff');
update invitations set expires_at=now()-interval '1 second' where id='80000000-0000-4000-8000-000000000003';
set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000003';
update profiles set email='staff@example.invalid' where id=auth.uid();
do $$ declare denied boolean:=false; begin
  assert my_email()='stranger@example.invalid','Canonical helper cannot trust editable profile email';
  begin perform accept_invitation('80000000-0000-4000-8000-000000000001');exception when raise_exception then denied:=true;end;
  assert denied,'Forged display email cannot accept another verified recipient invitation';
  denied:=false;
  begin perform accept_invitation('80000000-0000-4000-8000-000000000003');exception when raise_exception then denied:=true;end;
  assert denied,'Expired invite must be denied in the canonical RPC';
end $$;
set test.uid='00000000-0000-0000-0000-000000000004';
do $$ declare denied boolean:=false; begin
  assert my_email() is null,'Unverified auth email is not proof';
  begin perform accept_invitation('80000000-0000-4000-8000-000000000004');exception when raise_exception then denied:=true;end;
  assert denied,'Unverified recipient cannot accept';
end $$;
reset role;
-- An old admin invitation must not promote someone who already joined as staff.
insert into org_members(org_id,user_id,role,modules) values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','staff',array['team']);
set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000002';
select accept_invitation('80000000-0000-4000-8000-000000000001');
reset role;
do $$ begin
  assert exists(select 1 from org_members where org_id='10000000-0000-0000-0000-000000000001' and user_id='00000000-0000-0000-0000-000000000002' and role='staff' and modules=array['team']),'Old invite must preserve actual permissions';
  assert (select status from invitations where id='80000000-0000-4000-8000-000000000002')='revoked','Competing same-email invites must be invalidated';
  assert not has_function_privilege('anon','public.my_email()','execute'),'Canonical identity helper denies anonymous RPC';
  assert not has_function_privilege('anon','public.accept_invitation(uuid)','execute'),'Canonical acceptance denies anonymous RPC';
end $$;
select 'PASS: actual canonical SQL verifies auth email/expiry/role preservation/sibling revocation/anonymous ACL.';
