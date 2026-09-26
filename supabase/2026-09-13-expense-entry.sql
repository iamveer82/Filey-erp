-- Itemized paid expenses, private receipt references and atomic ledger changes.
-- Additive only: existing expense records are not rewritten.
begin;
alter table public.expenses add column if not exists details jsonb;
create unique index if not exists expenses_submission_id on public.expenses
  (user_id, (details->>'submission_id')) where details->>'submission_id' is not null;

create or replace function public.filey_record_expense(p_expense jsonb) returns bigint
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  result_id bigint; expense_account bigint; cash_account bigint;
  total numeric := (p_expense->>'amount')::numeric;
  entry_date date := (p_expense->>'expense_date')::date;
  category_name text := btrim(p_expense->>'category');
  description_text text := p_expense->>'description';
  detail jsonb := p_expense->'details'; line jsonb;
  subtotal numeric := 0; discount_amount numeric; tax_rate numeric; fx numeric;
begin
  if auth.uid() is null then raise exception 'Sign in before logging expenses.'; end if;
  if total is null or total <= 0 or total >= 1000000000000 or total::text in ('NaN','Infinity','-Infinity') or entry_date is null
    or coalesce(category_name,'') = '' or length(category_name)>100 then raise exception 'Invalid expense amount, category or date.'; end if;
  if length(coalesce(description_text,''))>5000 then raise exception 'Expense description is too long.'; end if;
  -- Serialize default-account creation and retries for this user, within this transaction.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':expense', 0));
  if detail is not null and detail <> 'null'::jsonb then
    if detail->>'version' is distinct from '1' or coalesce(detail->>'submission_id','') !~* '^[a-f0-9-]{36}$'
      or coalesce(btrim(detail->>'vendor'),'')='' or length(detail->>'vendor')>200
      or length(coalesce(detail->>'reference',''))>200 or length(coalesce(detail->>'notes',''))>5000
      or coalesce(detail->>'payment_method','') not in ('Cash','Bank transfer','Card','Other')
      or jsonb_typeof(detail->'items') is distinct from 'array' then raise exception 'Invalid expense details.'; end if;
    select id into result_id from public.expenses where user_id=auth.uid() and details->>'submission_id'=detail->>'submission_id';
    if found then
      if not exists(select 1 from public.expenses where id=result_id and amount=round(total,2) and category=category_name and expense_date=entry_date and details=detail)
        then raise exception 'This expense was already saved. Open it from Purchase to review the saved details.'; end if;
      return result_id;
    end if;
    if jsonb_array_length(detail->'items') not between 1 and 100 then raise exception 'Add between 1 and 100 expense items.'; end if;
    for line in select value from jsonb_array_elements(detail->'items') loop
      if coalesce(btrim(line->>'description'),'')='' or length(line->>'description')>1000
        or coalesce(btrim(line->>'unit'),'')='' or length(line->>'unit')>30
        or jsonb_typeof(line->'qty') is distinct from 'number' or jsonb_typeof(line->'unit_price') is distinct from 'number'
        or (line->>'qty')::numeric <= 0 or (line->>'qty')::numeric > 1000000000
        or (line->>'unit_price')::numeric < 0 or (line->>'unit_price')::numeric > 1000000000000 then raise exception 'Invalid expense item.'; end if;
      subtotal := subtotal + round((line->>'qty')::numeric * (line->>'unit_price')::numeric,2);
    end loop;
    discount_amount := (detail->>'discount')::numeric; tax_rate := (detail->>'tax_rate')::numeric; fx := (detail->>'fx_rate')::numeric;
    if discount_amount is null or discount_amount<0 or discount_amount>subtotal or tax_rate is null or tax_rate<0 or tax_rate>100
      or fx is null or fx<=0 or fx>1000000 or coalesce(detail->>'currency','') !~ '^[A-Z]{3}$' or (detail->>'currency'='AED' and fx<>1)
      or round(round((subtotal-discount_amount)*(1+tax_rate/100),2)*fx,2) <> round(total,2)
      then raise exception 'Expense total does not match its items, tax and exchange rate.'; end if;
    if detail ? 'receipt' and detail->'receipt'<>'null'::jsonb then
      if not exists(select 1 from public.user_files where id=(detail->'receipt'->>'id')::uuid and owner=auth.uid())
        then raise exception 'Receipt not found or access denied.'; end if;
    end if;
  end if;
  expense_account := (p_expense->>'account_id')::bigint;
  if expense_account is null then
    select id into expense_account from public.accounts where user_id=auth.uid() and account_type='expense' and name ~* 'operating|expense|general'
      order by id limit 1;
    if expense_account is null then insert into public.accounts(code,name,account_type,balance) values('5000','Operating Expenses','expense',0) returning id into expense_account; end if;
  end if;
  cash_account := (detail->>'payment_account_id')::bigint;
  if cash_account is null then
    select id into cash_account from public.accounts where user_id=auth.uid() and account_type='asset' and name ~* 'cash|bank' order by id limit 1;
    if cash_account is null then insert into public.accounts(code,name,account_type,balance) values('1000','Cash & Bank','asset',0) returning id into cash_account; end if;
  end if;
  if not exists(select 1 from public.accounts where id=expense_account and account_type='expense')
    or not exists(select 1 from public.accounts where id=cash_account and account_type='asset') then raise exception 'Choose valid expense and payment accounts.'; end if;
  insert into public.expenses(category,description,amount,expense_date,account_id,details)
    values(category_name,description_text,round(total,2),entry_date,expense_account,detail) returning id into result_id;
  insert into public.transactions(account_id,txn_type,amount,description,ref,source,txn_date) values
    (expense_account,'debit',round(total,2),coalesce(description_text,category_name),'Expense '||result_id,'expense',entry_date),
    (cash_account,'credit',round(total,2),coalesce(description_text,category_name)||' — paid','Expense '||result_id,'expense',entry_date);
  update public.accounts set balance=balance+round(total,2) where id=expense_account;
  if not found then raise exception 'Expense account is not writable.'; end if;
  update public.accounts set balance=balance-round(total,2) where id=cash_account;
  if not found then raise exception 'Payment account is not writable.'; end if;
  return result_id;
end $$;

create or replace function public.filey_delete_expense(p_id bigint) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare posting record;
begin
  perform 1 from public.expenses where id=p_id for update;
  if not found then raise exception 'Expense not found or access denied.'; end if;
  for posting in select t.id,t.account_id,t.amount,t.txn_type,a.account_type from public.transactions t
    left join public.accounts a on a.id=t.account_id where t.source='expense' and t.ref='Expense '||p_id for update of t loop
    if posting.account_id is not null then
      update public.accounts set balance=balance + case
        when (posting.account_type in ('asset','expense')) = (posting.txn_type='debit') then -posting.amount else posting.amount end where id=posting.account_id;
      if not found then raise exception 'Expense account is not writable.'; end if;
    end if;
    delete from public.transactions where id=posting.id;
    if not found then raise exception 'Expense posting is not writable.'; end if;
  end loop;
  delete from public.expenses where id=p_id;
  if not found then raise exception 'Expense is not writable.'; end if;
end $$;
revoke all on function public.filey_record_expense(jsonb), public.filey_delete_expense(bigint) from public, anon;
grant execute on function public.filey_record_expense(jsonb), public.filey_delete_expense(bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
