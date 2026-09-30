set role authenticated;
set test.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
set test.org='10000000-0000-0000-0000-000000000001';
do $$ declare column_name text; begin
  foreach column_name in array array['plan','plan_status','stripe_customer_id','stripe_subscription_id','current_period_end','dodo_customer_id','dodo_subscription_id','cloud_grandfathered'] loop
    perform assert_equal(has_column_privilege('authenticated','organizations',column_name,'update'),false,'Billing UPDATE denied: '||column_name);
    perform assert_equal(has_column_privilege('authenticated','organizations',column_name,'insert'),false,'Billing INSERT denied: '||column_name);
  end loop;
  begin update organizations set plan='ultra',plan_status='active' where id=current_org()::uuid;
    raise exception 'Self-upgrade accepted'; exception when insufficient_privilege then null; end;
  begin insert into organizations(name,owner_id,plan) values('Forged paid plan',auth.uid(),'ultra');
    raise exception 'Paid workspace INSERT accepted'; exception when insufficient_privilege then null; end;
  begin update organizations set owner_id='00000000-0000-0000-0000-000000000002' where id=current_org()::uuid;
    raise exception 'Ownership rewrite accepted'; exception when insufficient_privilege then null; end;
  begin insert into organizations(name,owner_id) values('Foreign owner','00000000-0000-0000-0000-000000000002');
    raise exception 'Foreign workspace INSERT accepted'; exception when insufficient_privilege then null; end;
end $$;
update organizations set name='Renamed workspace' where id=current_org()::uuid;
select assert_equal((select name from organizations where id=current_org()::uuid),'Renamed workspace'::text,'Owner rename works');
insert into organizations(id,name,owner_id) values('10000000-0000-0000-0000-000000000003','Direct free workspace',auth.uid());
select assert_equal((select plan from organizations where id='10000000-0000-0000-0000-000000000003'),'free'::text,'Direct creation keeps unpaid defaults');
select filey_create_workspace('RPC free workspace');
select assert_equal((select count(*) from organizations where name='RPC free workspace' and plan='free' and not cloud_grandfathered),1::bigint,'Existing definer workspace creation works');

set test.claims='{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}';
select assert_equal((select count(*) from organizations where id=current_org()::uuid),1::bigint,'Staff may still read their current workspace');
delete from organizations where id=current_org()::uuid;
update organizations set name='Staff takeover' where id=current_org()::uuid;
select assert_equal((select name from organizations where id=current_org()::uuid),'Renamed workspace'::text,'Staff cannot delete or rename workspace');

reset role;
set role service_role;
update organizations set plan='ultra',plan_status='active',dodo_subscription_id='sub_fixture' where id='10000000-0000-0000-0000-000000000001';
select assert_equal((select plan from organizations where id='10000000-0000-0000-0000-000000000001'),'ultra'::text,'Trusted payment webhook still updates billing');
reset role;
set role authenticated;
set test.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
delete from organizations where id='10000000-0000-0000-0000-000000000003';
select assert_equal((select count(*) from organizations where id='10000000-0000-0000-0000-000000000003'),0::bigint,'Actual owner can remove own workspace');
reset role;
select 'PASS: no owner self-upgrade or staff workspace deletion; direct/RPC creation, rename and trusted billing remain usable.';
