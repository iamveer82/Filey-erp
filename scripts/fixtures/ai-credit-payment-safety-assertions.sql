-- Disposable PostgreSQL only. Apply the payment-safety migration twice first.
insert into auth.users(id) values ('30000000-0000-4000-8000-000000000004');
insert into ai_credit_orders(id,user_id,product_id,credits_micros,service_fee_cents)
values ('40000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000004','pdt_payment_safety',5000000,50);
do $$ declare
  u uuid := '30000000-0000-4000-8000-000000000004';
  o uuid := '40000000-0000-4000-8000-000000000004';
  a jsonb;
  rejected boolean;
begin
  a := filey_ai_wallet('topup',u,jsonb_build_object('order_id',o,'payment_id','pay_safety','paid_cents',550));
  assert (a->>'balance_micros')::bigint=5000000,'Service fee must not become Coin';
  perform filey_ai_wallet('reserve',u,'{"request_id":"50000000-0000-4000-8000-000000000011","run_id":"60000000-0000-4000-8000-000000000011","amount_micros":500000,"model":"filey-ai","markup_bps":0}');
  a := filey_ai_wallet('dispute',u,jsonb_build_object('order_id',o,'event_type','dispute.opened','event_at','2026-10-03T12:00:00Z'));
  assert (a->>'blocked')::boolean;
  a := filey_ai_wallet('resolve_dispute',u,jsonb_build_object('order_id',o,'event_type','dispute.won','event_at','2026-10-03T11:00:00Z'));
  assert (a->>'blocked')::boolean,'An older won snapshot cleared a newer dispute';
  a := filey_ai_wallet('resolve_dispute',u,jsonb_build_object('order_id',o,'event_type','dispute.won','event_at','2026-10-03T12:00:00Z'));
  assert (a->>'blocked')::boolean,'Equal-time resolution must not win a dispute tie';
  rejected := false;
  begin
    perform filey_ai_wallet('reserve',u,'{"request_id":"50000000-0000-4000-8000-000000000012","run_id":"60000000-0000-4000-8000-000000000012","amount_micros":1,"model":"filey-ai","markup_bps":0}');
  exception when others then rejected := sqlerrm='AI credits are paused while a payment dispute is reviewed.'; end;
  assert rejected,'Disputed funds must remain unspendable';
  a := filey_ai_wallet('release',u,'{"request_id":"50000000-0000-4000-8000-000000000011"}');
  assert (a->>'reserved_micros')::bigint=0 and (a->>'balance_micros')::bigint=5000000,
    'Failed AI holds must still release while payments are disputed';
  rejected := false;
  begin perform filey_ai_wallet('resolve_dispute',u,jsonb_build_object('order_id',o,'event_type','dispute.won'));
  exception when others then rejected := true; end;
  assert rejected,'A legacy caller without signed ordering data unblocked spending';
  rejected := false;
  begin perform filey_ai_wallet('resolve_dispute',u,jsonb_build_object('order_id',o,'event_type','payment.succeeded','event_at','2026-10-03T13:00:00Z'));
  exception when others then rejected := true; end;
  assert rejected,'A successful payment must not resolve a dispute';
  rejected := false;
  begin perform filey_ai_wallet('resolve_dispute',u,jsonb_build_object('order_id',o,'event_type','dispute.won','event_at','infinity'));
  exception when others then rejected := true; end;
  assert rejected,'An infinite dispute timestamp must not permanently supersede legitimate events';
  a := filey_ai_wallet('resolve_dispute',u,jsonb_build_object('order_id',o,'event_type','dispute.won','event_at','2026-10-03T13:00:00Z'));
  assert not (a->>'blocked')::boolean,'A newer verified won dispute must restore spending';
  a := filey_ai_wallet('dispute',u,jsonb_build_object('order_id',o,'event_type','dispute.opened','event_at','2026-10-03T12:00:00Z'));
  assert not (a->>'blocked')::boolean,'An older opened dispute superseded a later win';
  a := filey_ai_wallet('dispute',u,jsonb_build_object('order_id',o,'event_type','dispute.opened','event_at','2026-10-03T13:00:00Z'));
  assert (a->>'blocked')::boolean,'Equal-time blocking must win when delivered after a resolution';
  a := filey_ai_wallet('resolve_dispute',u,jsonb_build_object('order_id',o,'event_type','dispute.won','event_at','2026-10-03T13:00:00Z'));
  assert (a->>'blocked')::boolean;
  a := filey_ai_wallet('resolve_dispute',u,jsonb_build_object('order_id',o,'event_type','dispute.won','event_at','2026-10-03T14:00:00Z'));
  assert not (a->>'blocked')::boolean;
  a := filey_ai_wallet('refund',u,jsonb_build_object('order_id',o,'refund_id','ref_payment_safety','refund_cents',110));
  assert (a->>'balance_micros')::bigint=4000000,'Verified provider reversals must still debit the original Coin proportion';
  a := filey_ai_wallet('refund',u,jsonb_build_object('order_id',o,'refund_id','ref_payment_safety','refund_cents',110));
  assert (a->>'balance_micros')::bigint=4000000,'A provider refund replay debited Coin twice';
  assert (select sum(amount_micros) from ai_credit_ledger where user_id=u)=4000000,'Wallet and receipt ledger diverged';
  rejected := false;
  begin perform filey_ai_wallet('dispute','30000000-0000-4000-8000-000000000003',jsonb_build_object('order_id',o,'event_type','dispute.opened','event_at','2026-10-03T15:00:00Z'));
  exception when others then rejected := true; end;
  assert rejected,'Dispute updates must stay bound to the order owner';
end $$;

insert into auth.users(id) values
  ('30000000-0000-4000-8000-000000000005'),
  ('30000000-0000-4000-8000-000000000006'),
  ('30000000-0000-4000-8000-000000000007');
insert into ai_credit_orders(id,user_id,product_id,credits_micros,service_fee_cents) values
  ('40000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000005','pdt_atomic_refunded',5000000,50),
  ('40000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000006','pdt_atomic_invalid',5000000,50),
  ('40000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000007','pdt_atomic_race',5000000,50);
do $$ declare
  u uuid := '30000000-0000-4000-8000-000000000005';
  bad_u uuid := '30000000-0000-4000-8000-000000000006';
  snapshot jsonb := '{"order_id":"40000000-0000-4000-8000-000000000005","payment_id":"pay_atomic_refunded","paid_cents":550,"refunds":[{"refund_id":"ref_atomic_full","refund_cents":550}]}';
  a jsonb;
  rejected boolean;
begin
  a := filey_ai_wallet('reconcile_payment',u,snapshot);
  assert (a->>'balance_micros')::bigint=0 and (a->>'available_micros')::bigint=0,
    'A known fully reversed payment must never expose spendable Coin';
  a := filey_ai_wallet('reconcile_payment',u,snapshot);
  assert (a->>'balance_micros')::bigint=0;
  assert (select count(*) from ai_credit_ledger where user_id=u)=2,'Atomic replay duplicated top-up or reversal receipts';
  assert (select sum(amount_micros) from ai_credit_ledger where user_id=u)=0;
  rejected := false;
  begin perform filey_ai_wallet('reserve',u,'{"request_id":"50000000-0000-4000-8000-000000000013","run_id":"60000000-0000-4000-8000-000000000013","amount_micros":1,"model":"filey-ai","markup_bps":0}');
  exception when others then rejected := sqlerrm='Not enough available AI credits for this request. Add credits or lower the output limit.'; end;
  assert rejected,'Fully reversed grants must not fund AI';
  perform filey_ai_wallet('status',bad_u);
  rejected := false;
  begin perform filey_ai_wallet('reconcile_payment',bad_u,'{"order_id":"40000000-0000-4000-8000-000000000006","payment_id":"pay_atomic_invalid","paid_cents":550,"refunds":[{"refund_id":"ref_atomic_valid","refund_cents":110},{"refund_id":"ref_atomic_bad","refund_cents":0}]}');
  exception when others then rejected := true; end;
  assert rejected,'Malformed second reversal must fail the payment transaction';
  assert (select balance_micros from ai_credit_accounts where user_id=bad_u)=0,
    'Malformed later reversal left top-up or partial debit committed';
  assert (select payment_id is null and refunded_micros=0 from ai_credit_orders where user_id=bad_u);
  assert (select count(*) from ai_credit_ledger where user_id=bad_u)=0,
    'A rolled-back payment must not leave ledger receipts';
  a := filey_ai_wallet('reconcile_payment',bad_u,'{"order_id":"40000000-0000-4000-8000-000000000006","payment_id":"pay_atomic_valid","paid_cents":550,"refunds":[{"refund_id":"ref_atomic_first","refund_cents":110},{"refund_id":"ref_atomic_second","refund_cents":220}]}');
  assert (a->>'balance_micros')::bigint=2000000,'Atomic partial reversals changed the original paid-credit ratio';
  perform filey_ai_wallet('status','30000000-0000-4000-8000-000000000007');
  assert (select payment_id is null from ai_credit_orders where user_id='30000000-0000-4000-8000-000000000007'),
    'Concurrent snapshot fixture must begin with an unreconciled payment';
end $$;
set role authenticated;
do $$ begin
  assert not has_function_privilege(current_user,'filey_ai_wallet(text,uuid,jsonb)','EXECUTE');
  assert not has_table_privilege(current_user,'ai_credit_orders','UPDATE');
end $$;
reset role;

-- Coin availability, rather than the retired default $1/task and $5/day
-- budgets, governs funded usage. Preserve legacy values for older clients.
insert into auth.users(id) values
  ('30000000-0000-4000-8000-000000000008'),
  ('30000000-0000-4000-8000-000000000009');
insert into ai_credit_orders(id,user_id,product_id,credits_micros,service_fee_cents) values
  ('40000000-0000-4000-8000-000000000008','30000000-0000-4000-8000-000000000008','pdt_budget_retired',10000000,50),
  ('40000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000009','pdt_rate_retained',1000000,50);
do $$ declare
  u uuid := '30000000-0000-4000-8000-000000000008';
  rate_u uuid := '30000000-0000-4000-8000-000000000009';
  task uuid := '60000000-0000-4000-8000-000000000008';
  request uuid;
  a jsonb;
  rejected boolean;
begin
  a := filey_ai_wallet('topup',u,'{"order_id":"40000000-0000-4000-8000-000000000008","payment_id":"pay_budget_retired","paid_cents":1050}');
  assert (a->>'task_limit_micros')::bigint=1000000 and (a->>'daily_limit_micros')::bigint=5000000;
  for n in 1..3 loop
    request := ('50000000-0000-4000-8000-'||lpad((800+n)::text,12,'0'))::uuid;
    perform filey_ai_wallet('reserve',u,jsonb_build_object('request_id',request,'run_id',task,
      'amount_micros',2000000,'model','filey-ai','markup_bps',0));
    a := filey_ai_wallet('settle',u,jsonb_build_object('request_id',request,'charged_micros',2000000));
  end loop;
  assert (a->>'available_micros')::bigint=4000000,
    'A paying user with sufficient Coin must continue past former task/day budgets';
  assert (a->>'task_limit_micros')::bigint=1000000 and (a->>'daily_limit_micros')::bigint=5000000,
    'Retiring enforcement must not rewrite stored legacy preferences';
  perform filey_ai_wallet('limits',u,'{"task_limit_micros":10000,"daily_limit_micros":10000}');
  a := filey_ai_wallet('reserve',u,jsonb_build_object('request_id','50000000-0000-4000-8000-000000000804',
    'run_id',task,'amount_micros',1000000,'model','filey-ai','markup_bps',0));
  assert (a->>'reserved_micros')::bigint=1000000 and (a->>'available_micros')::bigint=3000000,
    'Previously saved low limits must not become invisible Coin blockers';
  a := filey_ai_wallet('release',u,'{"request_id":"50000000-0000-4000-8000-000000000804"}');
  assert (a->>'available_micros')::bigint=4000000;
  rejected := false;
  begin perform filey_ai_wallet('reserve',u,jsonb_build_object('request_id','50000000-0000-4000-8000-000000000805',
    'run_id',task,'amount_micros',4000001,'model','filey-ai','markup_bps',0));
  exception when others then rejected := sqlerrm='Not enough available AI credits for this request. Add credits or lower the output limit.'; end;
  assert rejected,'Retiring budgets must not permit spending beyond available Coin';
  rejected := false;
  begin perform filey_ai_wallet('reserve',u,jsonb_build_object('request_id','50000000-0000-4000-8000-000000000805',
    'run_id',task,'amount_micros',50000001,'model','filey-ai','markup_bps',0));
  exception when others then rejected := sqlerrm='Invalid AI reservation'; end;
  assert rejected,'Per-request reservation caps must still apply';
  rejected := false;
  begin perform filey_ai_wallet('reserve',u,jsonb_build_object('request_id','50000000-0000-4000-8000-000000000801',
    'run_id',task,'amount_micros',1,'model','filey-ai','markup_bps',0));
  exception when others then rejected := sqlerrm='This request was already submitted. Refresh your balance before retrying.'; end;
  assert rejected,'Retiring budgets must not permit paid request replay';
  perform filey_ai_wallet('topup',rate_u,'{"order_id":"40000000-0000-4000-8000-000000000009","payment_id":"pay_rate_retained","paid_cents":150}');
  for n in 1..30 loop
    request := ('50000000-0000-4000-8000-'||lpad((900+n)::text,12,'0'))::uuid;
    perform filey_ai_wallet('reserve',rate_u,jsonb_build_object('request_id',request,'run_id',task,
      'amount_micros',1,'model','filey-ai','markup_bps',0));
    perform filey_ai_wallet('release',rate_u,jsonb_build_object('request_id',request));
  end loop;
  rejected := false;
  begin perform filey_ai_wallet('reserve',rate_u,jsonb_build_object('request_id','50000000-0000-4000-8000-000000000931',
    'run_id',task,'amount_micros',1,'model','filey-ai','markup_bps',0));
  exception when others then rejected := sqlerrm='AI request limit reached. Wait a minute.'; end;
  assert rejected,'Request-rate abuse protection must survive personal budget retirement';
  assert (select sum(amount_micros) from ai_credit_ledger where user_id=u)=4000000;
end $$;
select 'PASS: Coin usage continues past retired budgets; balance, request caps, replay and rate guards remain.';
select 'PASS: payment safety upgrade, atomic payment snapshots, ordered disputes, provider reversals and hold releases.';
