-- Historical duplicates are deliberately seeded before the new guard. No
-- business records are deleted or renumbered by the actual upgrade under test.
drop trigger zz_filey_document_number on public.invoice_docs;
drop trigger zz_filey_setting_number on public.app_settings;
insert into public.invoice_docs(id,user_id,org_id,number,status,customer_name)
 select s.id,p.id,p.org_id,s.number,'draft','Number fixture customer'
 from public.profiles p cross join (values
   (910001::bigint,'INV-0042-26'),(910002,'LEGACY-DUP'),(910003,'LEGACY-DUP'),
   (910004,'MANUAL-001'),(910005,'MANUAL-002'),
   (910006,'SAFE-9007199254740991'),(910007,'HUGE-'||repeat('9',60))) s(id,number)
 where p.id='b0000000-0000-4000-8000-000000000001';
insert into public.app_settings(id,user_id,org_id,key,value)
 select 910001,p.id,p.org_id,'letters',jsonb_build_array(
   jsonb_build_object('id','old-a','form',jsonb_build_object('number','LTR-DUP','blocks','[]'::jsonb)),
   jsonb_build_object('id','old-b','form',jsonb_build_object('number','LTR-DUP','blocks','[]'::jsonb)),
   jsonb_build_object('id','seed','form',jsonb_build_object('number','LTR-0042-26','blocks','[]'::jsonb))
 )::text from public.profiles p where p.id='b0000000-0000-4000-8000-000000000001';
insert into public.quotations(id,user_id,org_id,number)
 select 910001,id,org_id,'Q-MANUAL-001' from public.profiles where id='b0000000-0000-4000-8000-000000000001';
insert into public.purchase_orders(id,user_id,org_id,po_number)
 select 910001,id,org_id,'PO-MANUAL-001' from public.profiles where id='b0000000-0000-4000-8000-000000000001';
insert into public.orders(id,user_id,org_id,order_number)
 select 910001,id,org_id,'SO-MANUAL-001' from public.profiles where id='b0000000-0000-4000-8000-000000000001';
insert into public.payment_receipts(id,user_id,org_id,number)
 select 910001,id,org_id,'RCPT-MANUAL-001' from public.profiles where id='b0000000-0000-4000-8000-000000000001';
