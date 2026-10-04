insert into public.quotations(id,user_id,org_id,number)
 select 920001,id,org_id,'REC-QUOTE-BASE' from public.profiles where id='b0000000-0000-4000-8000-000000000001';
insert into public.orders(id,user_id,org_id,order_number)
 select 920001,id,org_id,'REC-ORDER-BASE' from public.profiles where id='b0000000-0000-4000-8000-000000000001';
insert into public.invoice_docs(id,user_id,org_id,number,status,template,accent,currency,
  seller_name,seller_address,seller_trn,seller_email,seller_phone,customer_name,customer_address,
  customer_trn,customer_email,issue_date,due_date,notes,terms,tax_rate,discount,custom_columns,
  unit_price_formula,doc_title,po_number,stamp,signature,show_stamp,show_signature,show_logo,
  show_bank,shared,shared_with,fx_rate,advance_applied,einvoice,quotation_id)
 select s.id,p.id,p.org_id,s.number,'draft','corporate','#123456','AED',
  'Fixture Seller','Dubai','100000000000003','seller@fixture.invalid','+971500000000',
  'Recurring fixture customer','Abu Dhabi','100000000000005','buyer@fixture.invalid',
  current_date-10,current_date+15,'Keep manual notes','Keep terms',5,12.34,
  '[{"key":"length","label":"Length"}]','{"multiply":["qty","length"]}',
  'Recurring custom title','CUSTOM-PO','{"src":"stamp"}','{"src":"signature"}',true,true,true,true,
  true,jsonb_build_array('b0000000-0000-4000-8000-000000000002'),1,50,
  '{"uuid":"b4000000-0000-4000-8000-000000000001","payment":{"code":"30"},"custom":"keep"}',920001
 from public.profiles p cross join (values
  (920001::bigint,'REC-BASE'),(920002,'REC-FAIL-CHILD'),(920003,'REC-FAIL-SCHEDULE'),(920010,'REC-PURCHASE-BASE')) s(id,number)
 where p.id='b0000000-0000-4000-8000-000000000001';
do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoice_docs' and column_name='order_id') then
    update public.invoice_docs set order_id=920001 where id between 920001 and 920010;
  end if;
end $$;
update public.invoice_docs set doc_type='purchase' where id=920010;
insert into public.invoice_doc_items(user_id,org_id,invoice_id,description,qty,unit_price,unit,custom,tax_category,position)
 select p.id,p.org_id,s.id,case when s.id=920002 then 'FAIL-CHILD' else 'Manual item' end,2.345,13.37,'carton','{"length":5,"manual":"kept"}','S',7
 from public.profiles p cross join (values(920001::bigint),(920002),(920003),(920010)) s(id)
 where p.id='b0000000-0000-4000-8000-000000000001';
insert into public.invoice_doc_items(user_id,org_id,invoice_id,description,qty,unit_price,unit,custom,tax_category,position)
 select id,org_id,920001,'Second manual item',1,99.99,'pcs','{"manual":"second"}','S',11
 from public.profiles where id='b0000000-0000-4000-8000-000000000001';
insert into public.app_settings(user_id,org_id,key,value)
 select id,org_id,'invoice_number_format','REC-{YYYY}-{0001}' from public.profiles where id='b0000000-0000-4000-8000-000000000001';
insert into public.app_settings(user_id,org_id,key,value)
 select id,org_id,'purchase_invoice_number_format','BUY-{YYYY}-{0100}' from public.profiles where id='b0000000-0000-4000-8000-000000000001';
insert into public.invoice_recurrence(id,user_id,org_id,base_invoice_id,interval,next_run,active,shared)
 select r.id,p.id,p.org_id,r.base,'monthly',(now() at time zone 'UTC')::date+r.offset_days,r.active,true
 from public.profiles p cross join (values
   (920001::bigint,920001::bigint,0,true),(920002,920002,0,true),(920003,920003,0,true),
   (920005,920001,1,true),(920006,920001,0,false),(920010,920010,0,true)) r(id,base,offset_days,active)
 where p.id='b0000000-0000-4000-8000-000000000001';
-- Staff can see the shared base, but ownership is still required for cloning.
insert into public.invoice_recurrence(id,user_id,org_id,base_invoice_id,interval,next_run,shared)
 select 920004,'b0000000-0000-4000-8000-000000000002',org_id,920001,'monthly',(now() at time zone 'UTC')::date,false
 from public.profiles where id='b0000000-0000-4000-8000-000000000001';
-- Reproduce a malformed historical/admin-created child. Restore the real
-- stamping trigger immediately; an ordinary app caller cannot create this.
insert into public.invoice_docs(id,user_id,org_id,number,status)
 select 920030,id,org_id,'REC-MALFORMED-BASE','draft' from public.profiles where id='b0000000-0000-4000-8000-000000000001';
insert into public.invoice_recurrence(id,user_id,org_id,base_invoice_id,next_run)
 select 920030,id,org_id,920030,(now() at time zone 'UTC')::date from public.profiles where id='b0000000-0000-4000-8000-000000000001';
insert into public.invoice_doc_items(user_id,org_id,invoice_id,description,qty,unit_price)
 select id,org_id,920030,'Visible legitimate line',1,5 from public.profiles where id='b0000000-0000-4000-8000-000000000001';
alter table public.invoice_doc_items disable trigger trg_invoice_doc_items_org;
insert into public.invoice_doc_items(user_id,org_id,invoice_id,description,qty,unit_price)
 select user_id,org_id,920030,'Foreign hidden historical line',2,99 from public.org_members
 where user_id='b0000000-0000-4000-8000-000000000002' and role='owner'
   and org_id<>(select org_id from public.profiles where id='b0000000-0000-4000-8000-000000000001');
alter table public.invoice_doc_items enable trigger trg_invoice_doc_items_org;
