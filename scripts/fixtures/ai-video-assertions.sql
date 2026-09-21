-- Disposable cluster only. No provider or customer records involved.
insert into auth.users(id) values ('31000000-0000-4000-8000-000000000001');
insert into ai_credit_accounts(user_id,balance_micros,task_limit_micros,daily_limit_micros)
 values ('31000000-0000-4000-8000-000000000001',40000000,5000000,50000000);
insert into ai_video_jobs(id,user_id,model,params,duration,charge_micros,provider_quote_micros,callback_token)
 select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'31000000-0000-4000-8000-000000000001',
 'fixture/video','{"prompt":"Test fixture"}',5,1250000,750000,repeat('a',64) from generate_series(1,10)n;
do $$ declare
 u uuid := '31000000-0000-4000-8000-000000000001';
 j uuid := '91000000-0000-4000-8000-000000000001';
 r jsonb; rejected boolean;
begin
 rejected := false;
 begin perform filey_ai_video('start',u,j,'{"charge_micros":1}'); exception when others then rejected := true; end;
 assert rejected, 'Forged price must be rejected';
 rejected := false;
 begin perform filey_ai_video('start','30000000-0000-4000-8000-000000000001',j,'{"charge_micros":1250000}'); exception when others then rejected := true; end;
 assert rejected, 'Another account cannot start a job';
 r := filey_ai_video('start',u,j,'{"charge_micros":1250000}');
 assert (r->>'claimed')::boolean;
 r := filey_ai_video('start',u,j,'{"charge_micros":1250000}');
 assert not (r->>'claimed')::boolean, 'Retry must not resubmit';
 assert (select reserved_micros from ai_credit_accounts where user_id=u)=1250000;
 update ai_credit_requests set created_at=now()-interval '30 minutes' where id=j;
 r := filey_ai_wallet('status',u);
 assert (r->>'reserved_micros')::bigint=1250000, 'Video holds survive chat timeout';
 perform filey_ai_video('uncertain',u,j);
 r := filey_ai_video('start',u,j,'{"charge_micros":1250000}');
 assert not (r->>'claimed')::boolean, 'An uncertain submission cannot be retried';
 perform filey_ai_video('accepted',u,j,'{"request_id":"92000000-0000-4000-8000-000000000001"}');
 perform filey_ai_video('finish',u,j,'{"state":"completed","output_url":"https://cdn.example.com/video.mp4"}');
 perform filey_ai_video('finish',u,j,'{"state":"completed","output_url":"https://cdn.example.com/video.mp4"}');
 perform filey_ai_video('finish',u,j,'{"state":"failed"}');
 assert (select state from ai_video_jobs where id=j)='completed', 'Terminal states cannot regress';
 assert (select balance_micros from ai_credit_accounts where user_id=u)=38750000, 'Exactly one fixed-price charge';
 assert (select count(*) from ai_credit_ledger where user_id=u)=1;
 assert (select reserved_micros from ai_credit_accounts where user_id=u)=0;
 j := '91000000-0000-4000-8000-000000000002';
 perform filey_ai_video('start',u,j,'{"charge_micros":1250000}');
 perform filey_ai_video('finish',u,j,'{"state":"failed"}');
 assert (select reserved_micros from ai_credit_accounts where user_id=u)=0, 'Failures release funds';
 j := '91000000-0000-4000-8000-000000000003';
 perform filey_ai_video('start',u,j,'{"charge_micros":1250000}');
 update ai_credit_requests set expires_at=now()-interval '1 second' where id=j;
 r := filey_ai_wallet('status',u);
 assert (r->>'reserved_micros')::bigint=0, 'Abandoned jobs cannot lock credits forever';
 perform filey_ai_video('finish',u,j,'{"state":"completed","output_url":"https://cdn.example.com/late.mp4"}');
 assert (select charged_micros from ai_video_jobs where id=j)=0, 'Late completion cannot reclaim released money';
 assert (select balance_micros from ai_credit_accounts where user_id=u)=38750000;
 j := '91000000-0000-4000-8000-000000000004';
 update ai_video_jobs set quote_expires_at=now()-interval '1 second' where id=j;
 rejected := false;
 begin perform filey_ai_video('start',u,j,'{"charge_micros":1250000}'); exception when others then rejected := true; end;
 assert rejected, 'Expired quote must not submit';
 perform filey_ai_video('start',u,'91000000-0000-4000-8000-000000000005','{"charge_micros":1250000}');
 perform filey_ai_video('finish',u,'91000000-0000-4000-8000-000000000005','{"state":"nsfw"}');
 perform filey_ai_video('start',u,'91000000-0000-4000-8000-000000000006','{"charge_micros":1250000}');
 perform filey_ai_video('finish',u,'91000000-0000-4000-8000-000000000006','{"state":"canceled"}');
 assert (select reserved_micros from ai_credit_accounts where user_id=u)=0;
 assert (select balance_micros from ai_credit_accounts where user_id=u)=38750000;
 -- Ordinary chat holds still expire after ten minutes.
 perform filey_ai_wallet('reserve',u,'{"request_id":"93000000-0000-4000-8000-000000000001","run_id":"93000000-0000-4000-8000-000000000001","model":"fixture/chat","amount_micros":100000,"markup_bps":0}');
 assert (select expires_at < now()+interval '11 minutes' from ai_credit_requests where id='93000000-0000-4000-8000-000000000001');
 update ai_credit_requests set expires_at=now()-interval '1 second' where id='93000000-0000-4000-8000-000000000001';
 r := filey_ai_wallet('status',u);
 assert (r->>'reserved_micros')::bigint=0;
 assert jsonb_array_length(filey_ai_video('list',u,null)->'jobs')=10;
 assert jsonb_array_length(filey_ai_video('list','30000000-0000-4000-8000-000000000001',null)->'jobs')=0, 'Job lists leaked across accounts';
 perform filey_ai_video('start',u,'91000000-0000-4000-8000-000000000007','{"charge_micros":1250000}');
 perform filey_ai_video('start',u,'91000000-0000-4000-8000-000000000008','{"charge_micros":1250000}');
 perform filey_ai_video('start',u,'91000000-0000-4000-8000-000000000010','{"charge_micros":1250000}');
 rejected := false;
 begin perform filey_ai_video('start',u,'91000000-0000-4000-8000-000000000009','{"charge_micros":1250000}'); exception when others then rejected := true; end;
 assert rejected, 'No more than three videos may run concurrently';
 assert (select state from ai_video_jobs where id='91000000-0000-4000-8000-000000000009')='draft', 'A refused start must remain retryable';
 assert (select reserved_micros from ai_credit_accounts where user_id=u)=3750000, 'A refused start must not reserve funds';
 assert filey_ai_video('list',u,null)->'jobs'->0->>'state'='submitting','Running jobs must stay visible';
 perform filey_ai_video('finish',u,'91000000-0000-4000-8000-000000000007','{"state":"canceled"}');
 perform filey_ai_video('finish',u,'91000000-0000-4000-8000-000000000008','{"state":"canceled"}');
 perform filey_ai_video('finish',u,'91000000-0000-4000-8000-000000000010','{"state":"canceled"}');
end $$;
set role authenticated;
do $$ begin
 assert not has_function_privilege(current_user,'filey_ai_video(text,uuid,uuid,jsonb)','EXECUTE');
 assert not has_table_privilege(current_user,'ai_video_jobs','SELECT'), 'Callback tokens must never be client-readable';
 assert not has_table_privilege(current_user,'ai_video_jobs','INSERT');
end $$;
reset role;
select 'PASS: video pricing, ownership, duplicate settlement, failed/canceled refunds, expiry and private callbacks.';
