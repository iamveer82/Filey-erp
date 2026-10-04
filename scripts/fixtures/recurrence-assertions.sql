create temp table recurrence_assertions(label text primary key);
grant select,insert on recurrence_assertions to authenticated,anon;
create function pg_temp.check_recurrence(p_label text,p_condition boolean) returns void language plpgsql as $$ begin
  if not coalesce(p_condition,false) then raise exception 'Recurrence assertion failed: %',p_label; end if;
  insert into recurrence_assertions values(p_label);
end $$;
create function pg_temp.reject_recurrence(p_label text,p_sql text,p_state text) returns void language plpgsql as $$ begin
  begin execute p_sql;
  exception when others then
    if sqlstate<>p_state then raise; end if;
    insert into recurrence_assertions values(p_label);return;
  end;
  raise exception 'Recurrence operation unexpectedly succeeded: %',p_label;
end $$;
create function pg_temp.fail_recurring_line() returns trigger language plpgsql as $$ begin
  if new.description='FAIL-CHILD' then raise exception 'Fixture rejected recurring line'; end if;
  return new;
end $$;
create function pg_temp.fail_recurring_schedule() returns trigger language plpgsql as $$ begin
  if new.id=920003 then raise exception 'Fixture rejected recurring schedule'; end if;
  return new;
end $$;
create trigger fixture_recurring_line before insert on public.invoice_doc_items for each row execute function pg_temp.fail_recurring_line();
create trigger fixture_recurring_schedule before update on public.invoice_recurrence for each row execute function pg_temp.fail_recurring_schedule();
set role authenticated;
set request.jwt.claim.sub='b0000000-0000-4000-8000-000000000001';
set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
do $$ declare today date:=(now() at time zone 'UTC')::date; next_date date:=((now() at time zone 'UTC')::date+interval '1 month')::date;
  v_org text:=public.current_org(); command text; v_cycle bigint; before_headers bigint; before_lines bigint;
begin
  command:=format('select public.filey_generate_recurring_invoice(920001,%L,%L,%L,%L,%L)',today,today,next_date,'b0000000-0000-4000-8000-000000000002',v_org);
  perform pg_temp.reject_recurrence('spoofed recurrence actor',command,'42501');
  command:=format('select public.filey_generate_recurring_invoice(920001,%L,%L,%L,auth.uid(),%L)',today,today,next_date,'ffffffff-ffff-4fff-8fff-ffffffffffff');
  perform pg_temp.reject_recurrence('foreign recurrence workspace',command,'42501');
  command:=format('select public.filey_generate_recurring_invoice(920005,%L,%L,%L,auth.uid(),public.current_org())',today+1,today,next_date);
  perform pg_temp.reject_recurrence('not due schedule denied',command,'22023');
  command:=format('select public.filey_generate_recurring_invoice(920001,%L,%L,%L,auth.uid(),public.current_org())',today,today+1,next_date);
  perform pg_temp.reject_recurrence('forged future current date denied',command,'22023');
  command:=format('select public.filey_generate_recurring_invoice(920001,%L,%L,%L,auth.uid(),public.current_org())',today,today,next_date+1);
  perform pg_temp.reject_recurrence('incorrect next date denied',command,'40001');
  perform pg_temp.check_recurrence('inactive recurrence creates nothing',not public.filey_generate_recurring_invoice(920006,today,today,next_date,auth.uid(),v_org));
  perform pg_temp.check_recurrence('ordinary RLS hides malformed foreign child',(select count(*)=1 from public.invoice_doc_items where invoice_id=920030));
  perform pg_temp.check_recurrence('integrity helper sees hidden foreign child',not public.filey_recurring_items_owned(920030,v_org));
  perform pg_temp.reject_recurrence('helper foreign workspace denied',$q$select public.filey_recurring_items_owned(920001,'ffffffff-ffff-4fff-8fff-ffffffffffff')$q$,'42501');
  perform pg_temp.reject_recurrence('helper foreign parent denied',format('select public.filey_recurring_items_owned(900001,%L)',v_org),'42501');
  -- The private reservation count is checked as database owner below.
  select count(*) into before_headers from public.invoice_docs;
  select count(*) into before_lines from public.invoice_doc_items;
  foreach v_cycle in array array[920002::bigint,920003,920030] loop
    command:=format('select public.filey_generate_recurring_invoice(%s,%L,%L,%L,auth.uid(),public.current_org())',v_cycle,today,today,next_date);
    perform pg_temp.reject_recurrence('rollback injected failure '||v_cycle,command,'P0001');
    perform pg_temp.check_recurrence('rollback headers '||v_cycle,(select count(*)=before_headers from public.invoice_docs));
    perform pg_temp.check_recurrence('rollback lines '||v_cycle,(select count(*)=before_lines from public.invoice_doc_items));
    perform pg_temp.check_recurrence('rollback schedule '||v_cycle,(select next_run=today and last_run is null from public.invoice_recurrence where invoice_recurrence.id=v_cycle));
  end loop;
end $$;
reset role;
select pg_temp.check_recurrence('failed cycles consume no number reservations',not exists(select 1 from public.document_number_reservations where number like 'REC-%'));
drop trigger fixture_recurring_line on public.invoice_doc_items;
drop trigger fixture_recurring_schedule on public.invoice_recurrence;
update public.org_members set modules=array['invoicing'] where user_id='b0000000-0000-4000-8000-000000000002'
 and org_id=(select org_id from public.profiles where id='b0000000-0000-4000-8000-000000000001');
set role authenticated;
set request.jwt.claim.sub='b0000000-0000-4000-8000-000000000002';
select pg_temp.reject_recurrence('shared base cloning requires author or admin',format('select public.filey_generate_recurring_invoice(920004,%L,%L,%L,auth.uid(),public.current_org())',(now() at time zone 'UTC')::date,(now() at time zone 'UTC')::date,((now() at time zone 'UTC')::date+interval '1 month')::date),'42501');
select pg_temp.reject_recurrence('helper shared recipient is not author',$q$select public.filey_recurring_items_owned(920001,public.current_org())$q$,'42501');
reset role;
-- Same staff member owns a recurrence and base: deny only through module gate.
insert into public.invoice_docs(id,user_id,org_id,number,status)
 select 920020,'b0000000-0000-4000-8000-000000000002',org_id,'REC-STAFF-BASE','draft' from public.profiles where id='b0000000-0000-4000-8000-000000000001';
insert into public.invoice_recurrence(id,user_id,org_id,base_invoice_id,next_run)
 select 920020,'b0000000-0000-4000-8000-000000000002',org_id,920020,(now() at time zone 'UTC')::date from public.profiles where id='b0000000-0000-4000-8000-000000000001';
update public.org_members set modules=array['team'] where user_id='b0000000-0000-4000-8000-000000000002'
 and org_id=(select org_id from public.profiles where id='b0000000-0000-4000-8000-000000000001');
set role authenticated;
select pg_temp.reject_recurrence('invoice module denial',format('select public.filey_generate_recurring_invoice(920020,%L,%L,%L,auth.uid(),public.current_org())',(now() at time zone 'UTC')::date,(now() at time zone 'UTC')::date,((now() at time zone 'UTC')::date+interval '1 month')::date),'42501');
set role anon;
select pg_temp.reject_recurrence('anonymous recurrence denied',$q$select public.filey_generate_recurring_invoice(920001,current_date,current_date,current_date+31,null,'default')$q$,'42501');
select pg_temp.reject_recurrence('anonymous integrity helper denied',$q$select public.filey_recurring_items_owned(920001,'default')$q$,'42501');
reset role;
reset request.jwt.claim.sub;
reset request.jwt.claims;
select 'PASS: '||count(*)||' real recurring invoice authority, date validation and transactional failure assertions.' from recurrence_assertions;
