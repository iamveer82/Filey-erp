-- Disposable database only; columns used by the production expense RPC.
alter table expenses add column category text, add column description text, add column amount numeric,
  add column expense_date date, add column account_id bigint;
alter table accounts add column code text, add column account_type text, add column balance numeric default 0;
alter table transactions add column account_id bigint, add column txn_type text, add column amount numeric,
  add column description text, add column ref text, add column source text, add column txn_date date;
create sequence fixture_expense_ids start 10000;
alter table expenses alter column id set default nextval('fixture_expense_ids');
alter table accounts alter column id set default nextval('fixture_expense_ids');
alter table transactions alter column id set default nextval('fixture_expense_ids');
create table user_files(id uuid primary key, owner uuid);
alter table user_files enable row level security;
create policy fixture_files on user_files for all to authenticated using(owner=auth.uid()) with check(owner=auth.uid());
grant usage on sequence fixture_expense_ids to authenticated;
grant select on user_files to authenticated;
insert into user_files values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004');
create function fixture_fail_expense() returns trigger language plpgsql as $$ begin
  if new.amount=777 then raise exception 'Fixture posting failure'; end if; return new;
end $$;
create trigger fixture_post_failure before insert on transactions for each row execute function fixture_fail_expense();
