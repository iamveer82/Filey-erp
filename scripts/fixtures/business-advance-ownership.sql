-- Fixed proof of the baseline: two staff authors could consume 120 of shared100.
reset role;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('c0000000-0000-4000-8000-000000000003','workflow-staff@example.invalid',now(),'{"name":"Staff"}');
update profiles set org_id=(select org_id from profiles where id='c0000000-0000-4000-8000-000000000001') where id='c0000000-0000-4000-8000-000000000003';
insert into org_members(org_id,user_id,role) select org_id,'c0000000-0000-4000-8000-000000000003','staff' from profiles where id='c0000000-0000-4000-8000-000000000001' on conflict(org_id,user_id) do update set role='staff';
update org_members set role='staff' where user_id='c0000000-0000-4000-8000-000000000002' and org_id=(select org_id from profiles where id='c0000000-0000-4000-8000-000000000001');
insert into crm_customers(id,name,shared,user_id,org_id) select 910050,'Shared credit fixture',true,id,org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
insert into advances(party_type,party_id,party_name,amount,shared,user_id,org_id) select 'customer',910050,'Shared credit fixture',100,true,id,org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
set role authenticated;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000002';
insert into invoice_docs(id,number,status,customer_name,customer_id,currency,tax_rate) values(910051,'WF-STAFF-A','draft','Shared credit fixture',910050,'AED',0);
insert into invoice_doc_items(invoice_id,description,qty,unit_price) values(910051,'Service',1,100);
do $$ begin
 begin perform filey_business_workflow('invoice','advance','{"id":910051,"amount":60,"party_id":910050}',gen_random_uuid(),auth.uid(),current_org()); raise exception 'Shared read-only deposit spent'; exception when sqlstate '22023' then null; end;
end $$;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000003';
insert into invoice_docs(id,number,status,customer_name,customer_id,currency,tax_rate) values(910052,'WF-STAFF-B','draft','Shared credit fixture',910050,'AED',0);
insert into invoice_doc_items(invoice_id,description,qty,unit_price) values(910052,'Service',1,100);
do $$ begin
 begin perform filey_business_workflow('invoice','advance','{"id":910052,"amount":60,"party_id":910050}',gen_random_uuid(),auth.uid(),current_org()); raise exception 'Second author spent shared read-only deposit'; exception when sqlstate '22023' then null; end;
end $$;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';
do $$ begin
 if (select sum(amount) from advances where party_id=910050)<>100 then raise exception 'Denied allocation changed shared pool'; end if;
 begin perform filey_business_workflow('invoice','advance','{"id":910051,"amount":60,"party_id":910050}',gen_random_uuid(),auth.uid(),current_org()); raise exception 'Admin cross-author funding accepted'; exception when sqlstate '22023' then null; end;
end $$;
reset role;
insert into advances(party_type,party_id,party_name,amount,user_id,org_id) select 'customer',910050,'Shared credit fixture',100,'c0000000-0000-4000-8000-000000000002',org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
insert into products(id,name,quantity,cost_price,user_id,org_id) select 910050,'Member stock',100,2,'c0000000-0000-4000-8000-000000000002',org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
set role authenticated;
select filey_business_workflow('invoice','advance','{"id":910051,"amount":60,"party_id":910050}',gen_random_uuid(),auth.uid(),current_org());
select filey_business_workflow('invoice','save','{"id":910051,"header":{"number":"WF-STAFF-A","status":"sent","customer_name":"Shared credit fixture","customer_id":910050,"currency":"AED","tax_rate":0,"advance_applied":60},"items":[{"description":"Member stock","qty":2,"unit_price":50,"product_id":910050}]}',gen_random_uuid(),auth.uid(),current_org());
do $$ declare receipt jsonb; begin
 if exists(select 1 from transactions where invoice_id=910051 and user_id<>'c0000000-0000-4000-8000-000000000002'::uuid)
  or exists(select 1 from stock_movements where workflow_kind='invoice' and workflow_id=910051 and user_id<>'c0000000-0000-4000-8000-000000000002'::uuid)
  or exists(select 1 from advances where note='applied:inv#910051' and user_id<>'c0000000-0000-4000-8000-000000000002'::uuid)
  or exists(select 1 from invoice_doc_items where invoice_id=910051 and user_id<>'c0000000-0000-4000-8000-000000000002'::uuid) then raise exception 'Admin generated private effects under wrong author'; end if;
 receipt:=filey_business_workflow('invoice','payment-add','{"id":910051,"amount":10,"paid_at":"2026-10-04","rates":{}}',gen_random_uuid(),auth.uid(),current_org());
 if (select user_id from invoice_payments where id=(receipt->>'payment_id')::bigint)<>'c0000000-0000-4000-8000-000000000002'::uuid then raise exception 'Admin payment under wrong author'; end if;
end $$;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000002';
do $$ declare header jsonb; items jsonb; allocation bigint; deposit bigint; begin
 select id into allocation from advances where note='applied:inv#910051';
 select to_jsonb(d)||'{"notes":"Original author note edit"}'::jsonb into header from invoice_docs d where id=910051;
 select jsonb_agg(to_jsonb(i)) into items from invoice_doc_items i where invoice_id=910051;
 perform filey_business_workflow('invoice','save',jsonb_build_object('id',910051,'header',header,'items',items),gen_random_uuid(),auth.uid(),current_org());
 if (select id from advances where note='applied:inv#910051')<>allocation or (select count(*) from invoice_doc_items where invoice_id=910051)<>1 then raise exception 'Unchanged allocation or replacement lines duplicated'; end if;
 perform filey_business_workflow('invoice','payment-remove',jsonb_build_object('payment_id',(select id from invoice_payments where invoice_id=910051)),gen_random_uuid(),auth.uid(),current_org());
 if exists(select 1 from invoice_payments where invoice_id=910051) or exists(select 1 from transactions where invoice_id=910051 and source='payment') then raise exception 'Original author could not reverse admin payment'; end if;
 begin perform filey_business_workflow('invoice','advance','{"id":910051,"amount":110,"party_id":910050}',gen_random_uuid(),auth.uid(),current_org()); raise exception 'Over-allocation accepted'; exception when sqlstate '22023' then null; end;
 select id into deposit from advances where party_id=910050 and amount>0 and user_id=auth.uid();
 begin perform filey_advance_workflow('delete',jsonb_build_object('id',deposit),gen_random_uuid(),auth.uid(),current_org()); raise exception 'Spent deposit deleted'; exception when sqlstate '22023' then null; end;
 perform filey_business_workflow('invoice','status','{"id":910051,"status":"cancelled"}',gen_random_uuid(),auth.uid(),current_org());
 if (select quantity from products where id=910050)<>100 or exists(select 1 from transactions where invoice_id=910051)
   or exists(select 1 from advances where note='applied:inv#910051') or exists(select 1 from orders where invoice_id=910051) then raise exception 'Original author reversal omitted admin effects: stock %, journal %, credit %, orders %', (select quantity from products where id=910050),(select count(*) from transactions where invoice_id=910051),(select count(*) from advances where note='applied:inv#910051'),(select count(*) from orders where invoice_id=910051); end if;
 perform filey_advance_workflow('delete',jsonb_build_object('id',deposit),gen_random_uuid(),auth.uid(),current_org());
end $$;
insert into purchase_orders(id,po_number,supplier_name,status,tax_rate,currency) values(910051,'WF-STAFF-PO','Fixture','draft',0,'AED');
insert into purchase_order_items(po_id,description,quantity,unit_cost,product_id) values(910051,'Member stock',1,2,910050);
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';
select filey_business_workflow('po','receive','{"id":910051,"rates":{}}',gen_random_uuid(),auth.uid(),current_org());
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000002';
select filey_business_workflow('po','status','{"id":910051,"status":"draft"}',gen_random_uuid(),auth.uid(),current_org());
do $$ begin if (select quantity from products where id=910050)<>100 or exists(select 1 from transactions where po_id=910051) then raise exception 'Original author purchase reversal missed admin effects'; end if; end $$;
reset role;
insert into advances(party_type,party_id,party_name,amount,note,user_id,org_id) select 'customer',910050,'Historic fixture',-60,'applied:inv#910052','c0000000-0000-4000-8000-000000000001',org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
set role authenticated;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';
do $$ begin if filey_workflow_credit_available('customer',910050,auth.uid(),null,1) then raise exception 'Ambiguous cross-author allocation reusable'; end if; end $$;
reset role;
select 'PASS: read-only shared deposits cannot be spent; admin operations use parent author pool/effects; original author replaces lines, removes payment, reverses invoice/PO and releases credit; ambiguous cross-author history needs reconciliation.';
-- Identified duplicate repair preserves legacy payment/ref-only/manual history.
set role authenticated;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';
insert into accounts(id,name,account_type,balance) values(910060,'Repair source asset','asset',235),(910061,'Repair source liability','liability',235);
insert into invoice_docs(id,number,status,customer_name,tax_rate) values(910060,'WF-REPAIR-SOURCE','draft','Fixture',0);
insert into transactions(account_id,txn_type,amount,ref,source,invoice_id,description,txn_date)
select a.id,a.side,x.amount,x.ref,x.source,case when x.ref='WF-REPAIR-SOURCE' or x.source='payment' then 910060 end,x.ref,'2026-10-04'::date
from (values(910060,'debit'),(910061,'credit')) a(id,side)
cross join (values(100,'WF-REPAIR-SOURCE','invoice'),(100,'WF-REPAIR-SOURCE','invoice'),(5,'Invoice WF-REPAIR-SOURCE Payment','payment'),(5,'Invoice WF-REPAIR-SOURCE Payment','payment'),(3,'Historic ref-only','invoice'),(3,'Historic ref-only','invoice')) x(amount,ref,source);
-- Opening25 + invoices200 + payments10 =235, plus ref-only6 =>241.
update accounts set balance=241 where id in (910060,910061);
do $$ declare result jsonb; begin
 result:=filey_journal_workflow('repair','{}',gen_random_uuid(),auth.uid(),current_org());
 if (result->>'removed')::int<>2 or exists(select 1 from accounts where id in(910060,910061) and balance<>141)
   or (select count(*) from transactions where account_id=910060 and source='payment')<>2
   or (select count(*) from transactions where account_id=910060 and invoice_id is null)<>2 then raise exception 'Source repair removed legitimate ambiguous history or opening balance'; end if;
end $$;
reset role;
-- Privileged preflight must see hidden legacy admin postings before any reversal.
insert into advances(id,party_type,party_id,amount,accounting_posted,user_id,org_id)
select 910070,'customer',910050,30,true,'c0000000-0000-4000-8000-000000000002',org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
insert into accounts(id,name,account_type,balance,user_id,org_id)
select 910070,'Hidden legacy admin control','asset',40,id,org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
insert into transactions(account_id,txn_type,amount,ref,source,advance_id,user_id,org_id)
select 910070,'debit',30,'Advance #910070','advance',910070,id,org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
insert into invoice_docs(id,number,status,customer_name,tax_rate,user_id,org_id)
select 910070,'WF-HIDDEN-LEGACY','sent','Fixture',0,'c0000000-0000-4000-8000-000000000002',org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
insert into invoice_doc_items(invoice_id,description,qty,unit_price,product_id,user_id,org_id)
select 910070,'Legacy stock',1,10,910050,'c0000000-0000-4000-8000-000000000002',org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
insert into transactions(account_id,txn_type,amount,ref,source,user_id,org_id)
select 910070,'debit',10,'Invoice WF-HIDDEN-LEGACY','invoice',id,org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
insert into stock_movements(product_id,qty,type,ref,user_id,org_id)
select 910050,-1,'sale','Invoice WF-HIDDEN-LEGACY',id,org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
set role authenticated;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000002';
do $$ begin
 begin perform filey_advance_workflow('update','{"id":910070,"header":{"note":"Edited"}}',gen_random_uuid(),auth.uid(),current_org()); raise exception 'Hidden legacy deposit posting omitted'; exception when insufficient_privilege then null; end;
 begin perform filey_business_workflow('invoice','status','{"id":910070,"status":"draft"}',gen_random_uuid(),auth.uid(),current_org()); raise exception 'Hidden ref-only stock/posting omitted'; exception when insufficient_privilege then null; end;
 if (select status from invoice_docs where id=910070)<>'sent' or (select quantity from products where id=910050)<>100 then raise exception 'Denied legacy reversal changed state'; end if;
end $$;
reset role;
do $$ begin if (select balance from accounts where id=910070)<>40 or (select count(*) from transactions where account_id=910070)<>2 then raise exception 'Denied legacy reversal changed hidden books'; end if; end $$;
select 'PASS: source repair uses immutable IDs and preserves ambiguous equal payments/ref-only history; hidden legacy invoice and advance effects are rejected atomically.';
-- The privileged boolean honors the actual advances table's people module.
reset role;
insert into crm_customers(id,name,user_id,org_id) select 910080,'Restricted credit fixture','c0000000-0000-4000-8000-000000000002',org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
insert into advances(id,party_type,party_id,party_name,amount,user_id,org_id) select 910080,'customer',910080,'Restricted credit fixture',10,'c0000000-0000-4000-8000-000000000002',org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
set role authenticated;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000002';
do $$ begin if not filey_workflow_credit_available('customer',910080,auth.uid(),null,1) then raise exception 'Allowed private pool missing'; end if; end $$;
reset role;
update org_members set modules=array['invoicing','accounting'] where user_id='c0000000-0000-4000-8000-000000000002';
set role authenticated;
do $$ begin
 if filey_workflow_credit_available('customer',910080,auth.uid(),null,1) then raise exception 'Private credit bypassed people module'; end if;
 begin perform filey_advance_workflow('update','{"id":910080,"header":{"note":"Restricted change"}}',gen_random_uuid(),auth.uid(),current_org()); raise exception 'Deposit changed without people module'; exception when insufficient_privilege then null; end;
 perform filey_business_workflow('invoice','save','{"header":{"number":"WF-INVOICE-ONLY","status":"draft","customer_name":"Freeform","tax_rate":0,"advance_applied":0},"items":[{"description":"Freeform service","qty":1,"unit_price":1}]}',gen_random_uuid(),auth.uid(),current_org());
end $$;
reset role;
update org_members set modules=null where user_id='c0000000-0000-4000-8000-000000000002';
select 'PASS: private credit reads/changes honor people access; invoice-only zero-credit freeform drafts remain usable.';
-- A pre-fix administrator's later stock move is hidden from the staff author.
set role authenticated;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000002';
select filey_business_workflow('po','receive','{"id":910051,"rates":{}}',gen_random_uuid(),auth.uid(),current_org());
reset role;
insert into stock_movements(product_id,qty,type,ref,workflow_kind,workflow_id,user_id,org_id)
select 910050,1,'adjust','Historic hidden admin move','manual',910050,id,org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
update products set quantity=quantity+1 where id=910050;
set role authenticated;
do $$ begin
 begin perform filey_business_workflow('po','status','{"id":910051,"status":"draft"}',gen_random_uuid(),auth.uid(),current_org()); raise exception 'Hidden later cost user was omitted'; exception when sqlstate '22023' then null; end;
 if (select quantity from products where id=910050)<>102 or (select status from purchase_orders where id=910051)<>'received' then raise exception 'Rejected historical cost reversal changed books'; end if;
end $$;
reset role;
select 'PASS: hidden historic later stock users block receipt-cost reversal atomically.';
-- Direct mutation helpers must not bypass the outer receipt/atomic contract.
set role authenticated;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';
do $$ declare fn record; begin
 for fn in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in
 ('filey_workflow_guard','filey_workflow_account','filey_workflow_account_for_owner','filey_workflow_entry','filey_workflow_reverse','filey_workflow_stock','filey_workflow_unstock','filey_workflow_unpost','filey_workflow_post','filey_workflow_advance','filey_workflow_payment') loop
  if has_function_privilege('authenticated',fn.signature,'EXECUTE') or has_function_privilege('anon',fn.signature,'EXECUTE') or has_function_privilege('service_role',fn.signature,'EXECUTE')
    or not has_function_privilege('filey_workflow_executor',fn.signature,'EXECUTE') then raise exception 'Internal helper RPC privilege leaked: %',fn.signature; end if;
 end loop;
 begin perform filey_workflow_post('invoice','{"id":910060,"user_id":"c0000000-0000-4000-8000-000000000001","number":"FORGED-PARENT","status":"sent","currency":"AED","tax_rate":0}', '[{"description":"Injected","qty":1,"unit_price":10}]', '{}'); raise exception 'Direct posting helper RPC accepted'; exception when insufficient_privilege then null; end;
 begin perform filey_workflow_entry(910060,'debit',1,'Injected','FORGED-PARENT','invoice','2026-10-04',910060); raise exception 'Direct ledger helper RPC accepted'; exception when insufficient_privilege then null; end;
 begin perform filey_workflow_advance((select to_jsonb(d) from invoice_docs d where id=910060),0); raise exception 'Old direct advance overload still callable'; exception when insufficient_privilege then null; end;
 perform filey_business_workflow('invoice','save','{"id":910060,"header":{"number":"WF-REPAIR-SOURCE","status":"draft","customer_name":"Fixture","tax_rate":0},"items":[{"description":"Normal dispatcher","qty":1,"unit_price":10}]}',gen_random_uuid(),auth.uid(),current_org());
 if exists(select 1 from transactions where ref='FORGED-PARENT') or (select status from invoice_docs where id=910060)<>'draft' then raise exception 'Denied helper mutation leaked an effect'; end if;
end $$;
reset role;
select 'PASS: direct authenticated/anon/service internal helper calls are denied, both advance overloads are safe, and normal authenticated dispatchers continue working.';
