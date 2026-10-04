-- Actual installed schema and authority functions, synthetic records only.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('c0000000-0000-4000-8000-000000000001','workflow-owner@example.invalid',now(),'{"name":"Workflow owner"}'),
 ('c0000000-0000-4000-8000-000000000002','workflow-other@example.invalid',now(),'{"name":"Workflow other"}');
set role authenticated;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';
set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
insert into products(id,sku,name,quantity,cost_price) values(910001,'WF-1','Workflow stock',100,3);
insert into crm_customers(id,name) values(910001,'Workflow customer');
insert into invoice_docs(id,number,status,customer_name,tax_rate,customer_id) values(910001,'WF-INV-1','draft','Workflow customer',5,910001);
insert into invoice_doc_items(invoice_id,description,qty,unit_price,product_id) values(910001,'Two units',2,10,910001);
select filey_business_workflow('invoice','status','{"id":910001,"status":"sent"}','c0000000-0000-4000-8000-000000000010',auth.uid(),current_org());
do $$ begin
  begin
    insert into business_workflow_requests(request_id,action,payload,result) values('c0000000-0000-4000-8000-000000000099','invoice:save','{}','{"id":1}');
    raise exception 'Forged workflow receipt accepted';
  exception when insufficient_privilege then null; end;
  begin
    update business_workflow_requests set result='{"id":1}'; raise exception 'Workflow receipt rewrite allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from business_workflow_requests; raise exception 'Workflow receipt deletion allowed';
  exception when insufficient_privilege then null; end;
  if exists(select 1 from pg_roles where rolname='filey_workflow_executor' and (rolcanlogin or rolsuper or rolbypassrls))
    or pg_has_role('authenticated','filey_workflow_executor','MEMBER') then raise exception 'Client can assume privileged workflow execution'; end if;
  if (select quantity from products where id=910001)<>98 then raise exception 'Sale stock not posted'; end if;
  if (select balance from accounts where name='Accounts Receivable')<>21 then raise exception 'Sale AR not gross'; end if;
  if (select balance from accounts where name='Sales Revenue')<>20 then raise exception 'Sale revenue not net'; end if;
  if (select balance from accounts where name='Output VAT')<>1 then raise exception 'Sale VAT missing'; end if;
  if (select sum(case when txn_type='debit' then amount else -amount end) from transactions where invoice_id=910001)<>0 then raise exception 'Sale journal unbalanced'; end if;
  perform filey_business_workflow('invoice','status','{"id":910001,"status":"sent"}','c0000000-0000-4000-8000-000000000010',auth.uid(),current_org());
  if (select quantity from products where id=910001)<>98 then raise exception 'Replay moved stock'; end if;
  begin
    perform filey_business_workflow('invoice','status','{"id":910001,"status":"draft"}','c0000000-0000-4000-8000-000000000010',auth.uid(),current_org());
    raise exception 'Different payload replay accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform filey_business_workflow('invoice','status','{"id":910001,"status":"draft"}','c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000002',current_org());
    raise exception 'Wrong actor accepted';
  exception when insufficient_privilege then null; end;
end $$;
select 'PASS: invoice posting is balanced, reserves stock once, binds actor, and rejects mismatched request replay.';
reset role;
-- Inject a failure after header/lines and stock have changed, at the contra leg.
create function fixture_workflow_ledger_failure() returns trigger language plpgsql as $$ begin
 if new.amount=777 and new.txn_type='debit' then raise exception 'Synthetic contra posting failure'; end if;
 return new;
end $$;
create trigger fixture_workflow_ledger_failure before insert on transactions for each row execute function fixture_workflow_ledger_failure();
set role authenticated;
do $$ declare before_qty numeric; before_docs bigint; before_txns bigint; begin
  select quantity into before_qty from products where id=910001;
  select count(*) into before_docs from invoice_docs;
  select count(*) into before_txns from transactions;
  begin
    perform filey_business_workflow('invoice','save','{"header":{"number":"WF-FAIL","status":"sent","tax_rate":5},"items":[{"description":"Rollback","qty":1,"unit_price":740,"product_id":910001}]}',
      'c0000000-0000-4000-8000-000000000020',auth.uid(),current_org());
    raise exception 'Contra failure injection did not fire';
  exception when others then if sqlerrm<>'Synthetic contra posting failure' then raise; end if; end;
  if (select quantity from products where id=910001)<>before_qty or (select count(*) from invoice_docs)<>before_docs
    or (select count(*) from transactions)<>before_txns or exists(select 1 from business_workflow_requests where request_id='c0000000-0000-4000-8000-000000000020') then
    raise exception 'Failed invoice left partial records'; end if;
end $$;
select 'PASS: a contra posting failure rolls back the invoice, replacement lines, stock, generated order, accounts, journal and receipt.';
insert into purchase_orders(id,po_number,status,tax_rate,currency,fx_rate) values(910001,'WF-PO-1','draft',5,'USD',4);
insert into purchase_order_items(po_id,description,quantity,unit_cost,product_id) values(910001,'Receipt',3,7,910001);
select filey_business_workflow('po','receive','{"id":910001,"rates":{"USD":5}}','c0000000-0000-4000-8000-000000000030',auth.uid(),current_org());
select filey_business_workflow('po','receive','{"id":910001,"rates":{"USD":5}}','c0000000-0000-4000-8000-000000000031',auth.uid(),current_org());
do $$ begin
  if (select quantity from products where id=910001)<>101 then raise exception 'PO received twice or stock missing'; end if;
  if (select balance from accounts where name='Accounts Payable')<>88.2 then raise exception 'Frozen PO FX or payable incorrect'; end if;
  if (select sum(case when txn_type='debit' then amount else -amount end) from transactions where po_id=910001)<>0 then raise exception 'PO journal unbalanced'; end if;
end $$;
select filey_business_workflow('po','payment-add','{"id":910001,"amount":5,"paid_at":"2026-10-04","rates":{"USD":5}}','c0000000-0000-4000-8000-000000000032',auth.uid(),current_org());
do $$ declare pay bigint; begin
  if (select balance from accounts where name='Cash & Bank')<>-25 or (select balance from accounts where name='Accounts Payable')<>68.2
    or (select balance from accounts where name='Foreign Exchange Gain/Loss')<>5 then raise exception 'PO payment FX/cash/AP incorrect'; end if;
  if (select sum(case when txn_type='debit' then amount else -amount end) from transactions where po_id=910001)<>0 then raise exception 'PO payment unbalanced'; end if;
  select id into pay from po_payments where po_id=910001;
  perform filey_business_workflow('po','payment-remove',jsonb_build_object('payment_id',pay),'c0000000-0000-4000-8000-000000000033',auth.uid(),current_org());
  if exists(select 1 from po_payments where id=pay) or (select balance from accounts where name='Accounts Payable')<>88.2 then raise exception 'PO payment removal not reversed'; end if;
end $$;
select filey_business_workflow('po','status','{"id":910001,"status":"draft"}','c0000000-0000-4000-8000-000000000034',auth.uid(),current_org());
do $$ begin
  if (select quantity from products where id=910001)<>98 or (select balance from accounts where name='Accounts Payable')<>0
    or (select stock_received from purchase_orders where id=910001) then raise exception 'PO unreceive not atomic'; end if;
end $$;
select 'PASS: PO receiving is once-only, stock and balanced VAT/payable use frozen FX; payment/remove FX legs and unreceive restore stock/ledger.';
do $$ declare order_id bigint; before_qty numeric; begin
  select quantity into before_qty from products where id=910001;
  order_id:=(filey_order_workflow('save','{"header":{"order_number":"WF-SO-1","customer_name":"Workflow customer"},"items":[{"product_id":910001,"quantity":3,"unit_price":4}]}',
    'c0000000-0000-4000-8000-000000000040',auth.uid(),current_org())->>'id')::bigint;
  if (select quantity from products where id=910001)<>before_qty-3 then raise exception 'Order stock reservation missing'; end if;
  perform filey_order_workflow('status',jsonb_build_object('id',order_id,'status','cancelled'),'c0000000-0000-4000-8000-000000000041',auth.uid(),current_org());
  if (select quantity from products where id=910001)<>before_qty then raise exception 'Cancelled order stock not restored'; end if;
  perform filey_order_workflow('delete',jsonb_build_object('id',order_id),'c0000000-0000-4000-8000-000000000042',auth.uid(),current_org());
  if (select quantity from products where id=910001)<>before_qty then raise exception 'Cancelled order deletion restored twice'; end if;
end $$;
select 'PASS: receipts cannot be forged/rewritten/deleted, executor has no login/RLS bypass; orders reserve, cancel and delete without duplicate stock.';
reset role;

-- Independent foreign-currency advance allocation, cancellation, and journal guards.
set role authenticated;
insert into crm_customers(id,name) values(910010,'Advance customer');
insert into invoice_docs(id,number,status,customer_name,customer_id,currency,fx_rate,tax_rate,advance_applied)
 values(910010,'WF-ADV-1','draft','Advance customer',910010,'USD',4,0,0);
insert into invoice_doc_items(invoice_id,description,qty,unit_price) values(910010,'Service',1,100);
do $$ declare deposit bigint; before_ar numeric; before_cash numeric; begin
 select coalesce(balance,0) into before_ar from accounts where name='Accounts Receivable';
 select coalesce(balance,0) into before_cash from accounts where name='Cash & Bank';
 deposit:=(filey_advance_workflow('add','{"header":{"party_type":"customer","party_id":910010,"party_name":"Advance customer","amount":100,"paid_at":"2026-10-04"}}',
  'c0000000-0000-4000-8000-000000000060',auth.uid(),current_org())->>'id')::bigint;
 if (select balance from accounts where name='Cash & Bank')<>before_cash+100 or (select balance from accounts where name='Customer Advances')<>100 then raise exception 'Advance deposit did not book cash/liability'; end if;
 perform filey_business_workflow('invoice','advance','{"id":910010,"amount":20,"party_id":910010}',
  'c0000000-0000-4000-8000-000000000061',auth.uid(),current_org());
 if (select sum(amount) from advances where party_id=910010)<>20 then raise exception 'USD allocation did not consume AED pool at frozen FX'; end if;
 perform filey_business_workflow('invoice','status','{"id":910010,"status":"sent"}','c0000000-0000-4000-8000-000000000062',auth.uid(),current_org());
 if (select balance from accounts where name='Accounts Receivable')<>before_ar+320 or (select balance from accounts where name='Customer Advances')<>20 then raise exception 'Posted advance AR/liability not relieved'; end if;
 begin
  perform filey_business_workflow('invoice','advance','{"id":910010,"amount":26,"party_id":910010}','c0000000-0000-4000-8000-000000000063',auth.uid(),current_org());
  raise exception 'Over-allocation accepted';
 exception when sqlstate '22023' then null; end;
 begin
  perform filey_advance_workflow('delete',jsonb_build_object('id',deposit),'c0000000-0000-4000-8000-000000000064',auth.uid(),current_org());
  raise exception 'Spent deposit deletion accepted';
 exception when sqlstate '22023' then null; end;
 begin
  perform filey_business_workflow('invoice','advance','{"id":910010,"amount":20,"party_id":910001}','c0000000-0000-4000-8000-000000000065',auth.uid(),current_org());
  raise exception 'Wrong-party advance accepted';
 exception when sqlstate '22023' then null; end;
 perform filey_business_workflow('invoice','status','{"id":910010,"status":"cancelled"}','c0000000-0000-4000-8000-000000000066',auth.uid(),current_org());
 if (select balance from accounts where name='Accounts Receivable')<>before_ar or (select sum(amount) from advances where party_id=910010)<>100 then raise exception 'Cancellation did not release advance and AR'; end if;
 perform filey_advance_workflow('delete',jsonb_build_object('id',deposit),'c0000000-0000-4000-8000-000000000067',auth.uid(),current_org());
 if (select balance from accounts where name='Cash & Bank')<>before_cash or (select balance from accounts where name='Customer Advances')<>0 then raise exception 'Deposit deletion did not reverse cash/liability'; end if;
end $$;
select 'PASS: AED advance pool is booked with cash/liability, foreign allocation uses frozen FX, rejects overspend/wrong-party/spent-deposit deletion, and cancellation restores credit.';

-- Equal manual entries are distinct; source bundles cannot be torn apart.
do $$ declare account bigint; one bigint; two bigint; result jsonb; before_count bigint; begin
 insert into accounts(code,name,account_type,balance) values('9990','Manual workflow fixture','asset',0) returning id into account;
 one:=(filey_journal_workflow('post',jsonb_build_object('account_id',account,'txn_type','debit','amount',2,'description','Same manual intent','txn_date','2026-10-04'),'c0000000-0000-4000-8000-000000000070',auth.uid(),current_org())->>'id')::bigint;
 two:=(filey_journal_workflow('post',jsonb_build_object('account_id',account,'txn_type','debit','amount',2,'description','Same manual intent','txn_date','2026-10-04'),'c0000000-0000-4000-8000-000000000071',auth.uid(),current_org())->>'id')::bigint;
 result:=filey_journal_workflow('repair','{}','c0000000-0000-4000-8000-000000000072',auth.uid(),current_org());
 if one=two or (result->>'removed')::int<>0 or (select balance from accounts where id=account)<>4 then raise exception 'Legitimate equal manual entries removed'; end if;
 begin
  perform filey_journal_workflow('account-delete',jsonb_build_object('id',account),'c0000000-0000-4000-8000-000000000073',auth.uid(),current_org()); raise exception 'Active account deleted';
 exception when sqlstate '22023' then null; end;
 begin
  perform filey_journal_workflow('delete',jsonb_build_object('id',(select min(id) from transactions where invoice_id=910001)),'c0000000-0000-4000-8000-000000000074',auth.uid(),current_org()); raise exception 'Linked posting deleted alone';
 exception when sqlstate '22023' then null; end;
 perform filey_journal_workflow('delete',jsonb_build_object('id',one),'c0000000-0000-4000-8000-000000000075',auth.uid(),current_org());
 if (select balance from accounts where id=account)<>2 then raise exception 'Manual reversal balance wrong'; end if;
end $$;
select 'PASS: repair preserves legitimate equal manual entries, active accounts/source legs are protected, and manual reversal restores its balance.';

-- Prior cost is restored when receipt is unconsumed; later cost users block rewrite.
insert into products(id,sku,name,quantity,cost_price) values(910020,'WF-COST','Cost fixture',10,2);
insert into purchase_orders(id,po_number,status,supplier_name,tax_rate,currency) values(910020,'WF-PO-COST','draft','Fixture',0,'AED');
insert into purchase_order_items(po_id,description,quantity,unit_cost,product_id) values(910020,'New receipt',10,6,910020);
select filey_business_workflow('po','receive','{"id":910020,"rates":{}}','c0000000-0000-4000-8000-000000000080',auth.uid(),current_org());
do $$ begin
 if (select cost_price from products where id=910020)<>4 then raise exception 'Weighted receipt cost incorrect'; end if;
 perform filey_stock_workflow('adjust','{"id":910020,"delta":-1,"type":"out"}','c0000000-0000-4000-8000-000000000081',auth.uid(),current_org());
 begin
  perform filey_business_workflow('po','status','{"id":910020,"status":"draft"}','c0000000-0000-4000-8000-000000000082',auth.uid(),current_org()); raise exception 'Historic COGS rewrite accepted';
 exception when sqlstate '22023' then null; end;
 if (select quantity from products where id=910020)<>19 or (select cost_price from products where id=910020)<>4 or (select status from purchase_orders where id=910020)<>'received' then raise exception 'Rejected cost rewrite left partial changes'; end if;
end $$;
select 'PASS: moving-average receipt snapshots cost; later stock use blocks an unsafe historical reversal atomically.';
reset role;
-- Malformed hidden child rows must be detected rather than skipped under RLS.
insert into invoice_docs(id,user_id,org_id,number,status,customer_name,tax_rate) select 910030,'c0000000-0000-4000-8000-000000000001',org_id,'WF-CORRUPT','draft','Fixture',0 from invoice_docs where id=910001;
-- Import a pre-trigger historic inconsistency as maintenance, not through the
-- current first-party insertion path (which stamps the parent org correctly).
alter table invoice_doc_items disable trigger user;
insert into invoice_doc_items(invoice_id,user_id,org_id,description,qty,unit_price) values(910030,'c0000000-0000-4000-8000-000000000002','workflow-foreign-org','Hidden malformed line',1,99);
alter table invoice_doc_items enable trigger user;
set role authenticated;
do $$ begin
 begin
  perform filey_business_workflow('invoice','status','{"id":910030,"status":"sent"}','c0000000-0000-4000-8000-000000000083',auth.uid(),current_org()); raise exception 'Hidden corrupt lines skipped';
 exception when insufficient_privilege then null; end;
 if (select status from invoice_docs where id=910030)<>'draft' or exists(select 1 from transactions where invoice_id=910030) then raise exception 'Corrupt child rejection partially posted'; end if;
end $$;
select 'PASS: the authorized boolean gate rejects corrupt historical child ownership without exposing or silently omitting it.';
reset role;

-- Admin replacement children legitimately have a different creator than parent.
update profiles set org_id=(select org_id from profiles where id='c0000000-0000-4000-8000-000000000001') where id='c0000000-0000-4000-8000-000000000002';
insert into org_members(org_id,user_id,role) select org_id,'c0000000-0000-4000-8000-000000000002','staff' from profiles where id='c0000000-0000-4000-8000-000000000001' on conflict(org_id,user_id) do nothing;
insert into invoice_docs(id,user_id,org_id,number,status,customer_name,tax_rate) select 910040,'c0000000-0000-4000-8000-000000000002',org_id,'WF-ADMIN-INV','draft','Member-owned',0 from profiles where id='c0000000-0000-4000-8000-000000000001';
insert into invoice_doc_items(invoice_id,user_id,org_id,description,qty,unit_price) select 910040,'c0000000-0000-4000-8000-000000000002',org_id,'Initial line',1,10 from profiles where id='c0000000-0000-4000-8000-000000000001';
insert into purchase_orders(id,user_id,org_id,po_number,status,supplier_name,tax_rate) select 910040,'c0000000-0000-4000-8000-000000000002',org_id,'WF-ADMIN-PO','draft','Member-owned',0 from profiles where id='c0000000-0000-4000-8000-000000000001';
insert into purchase_order_items(po_id,user_id,org_id,description,quantity,unit_cost) select 910040,'c0000000-0000-4000-8000-000000000002',org_id,'Initial line',1,10 from profiles where id='c0000000-0000-4000-8000-000000000001';
set role authenticated;
do $$ declare iteration int; begin
 for iteration in 1..2 loop
  perform filey_business_workflow('invoice','save',jsonb_build_object('id',910040,'header','{"number":"WF-ADMIN-INV","status":"draft","customer_name":"Member-owned","tax_rate":0}'::jsonb,'items',jsonb_build_array(jsonb_build_object('description','Admin edit','qty',iteration,'unit_price',10))),gen_random_uuid(),auth.uid(),current_org());
  perform filey_business_workflow('po','save',jsonb_build_object('id',910040,'header','{"po_number":"WF-ADMIN-PO","status":"draft","supplier_name":"Member-owned","tax_rate":0}'::jsonb,'items',jsonb_build_array(jsonb_build_object('description','Admin edit','quantity',iteration,'unit_cost',10))),gen_random_uuid(),auth.uid(),current_org());
 end loop;
 if (select user_id from invoice_docs where id=910040)<> 'c0000000-0000-4000-8000-000000000002'::uuid or (select user_id from invoice_doc_items where invoice_id=910040)<> 'c0000000-0000-4000-8000-000000000002'::uuid then raise exception 'Admin edit did not preserve parent and child author'; end if;
end $$;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000002';
do $$ begin
 if not exists(select 1 from invoice_docs where id=910040) or (select qty from invoice_doc_items where invoice_id=910040)<>2
  or not exists(select 1 from purchase_orders where id=910040) or (select quantity from purchase_order_items where po_id=910040)<>2 then raise exception 'Original author cannot read admin replacements'; end if;
end $$;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';
reset role;
select 'PASS: an admin can edit member-owned invoice and PO twice, preserving parent ownership and original-author access to replacement lines.';
