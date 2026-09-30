select assert_equal((select substring(setting from length('pgrst.db_pre_request=')+1)
  from pg_roles r cross join lateral unnest(r.rolconfig) setting
  where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%'),
  'public.filey_assert_mfa'::text,'PostgREST RPC dispatch hook configured');
select assert_equal((select count(*) from pg_policies where policyname='filey_mfa_required' and permissive='RESTRICTIVE'),2::bigint,'RLS plus Storage restrictive MFA policy');
set role authenticated;
set test.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}';
select assert_equal((select count(*) from records),1::bigint,'No-factor user keeps access');
select filey_assert_mfa();
reset role;
insert into auth.mfa_factors values ('00000000-0000-0000-0000-000000000001','unverified');
set role authenticated;
select assert_equal(filey_mfa_allowed(),true,'Enrollment alone does not lock user out');
reset role;
update auth.mfa_factors set status='verified';
set role authenticated;
select assert_equal((select count(*) from records),0::bigint,'MFA aal1 direct table read denied');
select assert_equal((select count(*) from storage.objects),0::bigint,'MFA aal1 Storage read denied');
do $$ begin
  begin
    insert into records values (4,auth.uid(),'attempt',false);
    raise exception 'MFA aal1 INSERT should fail';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects values (4,auth.uid(),'attempt');
    raise exception 'MFA aal1 Storage INSERT should fail';
  exception when insufficient_privilege then null; end;
  begin
    perform filey_assert_mfa();
    perform private_rpc();
    raise exception 'MFA aal1 SECURITY DEFINER dispatch should fail';
  exception when insufficient_privilege then null; end;
end $$;
with changed as (update records set value='bad' returning id) select assert_equal(count(*),0::bigint,'MFA aal1 UPDATE denied') from changed;
with changed as (delete from records returning id) select assert_equal(count(*),0::bigint,'MFA aal1 DELETE denied') from changed;
set test.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
select assert_equal((select count(*) from records),1::bigint,'MFA aal2 original tenant RLS retained');
select assert_equal((select count(*) from storage.objects),1::bigint,'MFA aal2 Storage access restored');
select filey_assert_mfa();
insert into records values (4,auth.uid(),'saved',false);
update records set value='changed' where id=4;
select assert_equal((select value from records where id=4),'changed'::text,'MFA aal2 writes restored');
delete from records where id=4;
set test.claims='{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}';
select assert_equal((select count(*) from records),2::bigint,'Another non-MFA user is not locked out');
select filey_assert_mfa();
reset role;
set role service_role;
set test.claims='{"role":"service_role","aal":"aal1"}';
select filey_assert_mfa();
select assert_equal((select count(*) from records),3::bigint,'Trusted service-role webhooks remain available');
reset role;
set role anon;
set test.claims='{"role":"anon"}';
select filey_assert_mfa();
select assert_equal((select count(*) from records),1::bigint,'Existing shared public invoice read retained');
reset role;
select assert_equal((select value from records where id=1),'private'::text,'Blocked writes preserved existing data');
select 'PASS: optional MFA enforced for direct rows, Storage and RPC dispatch; aal2/no-factor/anon/service-role paths preserved.';
