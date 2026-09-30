-- The caller cannot grant himself financial settlement authority.
set role authenticated;
set test.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
do $$ begin
  begin perform filey_settle_stripe_checkout('cs_forbidden','invoice_payment',null,1,105,'AED','pi_forbidden');
    raise exception 'Authenticated settlement should fail';
  exception when insufficient_privilege then null; end;
end $$;
-- Reject dot segments, encoded separators and forged output folders at the
-- database write boundary before any worker can claim the row.
do $$ declare bad text; begin
  foreach bad in array array['../VICTIM/private.pdf','job/../../VICTIM/private.pdf','%2e%2e/file.pdf','%252e%252e/file.pdf','a//file.pdf','./file.pdf','file.pdf/','a\file.pdf','a?file.pdf','a#file.pdf',''] loop
    begin
      insert into tool_jobs values(10,auth.uid(),auth.uid()::text||'/'||bad,'{}');
      raise exception 'Bad input path accepted: %',bad;
    exception when insufficient_privilege then null; end;
  end loop;
  begin
    insert into tool_jobs values(11,auth.uid(),auth.uid()::text||'/job/input.pdf',array['VICTIM/file.pdf']);
    raise exception 'Foreign output path accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into tool_jobs values(12,auth.uid(),auth.uid()::text||'/job/input.pdf',array[null]::text[]);
    raise exception 'Null output path accepted';
  exception when insufficient_privilege then null; end;
end $$;
insert into tool_jobs values(1,auth.uid(),auth.uid()::text||'/job/Customer invoice.pdf',array[auth.uid()::text||'/job/output.pdf']);
select assert_equal((select count(*) from tool_jobs),1::bigint,'Canonical job paths still work');
reset role;
set role service_role;
set test.claims='{"role":"service_role"}';
select filey_settle_stripe_checkout('cs_partial','invoice_payment',null,1,50,'AED','pi_partial');
select filey_settle_stripe_checkout('cs_partial','invoice_payment',null,1,50,'AED','pi_partial');
select filey_settle_stripe_checkout('cs_balance','invoice_payment',null,1,55,'AED','pi_balance');
select filey_settle_stripe_checkout('cs_license','lite_license','00000000-0000-0000-0000-000000000001',null,99,'USD','pi_license');
select filey_settle_stripe_checkout('cs_license','lite_license','00000000-0000-0000-0000-000000000001',null,99,'USD','pi_license');
do $$ begin
  begin perform filey_settle_stripe_checkout('cs_partial','invoice_payment',null,2,50,'AED','pi_partial');
    raise exception 'Cross-invoice replay accepted'; exception when others then
    if sqlerrm not like '%replay mismatch%' then raise; end if; end;
  begin perform filey_settle_stripe_checkout('cs_other_session','invoice_payment',null,1,50,'AED','pi_partial');
    raise exception 'Same intent under another session accepted'; exception when others then
    if sqlerrm not like '%replay mismatch%' then raise; end if; end;
  begin perform filey_settle_stripe_checkout('cs_currency','invoice_payment',null,2,50,'USD','pi_currency');
    raise exception 'Wrong invoice currency accepted'; exception when others then
    if sqlerrm not like '%currency or reference mismatch%' then raise; end if; end;
  begin perform filey_settle_stripe_checkout('cs_unknown_user','lite_license','00000000-0000-0000-0000-000000000099',null,99,'USD','pi_unknown_user');
    raise exception 'Missing buyer accepted'; exception when foreign_key_violation then null; end;
end $$;
reset role;
select assert_equal((select count(*) from invoice_payments),2::bigint,'Replay cannot duplicate payment');
select assert_equal((select sum(amount) from invoice_payments),105::numeric,'Only real settled amounts counted');
select assert_equal((select status from invoice_docs where id=1),'paid'::text,'Settled balance marks invoice paid');
select assert_equal((select status from invoice_docs where id=2),'sent'::text,'Other invoice unchanged');
select assert_equal((select count(*) from licenses),1::bigint,'Replay cannot duplicate license');
select assert_equal((select count(*) from stripe_settled_checkouts where session_id='cs_unknown_user'),0::bigint,'Failed settlement rolls back receipt atomically');
select 'PASS: canonical job input/output boundaries and paid Stripe settlement/replay/rollback protections.';
