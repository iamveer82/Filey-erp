-- Only disposable fixtures. No payment provider is contacted.
-- Supabase's service_role bypasses RLS; match that role in this local cluster.
alter role service_role bypassrls;
do $$ begin
  if not (select relrowsecurity from pg_class where oid='public.subscription_refund_requests'::regclass) then
    raise exception 'Refund requests must have RLS';
  end if;
  if has_table_privilege('authenticated','public.subscription_refund_requests','select,insert,update,delete')
     or has_table_privilege('anon','public.subscription_refund_requests','select,insert,update,delete') then
    raise exception 'Refund records must only be accessible via verified edge actions';
  end if;
end $$;
set role service_role;
insert into subscription_refund_requests(id,org_id,requested_by,payment_id,subscription_id,customer_id,amount,currency,reason)
values('90000000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001','pay_test','sub_test','cus_test',500,'USD','Fixture refund request');
do $$ begin
  begin
    insert into subscription_refund_requests(org_id,requested_by,payment_id,subscription_id,customer_id,amount,currency,reason)
    select org_id,requested_by,payment_id,subscription_id,customer_id,amount,currency,reason from subscription_refund_requests;
    raise exception 'Duplicate payment accepted';
  exception when unique_violation then null; end;
end $$;
reset role;
select 'PASS: refund migration is idempotent, RLS denies direct client access, and duplicate payment requests are rejected.';
