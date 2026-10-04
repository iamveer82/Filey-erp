-- Historical shared spending may match the invoice author yet overdraw that
-- author's private pool. These are synthetic maintenance fixtures only.
reset role;
insert into crm_customers(id,name,shared,user_id,org_id)
select 910090,'Legacy private pool fixture',true,id,org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
insert into invoice_docs(id,number,status,customer_name,customer_id,currency,fx_rate,tax_rate,advance_applied,user_id,org_id)
select 910090,'WF-LEGACY-BORROWER','draft','Legacy private pool fixture',910090,'AED',1,0,60,'c0000000-0000-4000-8000-000000000002',org_id from profiles where id='c0000000-0000-4000-8000-000000000001'
union all select 910091,'WF-LEGACY-DEPOSITOR','draft','Legacy private pool fixture',910090,'AED',1,0,0,id,org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
insert into invoice_doc_items(invoice_id,description,qty,unit_price,user_id,org_id)
select id,'Private pool fixture',1,100,user_id,org_id from invoice_docs where id in(910090,910091);
insert into advances(id,party_type,party_id,party_name,amount,note,shared,user_id,org_id)
select 910090,'customer',910090,'Legacy private pool fixture',100,null,true,id,org_id from profiles where id='c0000000-0000-4000-8000-000000000001'
union all select 910091,'customer',910090,'Legacy private pool fixture',-60,'applied:inv#910090',false,'c0000000-0000-4000-8000-000000000002',org_id from profiles where id='c0000000-0000-4000-8000-000000000001';
set role authenticated;
set request.jwt.claim.sub='c0000000-0000-4000-8000-000000000001';
do $$ declare header jsonb; items jsonb; allocation bigint; before_requests bigint; begin
 if current_setting('filey.fixture.credit_baseline',true)='on' then
  if not filey_workflow_credit_available('customer',910090,auth.uid(),null,80) then raise exception 'Legacy baseline failure was not reproduced'; end if;
  perform filey_business_workflow('invoice','advance','{"id":910091,"amount":80,"party_id":910090}',gen_random_uuid(),auth.uid(),current_org());
  if (select advance_applied from invoice_docs where id=910091)<>80 or (select sum(amount) from advances where party_id=910090)<>-40 then raise exception 'Legacy baseline did not double-spend the apparently intact deposit'; end if;
  raise notice 'BASELINE REPRODUCED: matching-author legacy consumption allowed original depositor to reuse 80, making the party credit pool -40.';
  return;
 end if;
 if filey_workflow_credit_available('customer',910090,auth.uid(),null,80) then raise exception 'Overdrawn hidden author pool was reusable'; end if;
 select count(*) into before_requests from business_workflow_requests;
 begin perform filey_business_workflow('invoice','advance','{"id":910091,"amount":80,"party_id":910090}',gen_random_uuid(),auth.uid(),current_org()); raise exception 'Intact-looking private deposit was double spent'; exception when sqlstate '22023' then null; end;
 begin perform filey_advance_workflow('update','{"id":910090,"header":{"amount":90}}',gen_random_uuid(),auth.uid(),current_org()); raise exception 'Unsafe deposit reduction accepted'; exception when sqlstate '22023' then null; end;
 begin perform filey_advance_workflow('delete','{"id":910090}',gen_random_uuid(),auth.uid(),current_org()); raise exception 'Unsafe deposit deletion accepted'; exception when sqlstate '22023' then null; end;
 if (select count(*) from business_workflow_requests)<>before_requests or (select advance_applied from invoice_docs where id=910091)<>0 or (select amount from advances where id=910090)<>100 then raise exception 'Denied legacy credit action left a partial effect or receipt'; end if;
 perform filey_advance_workflow('update','{"id":910090,"header":{"note":"Harmless deposit note edit"}}',gen_random_uuid(),auth.uid(),current_org());
 if (select note from advances where id=910090)<>'Harmless deposit note edit' then raise exception 'Harmless deposit note edit was blocked'; end if;
 perform set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000002',false);
 select id into allocation from advances where note='applied:inv#910090';
 select to_jsonb(d)||'{"notes":"Harmless invoice note edit"}'::jsonb into header from invoice_docs d where id=910090;
 select jsonb_agg(to_jsonb(i)) into items from invoice_doc_items i where invoice_id=910090;
 perform filey_business_workflow('invoice','save',jsonb_build_object('id',910090,'header',header,'items',items),gen_random_uuid(),auth.uid(),current_org());
 if (select id from advances where note='applied:inv#910090')<>allocation or (select advance_applied from invoice_docs where id=910090)<>60 then raise exception 'Note-only edit reallocated legacy credit'; end if;
 perform filey_business_workflow('invoice','advance','{"id":910090,"amount":0,"party_id":910090}',gen_random_uuid(),auth.uid(),current_org());
 if exists(select 1 from advances where note='applied:inv#910090') or (select advance_applied from invoice_docs where id=910090)<>0 then raise exception 'Safely attributable legacy release was blocked'; end if;
 perform set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000001',false);
 if not filey_workflow_credit_available('customer',910090,auth.uid(),null,80) then raise exception 'Reconciled original-author positive pool remained unusable'; end if;
 perform filey_business_workflow('invoice','advance','{"id":910091,"amount":80,"party_id":910090}',gen_random_uuid(),auth.uid(),current_org());
 if (select sum(amount) from advances where party_id=910090)<>20 then raise exception 'Reconciled private allocation has wrong balance'; end if;
 perform filey_business_workflow('invoice','status','{"id":910091,"status":"cancelled"}',gen_random_uuid(),auth.uid(),current_org());
 if (select sum(amount) from advances where party_id=910090)<>100 or exists(select 1 from advances where note='applied:inv#910091') then raise exception 'Cancellation did not return safely attributable credit'; end if;
end $$;
reset role;
select 'PASS: overdrawn legacy author pools block new spending/reduction with rollback; note-only edits preserve allocations, safe release/cancellation restores original-author funds.';
