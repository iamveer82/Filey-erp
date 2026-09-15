set role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000004',false);
do $$ declare saved_id bigint; retry_id bigint; rows_before bigint; amount_total numeric; input jsonb;
begin
  input := '{"category":"Office","description":"Fixture expense","amount":173.53,"expense_date":"2026-09-13","details":{"version":1,"submission_id":"20000000-0000-0000-0000-000000000001","vendor":"Fixture store","currency":"USD","fx_rate":3.6725,"discount":5,"tax_rate":5,"payment_method":"Cash","items":[{"description":"Paper","qty":2,"unit":"box","unit_price":15},{"description":"Ink","qty":1,"unit":"pcs","unit_price":20}],"receipt":{"id":"10000000-0000-0000-0000-000000000001"}}}';
  saved_id := public.filey_record_expense(input); retry_id := public.filey_record_expense(input);
  if saved_id<>retry_id then raise exception 'Retry duplicated expense'; end if;
  if (select count(*) from transactions where ref='Expense '||saved_id)<>2 then raise exception 'Missing ledger legs'; end if;
  if (select sum(case when txn_type='debit' then amount else -amount end) from transactions where ref='Expense '||saved_id)<>0 then raise exception 'Unbalanced expense'; end if;
  if (select details->'items'->0->>'unit' from expenses where expenses.id=saved_id)<>'box' then raise exception 'Lost line detail'; end if;
  select count(*) into rows_before from expenses;
  begin
    perform public.filey_record_expense('{"category":"Fail","amount":777,"expense_date":"2026-09-13"}');
    raise exception 'Expected posting failure';
  exception when raise_exception then
    if sqlerrm<>'Fixture posting failure' then raise; end if;
  end;
  if (select count(*) from expenses)<>rows_before then raise exception 'Partial expense survived failure'; end if;
  -- Another organization cannot delete or reuse the owner's receipt.
  perform set_config('test.uid','00000000-0000-0000-0000-000000000005',true);
  begin perform public.filey_delete_expense(saved_id); raise exception 'Cross-tenant deletion succeeded';
  exception when raise_exception then if sqlerrm<>'Expense not found or access denied.' then raise; end if; end;
  begin perform public.filey_record_expense(input); raise exception 'Cross-tenant receipt accepted';
  exception when raise_exception then if sqlerrm<>'Receipt not found or access denied.' then raise; end if; end;
  perform set_config('test.uid','00000000-0000-0000-0000-000000000004',true);
  perform public.filey_delete_expense(saved_id);
  if exists(select 1 from transactions where ref='Expense '||saved_id) then raise exception 'Orphan ledger entries'; end if;
  if exists(select 1 from accounts where user_id=auth.uid() and balance<>0) then raise exception 'Balances not reversed'; end if;
end $$;
reset role;
select 'PASS: itemized expenses, receipts, atomic rollback, retry protection and ledger reversal; cross-tenant access denied.';
