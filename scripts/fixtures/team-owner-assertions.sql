set role authenticated;
set test.claims='{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}';
set test.org='10000000-0000-0000-0000-000000000001';
do $$ begin
  begin update organizations set owner_id=auth.uid() where id=current_org()::uuid;
    raise exception 'Admin rewrote organization ownership before membership takeover'; exception when insufficient_privilege then null; end;
  perform assert_equal((select owner_id from organizations where id=current_org()::uuid),'00000000-0000-0000-0000-000000000001'::uuid,'Admin cannot reassign owner_id before demoting owner');
  begin update org_members set role='viewer' where user_id='00000000-0000-0000-0000-000000000001';
    raise exception 'Admin demoted actual owner'; exception when insufficient_privilege then null; end;
  begin delete from org_members where user_id='00000000-0000-0000-0000-000000000001';
    raise exception 'Admin removed actual owner'; exception when insufficient_privilege then null; end;
  begin update org_members set user_id='00000000-0000-0000-0000-000000000004' where user_id='00000000-0000-0000-0000-000000000001';
    raise exception 'Admin rewrote actual owner'; exception when insufficient_privilege then null; end;
  begin update org_members set role='owner' where user_id=auth.uid();
    raise exception 'Admin manufactured owner role'; exception when insufficient_privilege then null; end;
  begin update org_members set user_id='00000000-0000-0000-0000-000000000004' where user_id='00000000-0000-0000-0000-000000000003';
    raise exception 'Admin rewrote member identity'; exception when insufficient_privilege then null; end;
end $$;
update org_members set role='viewer' where user_id='00000000-0000-0000-0000-000000000003';
select assert_equal((select role from org_members where user_id='00000000-0000-0000-0000-000000000003'),'viewer'::text,'Ordinary member role administration still works');
delete from org_members where user_id='00000000-0000-0000-0000-000000000003';
select assert_equal((select count(*) from org_members where user_id='00000000-0000-0000-0000-000000000003'),0::bigint,'Ordinary member removal still works');
set test.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
do $$ begin
  begin delete from org_members where user_id=auth.uid();
    raise exception 'Actual owner left workspace stranded'; exception when insufficient_privilege then null; end;
end $$;
set test.claims='{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}';
delete from org_members where user_id=auth.uid();
select assert_equal((select count(*) from org_members where user_id='00000000-0000-0000-0000-000000000002'),0::bigint,'Non-owner can leave workspace');
reset role;
-- Trusted cleanup/account deletion can still remove ownership membership.
set test.claims='{"role":"service_role"}';
set role service_role;
delete from org_members;
select assert_equal((select count(*) from org_members),0::bigint,'Trusted cleanup remains usable');
reset role;
select 'PASS: proven prior admin takeover denied; owner identity/role/removal guarded; member administration, leaving and trusted cleanup remain usable.';
