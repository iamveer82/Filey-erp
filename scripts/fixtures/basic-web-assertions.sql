-- Restrictive cloud policies intersect the existing tenant rules, as in production.
create policy filey_cloud_insert on invoice_docs as restrictive for insert to authenticated
  with check (public.filey_cloud_access());
create policy filey_cloud_update on invoice_docs as restrictive for update to authenticated
  using (public.filey_cloud_access()) with check (public.filey_cloud_access());
set role authenticated;
select set_config('test.uid','20000000-0000-0000-0000-000000000001',false);
do $$ begin
  if not filey_cloud_access() then raise exception 'Basic web access denied'; end if;
  if filey_invoice_usage() <> 1 then raise exception 'Existing invoice count incorrect'; end if;
end $$;
insert into invoice_docs(id) select n from generate_series(3,6) n;
do $$ begin
  begin
    insert into invoice_docs(id) values (7);
    raise exception 'Sixth invoice was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Basic plan limit reached%' then raise; end if;
  end;
  for i in 1..20 loop
    update invoice_docs set notes='Edit '||i where id=1;
  end loop;
  insert into invoice_docs(id,notes) values (1,'Upsert edit')
    on conflict(id) do update set notes=excluded.notes;
  if filey_invoice_usage() <> 5 then raise exception 'Editing changed creation usage'; end if;
  if (select notes from invoice_docs where id=1) <> 'Upsert edit' then raise exception 'Edit failed'; end if;
  -- A client cannot reset or inspect another tenant's private counter.
  begin
    update invoice_monthly_usage set used=0;
    raise exception 'Counter is writable';
  exception when insufficient_privilege then null; end;
  begin
    insert into invoice_docs(id,org_id) values(7,'10000000-0000-0000-0000-000000000002');
    raise exception 'Cross-tenant insertion allowed';
  exception when insufficient_privilege then null; end;
end $$;
delete from invoice_docs where id=6;
do $$ begin
  begin
    insert into invoice_docs(id,created_at) values (7, now()-interval '2 months');
    raise exception 'Deletion/backdating bypassed limit';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Basic plan limit reached%' then raise; end if;
  end;
  if filey_invoice_usage() <> 5 then raise exception 'Rejected creation consumed usage'; end if;
end $$;
select set_config('test.uid','20000000-0000-0000-0000-000000000007',false);
do $$ begin
  if filey_invoice_usage() <> 5 then raise exception 'Members do not share workspace usage'; end if;
end $$;
-- Paid, grandfathered and Ultra workspaces remain uncapped.
do $$ begin
  for org in 2..4 loop
    perform set_config('test.uid','20000000-0000-0000-0000-'||lpad(org::text,12,'0'),false);
    if filey_invoice_usage() <> 0 then raise exception 'Usage leaked across tenants'; end if;
    insert into invoice_docs(id) select org*100+n from generate_series(1,6) n;
    if filey_invoice_usage() <> 6 then raise exception 'Unlimited workspace blocked'; end if;
  end loop;
end $$;
-- A new month's counter starts at zero, independent of the previous month.
reset role;
update organizations set plan_status='canceled' where id='10000000-0000-0000-0000-000000000002';
set role authenticated;
select set_config('test.uid','20000000-0000-0000-0000-000000000002',false);
do $$ begin
  if not filey_cloud_access() then raise exception 'Lapsed plan lost Basic web access'; end if;
  update invoice_docs set notes='Still editable after downgrade' where id=201;
  begin
    insert into invoice_docs(id) values(207);
    raise exception 'Lapsed plan bypassed cap';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Basic plan limit reached%' then raise; end if;
  end;
end $$;
reset role;
insert into invoice_monthly_usage values ('10000000-0000-0000-0000-000000000005',
  (date_trunc('month',now() at time zone 'UTC')-interval '1 month')::date,5);
set role authenticated;
select set_config('test.uid','20000000-0000-0000-0000-000000000005',false);
do $$ begin
  if filey_invoice_usage() <> 0 then raise exception 'Month did not reset'; end if;
end $$;
insert into invoice_docs(id) values(500);
do $$ begin
  begin
    insert into invoice_docs(id) values(501);
    raise check_violation;
  exception when check_violation then null; end;
  if filey_invoice_usage() <> 1 then raise exception 'Rolled-back insert consumed allowance'; end if;
end $$;
select set_config('test.uid','20000000-0000-0000-0000-000000000099',false);
do $$ begin
  if filey_cloud_access() then raise exception 'Non-member cloud access allowed'; end if;
end $$;
select set_config('test.uid','',false);
do $$ begin
  if filey_cloud_access() then raise exception 'Signed-out access allowed'; end if;
end $$;
-- Leave a separate workspace at four invoices for the concurrent insert test.
select set_config('test.uid','20000000-0000-0000-0000-000000000006',false);
insert into invoice_docs(id) select n from generate_series(600,603) n;
reset role;
select 'PASS: Basic web, monthly creation quota, unlimited edits/upserts, tenant isolation, paid entitlements and rollback.';
