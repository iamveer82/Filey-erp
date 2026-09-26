-- Runs in a disposable PostgreSQL cluster, never against customer records.
insert into auth.users(id) values
 ('30000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000002'),
 ('30000000-0000-4000-8000-000000000003');
insert into ai_credit_orders(id,user_id,product_id,credits_micros)
select ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'pdt_fixture',5000000 from generate_series(1,3)n;
do $$ declare u uuid; n integer; a jsonb; rejected boolean; begin
  for n in 1..3 loop
    u:=('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
    if n=3 then update ai_credit_orders set service_fee_cents=50 where user_id=u; end if;
    a:=filey_ai_wallet('topup',u,jsonb_build_object('order_id','40000000-0000-4000-8000-'||lpad(n::text,12,'0'),'payment_id','pay_'||n,'paid_cents',case when n=3 then 550 else 500 end));
    assert (a->>'balance_micros')::bigint=5000000;
    a:=filey_ai_wallet('topup',u,jsonb_build_object('order_id','40000000-0000-4000-8000-'||lpad(n::text,12,'0'),'payment_id','pay_'||n,'paid_cents',500));
    assert (a->>'balance_micros')::bigint=5000000,'Duplicate topup changed money';
  end loop;
  u:='30000000-0000-4000-8000-000000000001';
  a:=filey_ai_wallet('reserve',u,'{"request_id":"50000000-0000-4000-8000-000000000001","run_id":"60000000-0000-4000-8000-000000000001","amount_micros":800000,"model":"fixture/model","markup_bps":2000}');
  assert (a->>'available_micros')::bigint=4200000;
  rejected:=false;
  begin perform filey_ai_wallet('reserve',u,'{"request_id":"50000000-0000-4000-8000-000000000002","run_id":"60000000-0000-4000-8000-000000000001","amount_micros":300000,"model":"fixture/model","markup_bps":2000}');
  exception when others then rejected:=true; end;
  assert rejected,'Task limit did not include pending calls';
  rejected:=false;
  begin perform filey_ai_wallet('reserve',u,'{"request_id":"50000000-0000-4000-8000-000000000001","run_id":"60000000-0000-4000-8000-000000000001","amount_micros":100,"model":"fixture/model","markup_bps":2000}');
  exception when others then rejected:=true; end;
  assert rejected,'Duplicate request could call provider twice';
  a:=filey_ai_wallet('settle',u,'{"request_id":"50000000-0000-4000-8000-000000000001","charged_micros":60000,"provider_cost_micros":50000,"input_tokens":100,"output_tokens":50}');
  assert (a->>'available_micros')::bigint=4940000;
  a:=filey_ai_wallet('settle',u,'{"request_id":"50000000-0000-4000-8000-000000000001","charged_micros":60000}');
  assert (a->>'balance_micros')::bigint=4940000,'Duplicate settle charged twice';
  a:=filey_ai_wallet('refund',u,'{"order_id":"40000000-0000-4000-8000-000000000001","refund_id":"ref_1","refund_cents":250}');
  assert (a->>'balance_micros')::bigint=2440000;
  a:=filey_ai_wallet('refund',u,'{"order_id":"40000000-0000-4000-8000-000000000001","refund_id":"ref_1","refund_cents":250}');
  assert (a->>'balance_micros')::bigint=2440000,'Duplicate refund debited twice';
  a:=filey_ai_wallet('refund',u,'{"order_id":"40000000-0000-4000-8000-000000000001","refund_id":"ref_2","refund_cents":500}');
  assert (a->>'balance_micros')::bigint=-60000,'Refund cannot be capped to current balance or exceed original purchase';
  assert (select sum(amount_micros) from ai_credit_ledger where user_id=u)=-60000,'Ledger must equal balance';
  u:='30000000-0000-4000-8000-000000000002';
  perform filey_ai_wallet('reserve',u,'{"request_id":"50000000-0000-4000-8000-000000000003","run_id":"60000000-0000-4000-8000-000000000003","amount_micros":500000,"model":"fixture/model","markup_bps":2000}');
  update ai_credit_requests set expires_at=now()-interval '1 minute' where user_id=u;
  a:=filey_ai_wallet('status',u);
  assert (a->>'reserved_micros')::bigint=0,'Crashed workers must release stale holds';
  perform filey_ai_wallet('settle',u,'{"request_id":"50000000-0000-4000-8000-000000000003","charged_micros":60000}');
  assert (select balance_micros from ai_credit_accounts where user_id=u)=5000000,'Expired holds must not charge later';
  perform filey_ai_wallet('dispute',u,'{"order_id":"40000000-0000-4000-8000-000000000002"}');
  rejected:=false;
  begin perform filey_ai_wallet('reserve',u,'{"request_id":"50000000-0000-4000-8000-000000000004","run_id":"60000000-0000-4000-8000-000000000004","amount_micros":100,"model":"fixture/model","markup_bps":2000}');
  exception when others then rejected:=true; end;
  assert rejected,'Disputed funds must not be spendable';
  perform filey_ai_wallet('resolve_dispute',u,'{"order_id":"40000000-0000-4000-8000-000000000002"}');
end $$;
set role authenticated;
select set_config('test.uid','30000000-0000-4000-8000-000000000002',false);
do $$ begin
 assert (select count(*) from ai_credit_accounts)=1,'Wallets leaked across accounts';
 assert (select count(*) from ai_credit_ledger where user_id<>'30000000-0000-4000-8000-000000000002')=0;
 assert not has_function_privilege(current_user,'filey_ai_wallet(text,uuid,jsonb)','EXECUTE'),'Clients must not have billing RPC access';
 assert not has_table_privilege(current_user,'ai_credit_accounts','UPDATE');
 assert not has_table_privilege(current_user,'ai_credit_ledger','INSERT');
end $$;
reset role;
select 'PASS: AI credit idempotency, reservations, limits, refunds, disputes, expiry and account isolation.';
