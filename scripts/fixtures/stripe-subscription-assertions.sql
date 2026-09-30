-- Test-only concise wrapper delegates every authorization/order decision to
-- the production RPC. Event, observation and creation clocks are independent.
create function test_stripe_state(p_id text,p_customer text,p_status text,p_event int,p_observed int,
  p_bind boolean default false,p_created int default 1000,p_org text default null)
returns text language sql as $$
  select filey_apply_stripe_subscription(p_id,p_customer,p_org,'pro',p_status,'2027-01-01',
    '2026-01-01'::timestamptz+p_created*interval '1 second',
    '2026-10-01'::timestamptz+p_event*interval '1 second',
    '2026-10-01'::timestamptz+p_observed*interval '1 second',p_bind)
$$;
select assert_equal(has_function_privilege('authenticated','filey_apply_stripe_subscription(text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,boolean)','EXECUTE'),false,'Client cannot forge subscription state');
select assert_equal(has_function_privilege('anon','filey_apply_stripe_subscription(text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,boolean)','EXECUTE'),false,'Anonymous cannot forge subscription state');
select assert_equal(has_column_privilege('authenticated','organizations','stripe_event_at','UPDATE'),false,'Client cannot alter event ordering');
set role service_role;
set test.claims='{"role":"authenticated"}';
do $$ begin
  begin perform test_stripe_state('sub_old','cus_order','active',100,100);
    raise exception 'RPC accepted an untrusted JWT'; exception when insufficient_privilege then null; end;
end $$;
set test.claims='{"role":"service_role"}';
select assert_equal(test_stripe_state('sub_old','cus_order','active',200,200),'applied'::text,'Current provider subscription applies');
select assert_equal(test_stripe_state('sub_old','cus_order','canceled',100,300),'ignored older event'::text,'Older event cannot cancel access');
select assert_equal(test_stripe_state('sub_old','cus_order','unpaid',200,100),'ignored older event'::text,'Same event with older retrieval cannot overwrite current state');
select assert_equal((select plan from organizations where stripe_customer_id='cus_order'),'pro'::text,'Active subscription survives stale events');
select assert_equal(test_stripe_state('sub_other','cus_order','canceled',300,300),'ignored replaced subscription'::text,'Different subscription lifecycle cannot take ownership');
select assert_equal(test_stripe_state('sub_other','cus_order','active',300,300,true,1010),'another Stripe subscription is active'::text,'Paid duplicate checkout cannot replace active access');
select assert_equal(test_stripe_state('sub_old','cus_order','canceled',201,301),'applied'::text,'Current cancellation still applies');
select assert_equal(test_stripe_state('sub_old','cus_order','active',202,302),'ignored terminal subscription'::text,'Late active response cannot resurrect canceled id');
select assert_equal(test_stripe_state('sub_new','cus_order','active',400,400,true,1100),'applied'::text,'New paid checkout replaces canceled subscription');
select assert_equal(test_stripe_state('sub_old','cus_order','canceled',500,500),'ignored replaced subscription'::text,'Old cancellation cannot revoke replacement');
select assert_equal(test_stripe_state('sub_old','cus_order','active',501,501,true,1000),'ignored older subscription'::text,'Old checkout cannot retake replacement');
select assert_equal((select stripe_subscription_id from organizations where stripe_customer_id='cus_order'),'sub_new'::text,'Subscription binding remains current');
select assert_equal(test_stripe_state('sub_dodo','cus_dodo','canceled',300,300),'protected by another entitlement'::text,'Stripe cannot cancel Dodo access');
select assert_equal((select plan from organizations where stripe_customer_id='cus_dodo'),'cloud'::text,'Dodo cloud remains active');
-- The independent ledger protects Dodo even while an old Stripe plan is cached.
update organizations set plan='pro' where stripe_customer_id='cus_dodo';
select assert_equal(test_stripe_state('sub_dodo','cus_dodo','canceled',301,301),'protected by another entitlement'::text,'Authoritative Dodo entitlement protects a stale organization plan');
select assert_equal(test_stripe_state('sub_ultra','cus_ultra','canceled',300,300),'protected by another entitlement'::text,'Ultra plan remains permanent');
select assert_equal(test_stripe_state('sub_license','cus_license','canceled',300,300),'protected by another entitlement'::text,'Permanent paid owner license remains protected');
do $$ begin
  begin perform test_stripe_state('sub_new','cus_order','active',600,600,false,1100,'30000000-0000-0000-0000-000000000002');
    raise exception 'RPC accepted another metadata workspace'; exception when insufficient_privilege then null; end;
  begin perform test_stripe_state('sub_new','cus_missing','active',600,600);
    raise exception 'RPC accepted unbound customer'; exception when insufficient_privilege then null; end;
  begin perform test_stripe_state('sub_new','cus_race','active',600,600);
    raise exception 'RPC reassigned another workspace subscription'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: subscription ordering, current replacement, terminal states, entitlement protection and service/customer/workspace authority.';
