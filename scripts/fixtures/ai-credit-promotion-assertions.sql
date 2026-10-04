insert into auth.users(id) values
 ('35000000-0000-4000-8000-000000000001'),
 ('35000000-0000-4000-8000-000000000002'),
 ('35000000-0000-4000-8000-000000000003'),
 ('35000000-0000-4000-8000-000000000004');
insert into ai_credit_orders(id,user_id,product_id,credits_micros,service_fee_cents)
 values('45000000-0000-4000-8000-000000000001','35000000-0000-4000-8000-000000000001','pdt_normal',5000000,50);
insert into ai_credit_orders(id,user_id,product_id,credits_micros,service_fee_cents,promotion_id,promotion_discount_id,
 promotion_discount_code,promotion_customer_id,promotion_email,promotion_expires_at,expected_paid_cents,checkout_session_id)
 values
 ('45000000-0000-4000-8000-000000000002','35000000-0000-4000-8000-000000000002','pdt_promo',5000000,50,
  '75000000-0000-4000-8000-000000000002','dsc_fixture_2','FIXTURETEST','cus_fixture_2','owner2@fixture.test',now()+interval '1 hour',0,'session_fixture_2'),
 ('45000000-0000-4000-8000-000000000003','35000000-0000-4000-8000-000000000003','pdt_promo',5000000,50,
  '75000000-0000-4000-8000-000000000003','dsc_fixture_3','FIXTURETEST','cus_fixture_3','owner3@fixture.test',now()+interval '1 hour',0,'session_fixture_3');
do $$ declare
 normal uuid := '35000000-0000-4000-8000-000000000001';
 owner uuid := '35000000-0000-4000-8000-000000000002';
 unsafe uuid := '35000000-0000-4000-8000-000000000003';
 receipt jsonb := jsonb_build_object('order_id','45000000-0000-4000-8000-000000000002','payment_id','pay_promo',
  'paid_cents',0,'refunds','[]'::jsonb,'event_type','payment.succeeded','event_at',now());
 a jsonb; rejected boolean;
begin
 rejected:=false;
 begin perform filey_ai_wallet('reconcile_payment',normal,'{"order_id":"45000000-0000-4000-8000-000000000001","payment_id":"pay_free_forged","paid_cents":0,"refunds":[]}');
 exception when others then rejected:=sqlerrm='Invalid payment'; end;
 assert rejected,'An ordinary zero-paid order became valid';
 assert (select payment_id is null from ai_credit_orders where id='45000000-0000-4000-8000-000000000001');
 rejected:=false;
 begin perform filey_ai_wallet('reconcile_payment',owner,receipt-'event_type');
 exception when others then rejected:=sqlerrm='Invalid promotional payment'; end;
 assert rejected,'A promotional order without a succeeded receipt event became valid';
 rejected:=false;
 begin perform filey_ai_wallet('reconcile_payment',owner,receipt||jsonb_build_object('event_at',now()+interval '2 hours'));
 exception when others then rejected:=sqlerrm='Invalid promotional payment'; end;
 assert rejected,'An expired promotional event became valid';
 rejected:=false;
 begin perform filey_ai_wallet('reconcile_payment',owner,receipt||'{"paid_cents":550}');
 exception when others then rejected:=sqlerrm='Invalid promotional payment'; end;
 assert rejected,'The promotion recorded a fabricated nominal paid total';
 a:=filey_ai_wallet('reconcile_payment',owner,receipt);
 assert (a->>'balance_micros')::bigint=5000000,'A valid zero checkout must grant exactly five Coin';
 assert (select paid_cents=0 from ai_credit_orders where id='45000000-0000-4000-8000-000000000002'),'Store actual zero cash';
 a:=filey_ai_wallet('reconcile_payment',owner,receipt);
 assert (a->>'balance_micros')::bigint=5000000 and (select count(*) from ai_credit_ledger where user_id=owner)=1,'Replay doubled the promotion';
 rejected:=false;
 begin perform filey_ai_wallet('reconcile_payment',owner,receipt||'{"refunds":[{"refund_id":"ref_impossible","refund_cents":1}]}');
 exception when others then rejected:=sqlerrm='Invalid refund amount'; end;
 assert rejected,'A positive cash refund reached a zero denominator';
 assert (select count(*) from ai_credit_ledger where user_id=owner)=1 and
  (select balance_micros from ai_credit_accounts where user_id=owner)=5000000,'An invalid refund changed the saved grant';
 rejected:=false;
 begin perform filey_ai_wallet('reconcile_payment',unsafe,
  jsonb_build_object('order_id','45000000-0000-4000-8000-000000000003','payment_id','pay_unsafe_promo','paid_cents',0,
   'event_type','payment.succeeded','event_at',now(),'refunds',jsonb_build_array(jsonb_build_object('refund_id','ref_unsafe','refund_cents',1))));
 exception when others then rejected:=sqlerrm='Invalid refund amount'; end;
 assert rejected and (select payment_id is null from ai_credit_orders where id='45000000-0000-4000-8000-000000000003'),
  'An invalid later reversal left an initial promotional grant committed';
 assert not exists(select 1 from ai_credit_ledger where user_id=unsafe),'Initial invalid refund left a ledger grant';
 a:=filey_ai_wallet('reconcile_payment',normal,'{"order_id":"45000000-0000-4000-8000-000000000001","payment_id":"pay_normal","paid_cents":550,"refunds":[{"refund_id":"ref_normal","refund_cents":110}]}');
 assert (a->>'balance_micros')::bigint=4000000,'Normal paid refund ratio changed';
 a:=filey_ai_wallet('dispute',owner,jsonb_build_object('order_id','45000000-0000-4000-8000-000000000002','event_type','dispute.opened','event_at',now()));
 assert (a->>'blocked')::boolean,'A promotional dispute must block spending';
 rejected:=false;
 begin perform filey_ai_wallet('reserve',owner,'{"request_id":"55000000-0000-4000-8000-000000000002","run_id":"65000000-0000-4000-8000-000000000002","amount_micros":100,"model":"filey-ai","markup_bps":0}');
 exception when others then rejected:=sqlerrm='AI credits are paused while a payment dispute is reviewed.'; end;
 assert rejected,'A disputed promotion still funded AI';
 a:=filey_ai_wallet('resolve_dispute',owner,jsonb_build_object('order_id','45000000-0000-4000-8000-000000000002','event_type','dispute.won','event_at',now()-interval '1 second'));
 assert (a->>'blocked')::boolean,'An older won event reopened promotional spending';
 a:=filey_ai_wallet('resolve_dispute',owner,jsonb_build_object('order_id','45000000-0000-4000-8000-000000000002','event_type','dispute.won','event_at',now()+interval '1 second'));
 assert not (a->>'blocked')::boolean;
 a:=filey_ai_wallet('reserve',owner,'{"request_id":"55000000-0000-4000-8000-000000000002","run_id":"65000000-0000-4000-8000-000000000002","amount_micros":100,"model":"filey-ai","markup_bps":0}');
 a:=filey_ai_wallet('settle',owner,'{"request_id":"55000000-0000-4000-8000-000000000002","charged_micros":50}');
 assert (a->>'balance_micros')::bigint=4999950,'Normal AI usage did not deduct from the exact promotional grant';
 rejected:=false;
 begin insert into ai_credit_orders(id,user_id,product_id,credits_micros,service_fee_cents,promotion_id,promotion_discount_id,
  promotion_discount_code,promotion_customer_id,promotion_email,promotion_expires_at,expected_paid_cents)
  values('45000000-0000-4000-8000-000000000004',unsafe,'pdt_promo',5000000,50,'75000000-0000-4000-8000-000000000002',
   'dsc_another','FIXTURETEST','cus_another','another@fixture.test',now()+interval '1 hour',0);
 exception when unique_violation then rejected:=true; end;
 assert rejected,'A different account reopened the same campaign';
 rejected:=false;
 begin insert into ai_credit_orders(id,user_id,product_id,credits_micros,service_fee_cents,promotion_id,promotion_discount_id,
  promotion_discount_code,promotion_customer_id,promotion_email,promotion_expires_at,expected_paid_cents)
  values('45000000-0000-4000-8000-000000000004',unsafe,'pdt_promo',5000000,50,'75000000-0000-4000-8000-000000000004',
   'dsc_fixture_2','FIXTURETEST','cus_another','another@fixture.test',now()+interval '1 hour',0);
 exception when unique_violation then rejected:=true; end;
 assert rejected,'Changing campaign identity reopened the same coupon';
end $$;
set role authenticated;
do $$ begin
 assert not has_table_privilege(current_user,'ai_credit_orders','SELECT'),'Clients can read private coupon/customer bindings';
 assert not has_table_privilege(current_user,'ai_credit_orders','INSERT'),'Clients can authorize promotions';
 assert not has_table_privilege(current_user,'ai_credit_orders','UPDATE'),'Clients can rewrite payment proof';
 assert not has_table_privilege(current_user,'ai_credit_orders','DELETE'),'Clients can reset one-use claims';
 assert not has_function_privilege(current_user,'filey_ai_wallet(text,uuid,jsonb)','EXECUTE'),'Clients can grant Coins';
end $$;
reset role;
select 'PASS: 25 promotional receipt, replay, refund, dispute, usage, cross-account and private-authority assertions.';
