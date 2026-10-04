insert into auth.users(id) values
 ('38000000-0000-4000-8000-000000000001'),('38000000-0000-4000-8000-000000000002'),
 ('38000000-0000-4000-8000-000000000003'),('38000000-0000-4000-8000-000000000004');
insert into profiles(id,org_id) values
 ('38000000-0000-4000-8000-000000000001','recovery-a'),('38000000-0000-4000-8000-000000000002','recovery-a'),
 ('38000000-0000-4000-8000-000000000003','recovery-b'),('38000000-0000-4000-8000-000000000004','recovery-race');
insert into org_members(user_id,org_id) select id,org_id from profiles;
insert into org_members(user_id,org_id) values('38000000-0000-4000-8000-000000000001','recovery-b');
insert into ai_credit_accounts(user_id,balance_micros) select id,1000000 from auth.users;

-- Inject a real database write failure AFTER the nested wallet debit, proving
-- that a cache-write failure rolls the whole function/charge back atomically.
create function recovery_fixture_write_failure() returns trigger language plpgsql as $$ begin
 if new.request_id='58000000-0000-4000-8000-000000000002' and new.state='complete' then
   raise exception 'Synthetic cache write failure';
 end if;
 return new;
end $$;
create trigger recovery_fixture_write_failure before update on ai_completion_results
 for each row execute function recovery_fixture_write_failure();

do $$ declare
 owner uuid := '38000000-0000-4000-8000-000000000001';
 other_owner uuid := '38000000-0000-4000-8000-000000000002';
 request jsonb := jsonb_build_object('request_id','58000000-0000-4000-8000-000000000001',
  'run_id','68000000-0000-4000-8000-000000000001','org_id','recovery-a','fingerprint',repeat('a',64),
  'model','filey-ai','amount_micros',10000,'markup_bps',0);
 answer jsonb := '{"model":"filey-ai","choices":[{"message":{"role":"assistant","content":"Synthetic answer"}}]}';
 result jsonb; second jsonb; rejected boolean; balance bigint;
begin
 result:=filey_ai_completion_recovery('begin',owner,request);
 assert result->>'state'='pending' and (result->>'dispatch')::boolean,'Initial begin did not claim the worker';
 result:=filey_ai_completion_recovery('begin',owner,request);
 assert result->>'state'='pending' and not coalesce((result->>'dispatch')::boolean,false),'Duplicate begin dispatched twice';
 assert (select reserved_micros=10000 from ai_credit_accounts where user_id=owner),'Duplicate begin reserved twice';
 for second in select value from jsonb_array_elements(jsonb_build_array(
   request||jsonb_build_object('fingerprint',repeat('b',64)),
   request||'{"run_id":"68000000-0000-4000-8000-000000000002"}'::jsonb)) loop
  rejected:=false;
  begin perform filey_ai_completion_recovery('begin',owner,second);
  exception when others then rejected:=sqlerrm='AI request does not match its original content'; end;
  assert rejected,'A reused UUID accepted different content/run';
 end loop;
 result:=filey_ai_completion_recovery('status',other_owner,request);
 assert result='{"state":"missing"}'::jsonb,'A workspace colleague read another account response';
 rejected:=false;
 begin perform filey_ai_completion_recovery('begin',other_owner,request);
 exception when others then rejected:=sqlerrm='Invalid AI request'; end;
 assert rejected,'A different account reused a captured UUID';
 update profiles set org_id='recovery-b' where id=owner;
 result:=filey_ai_completion_recovery('status',owner,request||'{"org_id":"recovery-b"}'::jsonb);
 assert result='{"state":"missing"}'::jsonb,'A result crossed workspaces';
 rejected:=false;
 begin perform filey_ai_completion_recovery('status',owner,request);
 exception when others then rejected:=sqlerrm='Workspace access unavailable'; end;
 assert rejected,'Old workspace read survived a profile switch';
 update profiles set org_id='recovery-a' where id=owner;
 delete from org_members where user_id=owner and org_id='recovery-a';
 rejected:=false;
 begin perform filey_ai_completion_recovery('status',owner,request);
 exception when others then rejected:=sqlerrm='Workspace access unavailable'; end;
 assert rejected,'Revoked membership still read the response';
 insert into org_members(user_id,org_id) values(owner,'recovery-a');

 perform filey_ai_completion_recovery('settle',owner,request||jsonb_build_object('charged_micros',123,'completion',answer));
 result:=filey_ai_completion_recovery('status',owner,request);
 assert result->>'state'='complete' and result->'completion'=answer and (result->>'charged_micros')::bigint=123;
 assert (result->'account'->>'balance_micros')::bigint=999877 and (result->'account'->>'reserved_micros')::bigint=0;
 perform filey_ai_completion_recovery('settle',owner,request||'{"charged_micros":9999,"completion":{"forged":true}}'::jsonb);
 perform filey_ai_completion_recovery('fail',owner,request);
 result:=filey_ai_completion_recovery('begin',owner,request);
 assert result->>'state'='complete' and result->'completion'=answer and not coalesce((result->>'dispatch')::boolean,false);
 assert (select count(*)=1 from ai_credit_ledger where user_id=owner),'Lost settlement ack double-debited or refunded';
 assert (select balance_micros=999877 from ai_credit_accounts where user_id=owner);

 second:=request||'{"request_id":"58000000-0000-4000-8000-000000000002"}'::jsonb;
 perform filey_ai_completion_recovery('begin',owner,second);
 rejected:=false;
 begin perform filey_ai_completion_recovery('settle',owner,second||jsonb_build_object('charged_micros',321,'completion',answer));
 exception when others then rejected:=sqlerrm='Synthetic cache write failure'; end;
 assert rejected,'Fixture did not fail after the nested debit';
 assert (select balance_micros=999877 and reserved_micros=10000 from ai_credit_accounts where user_id=owner),'Cache failure committed an orphan charge';
 assert (select state='reserved' and charged_micros=0 from ai_credit_requests where id=(second->>'request_id')::uuid);
 assert (select state='pending' and completion is null from ai_completion_results where request_id=(second->>'request_id')::uuid);
 assert (select count(*)=1 from ai_credit_ledger where user_id=owner),'Cache failure left a usage ledger row';
 perform filey_ai_completion_recovery('fail',owner,second);

 second:=request||'{"request_id":"58000000-0000-4000-8000-000000000003"}'::jsonb;
 perform filey_ai_completion_recovery('begin',owner,second);
 update ai_completion_results set created_at=now()-interval '4 minutes' where request_id=(second->>'request_id')::uuid;
 result:=filey_ai_completion_recovery('status',owner,second);
 assert result->>'state'='failed' and result->>'message' like '%No Coins were charged%';
 perform filey_ai_completion_recovery('settle',owner,second||jsonb_build_object('charged_micros',9999,'completion',answer));
 result:=filey_ai_completion_recovery('begin',owner,second);
 assert result->>'state'='failed' and not coalesce((result->>'dispatch')::boolean,false),'Stale worker restarted or settled late';
 assert (select state='released' and charged_micros=0 from ai_credit_requests where id=(second->>'request_id')::uuid);
 assert (select balance_micros=999877 and reserved_micros=0 from ai_credit_accounts where user_id=owner);

 second:=request||'{"request_id":"58000000-0000-4000-8000-000000000004"}'::jsonb;
 perform filey_ai_completion_recovery('begin',owner,second);
 perform filey_ai_completion_recovery('settle',owner,second||jsonb_build_object('charged_micros',100,'completion',answer));
 update ai_completion_results set expires_at=now()-interval '1 second' where request_id=(second->>'request_id')::uuid;
 result:=filey_ai_completion_recovery('status',owner,second);
 assert result->>'state'='failed' and not result?'completion','Expired response remained readable';
 result:=filey_ai_completion_recovery('begin',owner,second);
 assert result->>'state'='failed' and not coalesce((result->>'dispatch')::boolean,false),'Expired paid UUID dispatched again';
 assert (select completion is null from ai_completion_results where request_id=(second->>'request_id')::uuid),'Expiry read retained response content';
 assert (select balance_micros=999777 from ai_credit_accounts where user_id=owner);
 assert (select count(*)=2 from ai_credit_ledger where user_id=owner),'Expiry replay charged again';

 update ai_completion_results set expires_at=now()-interval '1 second' where request_id=(request->>'request_id')::uuid;
 perform filey_ai_completion_purge();
 assert not exists(select 1 from ai_completion_results where completion is not null and expires_at<=now()),'Purge retained expired content';
 assert (select state='settled' and charged_micros=123 from ai_credit_requests where id=(request->>'request_id')::uuid),'Purge erased debit idempotency';
end $$;
drop trigger recovery_fixture_write_failure on ai_completion_results;
drop function recovery_fixture_write_failure();

do $$ declare actor text; operation text; begin
 assert (select relrowsecurity from pg_class where oid='public.ai_completion_results'::regclass),'Recovery cache has no RLS';
 foreach actor in array array['anon','authenticated'] loop
  foreach operation in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
   assert not has_table_privilege(actor,'public.ai_completion_results',operation),'Client role has private cache access';
  end loop;
  assert not has_function_privilege(actor,'public.filey_ai_completion_recovery(text,uuid,jsonb)','EXECUTE'),'Client can authorize/retrieve cached AI results directly';
  assert not has_function_privilege(actor,'public.filey_ai_completion_purge()','EXECUTE'),'Client can purge private results';
 end loop;
 assert has_function_privilege('service_role','public.filey_ai_completion_recovery(text,uuid,jsonb)','EXECUTE');
 assert not exists(select 1 from information_schema.columns where table_name='ai_completion_results' and column_name in ('prompt','messages','request','api_key','headers')),'Cache added prompt or credential storage';
end $$;
select 'PASS: owner/org/hash binding, membership revocation, atomic response/debit rollback, lost ack, stale/expired UUID replay, private grants and TTL purge.';
