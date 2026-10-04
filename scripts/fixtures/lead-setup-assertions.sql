-- Actual service API role; no fake persistence helper functions.
create temp table lead_assertions(label text primary key);
grant select,insert on lead_assertions to anon,authenticated,service_role;
create function pg_temp.check_lead(p_label text,p_condition boolean) returns void language plpgsql as $$ begin
  if not coalesce(p_condition,false) then raise exception 'Lead assertion failed: %',p_label; end if;
  insert into lead_assertions values(p_label);
end $$;
create function pg_temp.reject_lead(p_label text,p_sql text,p_state text) returns void language plpgsql as $$ begin
  begin execute p_sql;
  exception when others then
    if sqlstate<>p_state then raise; end if;
    insert into lead_assertions values(p_label); return;
  end;
  raise exception 'Lead operation unexpectedly succeeded: %',p_label;
end $$;
insert into public.platform_config(key,value) values('owner_uid','b0000000-0000-4000-8000-000000000002')
 on conflict(key) do update set value=excluded.value;
-- Forced failure after lead+voucher writes must roll back all of them.
create function pg_temp.fail_lead_coupon() returns trigger language plpgsql as $$ begin
  if new.phone='+971500000099' then raise exception 'Fixture failure at coupon insert'; end if;
  return new;
end $$;
create trigger fixture_fail_lead_coupon before insert on public.lead_coupons for each row execute function pg_temp.fail_lead_coupon();
set role service_role;
set request.jwt.claims='{"role":"service_role"}';
do $$ declare result jsonb; repeated jsonb; before_leads bigint; before_vouchers bigint; before_coupons bigint; before_requests bigint; n text; begin
  select count(*) into before_leads from public.lead_requests;
  select count(*) into before_vouchers from public.vouchers;
  select count(*) into before_coupons from public.lead_coupons;
  select count(*) into before_requests from public.lead_setup_requests;
  perform pg_temp.reject_lead('coupon failure is propagated',$q$select public.filey_record_lead('b3000000-0000-4000-8000-000000000001','Failure fixture','+971500000099',null,null,'app','fixture-ip','freedom','FL-ABCDE-FGHJK-LMNPQ-RSTUV',now()+interval '30 days')$q$,'P0001');
  perform pg_temp.check_lead('failed setup has no partial lead',(select count(*)=before_leads from public.lead_requests));
  perform pg_temp.check_lead('failed setup has no orphan voucher',(select count(*)=before_vouchers from public.vouchers));
  perform pg_temp.check_lead('failed setup has no partial coupon',(select count(*)=before_coupons from public.lead_coupons));
  perform pg_temp.check_lead('failed setup has no successful receipt',(select count(*)=before_requests from public.lead_setup_requests));
  result:=public.filey_record_lead('b3000000-0000-4000-8000-000000000002','Freedom fixture','+971500000001','lead@fixture.invalid','Hello','app','fixture-ip','freedom','FL-BCDEF-GHJKL-MNPQR-STUVW',now()+interval '30 days');
  perform pg_temp.check_lead('Freedom lead voucher coupon committed together',
    exists(select 1 from public.lead_requests l join public.lead_coupons c on c.lead_id=l.id join public.vouchers v on v.code=c.code
      where l.id=(result->>'id')::bigint and l.plan='freedom' and v.max_uses=1 and c.code=result->>'code'));
  repeated:=public.filey_record_lead('b3000000-0000-4000-8000-000000000002','Freedom fixture','+971500000001','lead@fixture.invalid','Hello','app','changed-network-ip','freedom','FL-CDEFG-HJKLM-NPQRS-TUVWX',now()+interval '29 days');
  perform pg_temp.check_lead('replay returns immutable original coupon expiry and ID',result=repeated);
  perform pg_temp.check_lead('replay creates no duplicate lead',(select count(*)=before_leads+1 from public.lead_requests));
  perform pg_temp.check_lead('replay creates no unused proposed voucher',(select count(*)=before_vouchers+1 from public.vouchers));
  perform pg_temp.check_lead('owner notified exactly once',(select count(*)=1 from public.notifications where kind='lead' and body like 'Freedom fixture%'));
  perform pg_temp.check_lead('notification uses configured owner, not first signup',exists(select 1 from public.notifications where kind='lead' and body like 'Freedom fixture%' and user_id='b0000000-0000-4000-8000-000000000002'));
  perform pg_temp.reject_lead('changed payload replay rejected',$q$select public.filey_record_lead('b3000000-0000-4000-8000-000000000002','Changed name','+971500000001','lead@fixture.invalid','Hello','app','fixture-ip','freedom','FL-CDEFG-HJKLM-NPQRS-TUVWX',now()+interval '30 days')$q$,'22023');
  update public.lead_requests set emailed=true where id=(result->>'id')::bigint;
  repeated:=public.filey_record_lead('b3000000-0000-4000-8000-000000000002','Freedom fixture','+971500000001','lead@fixture.invalid','Hello','app','fixture-ip','freedom','FL-CDEFG-HJKLM-NPQRS-TUVWX',now()+interval '30 days');
  perform pg_temp.check_lead('replay reports current accepted email state',repeated->>'emailed'='true');
  result:=public.filey_record_lead('b3000000-0000-4000-8000-000000000003','Enterprise fixture','+971500000002',null,'Business request','website','fixture-ip','enterprise',null,null);
  perform pg_temp.check_lead('Enterprise inquiry never creates a license coupon',result->>'code' is null and not exists(select 1 from public.lead_coupons where lead_id=(result->>'id')::bigint));
  perform pg_temp.check_lead('Enterprise plan saved correctly',exists(select 1 from public.lead_requests where id=(result->>'id')::bigint and plan='enterprise' and message='[Enterprise inquiry] Business request'));
  perform pg_temp.reject_lead('service request validates name',$q$select public.filey_record_lead(gen_random_uuid(),repeat('x',121),'+971500000001',null,null,'app','fixture-ip','enterprise',null,null)$q$,'22023');
  perform pg_temp.reject_lead('service request validates phone',$q$select public.filey_record_lead(gen_random_uuid(),'Bad phone','none',null,null,'app','fixture-ip','enterprise',null,null)$q$,'22023');
  perform pg_temp.reject_lead('service request bounds message',$q$select public.filey_record_lead(gen_random_uuid(),'Bad message','+971500000001',null,repeat('x',1001),'app','fixture-ip','enterprise',null,null)$q$,'22023');
  perform pg_temp.reject_lead('service request rejects expired coupons',$q$select public.filey_record_lead(gen_random_uuid(),'Expired','+971500000001',null,null,'app','fixture-ip','freedom','FL-CDEFG-HJKLM-NPQRS-TUVWX',now()-interval '1 day')$q$,'22023');
  perform pg_temp.reject_lead('service request rejects distant expiry',$q$select public.filey_record_lead(gen_random_uuid(),'Distant','+971500000001',null,null,'app','fixture-ip','freedom','FL-CDEFG-HJKLM-NPQRS-TUVWX',now()+interval '32 days')$q$,'22023');
  perform pg_temp.reject_lead('service request rejects coupons for Enterprise',$q$select public.filey_record_lead(gen_random_uuid(),'Enterprise','+971500000001',null,null,'app','fixture-ip','enterprise','FL-CDEFG-HJKLM-NPQRS-TUVWX',now()+interval '30 days')$q$,'22023');
end $$;
reset role;
drop trigger fixture_fail_lead_coupon on public.lead_coupons;
set role authenticated;
set request.jwt.claim.sub='b0000000-0000-4000-8000-000000000001';
set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
select pg_temp.reject_lead('authenticated cannot invoke service setup',$q$select public.filey_record_lead(gen_random_uuid(),'Caller','+971500000001',null,null,'app','ip','enterprise',null,null)$q$,'42501');
select pg_temp.reject_lead('authenticated cannot read replay contact ledger',$q$select * from public.lead_setup_requests$q$,'42501');
set role anon;
set request.jwt.claims='{"role":"anon"}';
select pg_temp.reject_lead('anonymous cannot invoke service setup',$q$select public.filey_record_lead(gen_random_uuid(),'Caller','+971500000001',null,null,'app','ip','enterprise',null,null)$q$,'42501');
reset role;
reset request.jwt.claim.sub;
reset request.jwt.claims;
select 'PASS: '||count(*)||' actual lead setup rollback, replay, service ACL, validation and owner notification assertions.' from lead_assertions;
