set role service_role;
insert into ai_credit_orders(id,user_id,product_id,credits_micros,service_fee_cents,promotion_id,promotion_discount_id,
  promotion_discount_code,promotion_customer_id,promotion_email,promotion_expires_at,expected_paid_cents)
values('45000000-0000-4000-8000-000000000020','35000000-0000-4000-8000-000000000001','pdt_resume',5000000,50,
  '75000000-0000-4000-8000-000000000020','dsc_resume','FIXTURETEST','cus_resume','resume@fixture.test',now()+interval '1 hour',0);
do $$ declare changed integer; rejected boolean; bad text; begin
  assert (select checkout_session_id is null and checkout_url is null from ai_credit_orders where id='45000000-0000-4000-8000-000000000020'),
    'An unknown claim became a checkout without provider evidence';
  update ai_credit_orders set checkout_session_id='session_resume',checkout_url='https://checkout.dodopayments.com/fixture'
    where id='45000000-0000-4000-8000-000000000020' and user_id='35000000-0000-4000-8000-000000000001'
      and payment_id is null and checkout_session_id is null and checkout_url is null;
  get diagnostics changed=row_count;
  assert changed=1,'Provider acknowledgement was not saved once';
  update ai_credit_orders set checkout_session_id='session_second',checkout_url='https://checkout.dodopayments.com/another'
    where id='45000000-0000-4000-8000-000000000020' and payment_id is null and checkout_session_id is null and checkout_url is null;
  get diagnostics changed=row_count;
  assert changed=0,'A late duplicate acknowledgement overwrote the saved link';
  assert (select checkout_session_id='session_resume' and checkout_url='https://checkout.dodopayments.com/fixture'
    from ai_credit_orders where id='45000000-0000-4000-8000-000000000020');
  foreach bad in array array['http://checkout.dodopayments.com/a','https://dodopayments.com.evil.test/a',
    'https://user:secret@checkout.dodopayments.com/a','https://checkout.dodopayments.com:8443/a',
    E'https://checkout.dodopayments.com/a\n',E'https://checkout.dodopayments.com/\\a',
    'https://checkout.dodopayments.com/'||repeat('a',2048)] loop
    rejected:=false;
    begin update ai_credit_orders set checkout_url=bad where id='45000000-0000-4000-8000-000000000020';
    exception when check_violation then rejected:=true; end;
    assert rejected,'Unsafe or unbounded checkout URL was persisted';
  end loop;
end $$;
reset role;
set role authenticated;
do $$ declare rejected boolean; begin
  rejected:=false;
  begin perform checkout_url from ai_credit_orders where id='45000000-0000-4000-8000-000000000020';
  exception when insufficient_privilege then rejected:=true; end;
  assert rejected,'An authenticated client read a private checkout link';
  rejected:=false;
  begin update ai_credit_orders set checkout_url='https://checkout.dodopayments.com/client' where id='45000000-0000-4000-8000-000000000020';
  exception when insufficient_privilege then rejected:=true; end;
  assert rejected,'An authenticated client rewrote a private checkout link';
end $$;
reset role;
select 'PASS: private checkout acknowledgement, overwrite denial, unsafe URL rejection and direct client read/write denial.';
