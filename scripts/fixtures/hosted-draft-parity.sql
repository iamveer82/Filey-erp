-- Synthetic records only, in the disposable cluster created by the runner.
insert into auth.users(id,email,email_confirmed_at) values
 ('b8200000-0000-4000-8000-000000000001','hosted-owner@fixture.invalid',now()),
 ('b8200000-0000-4000-8000-000000000002','other-owner@fixture.invalid',now());
insert into app_settings(user_id,org_id,key,value)
 select id,org_id,'invoice_number_format','INV-AUDIT-{000}-26' from profiles where id='b8200000-0000-4000-8000-000000000001';
insert into invoice_docs(user_id,org_id,number,status,customer_name)
 select id,org_id,'INV-AUDIT-029-26','draft','Historic buyer' from profiles where id='b8200000-0000-4000-8000-000000000001';
insert into company_profile(user_id,org_id,name,address,trn,email,phone,city,country_subdivision,country_code,legal_id,legal_id_type,
 currency,default_tax_rate,default_template,einvoice)
 select id,org_id,'Fixture seller','Seller street','100000000000003','seller@fixture.invalid','+971500000001','Dubai','DU','AE','TL-900','TL',
 'AED',5,'minimal','{"tin":"1000000000","endpoint_id":"1000000000","endpoint_scheme":"0235","credential":"never copy"}' from profiles
 where id='b8200000-0000-4000-8000-000000000001';
insert into crm_customers(user_id,org_id,name,company,email,phone,address,trn,city,country_subdivision,country_code,custom_fields)
 select id,org_id,'Fixture buyer','Buyer Trading LLC','buyer@fixture.invalid','+971500000002','Buyer street','100000000100003','Dubai','DU','AE',
 '{"einvoice_identity":"{\"tin\":\"1000000001\",\"endpoint_scheme\":\"0235\",\"credential\":\"never copy\"}"}'
 from profiles where id='b8200000-0000-4000-8000-000000000001';
insert into crm_customers(user_id,org_id,name,email,trn)
 select id,org_id,'Fixture buyer','foreign@fixture.invalid','FOREIGN' from profiles where id='b8200000-0000-4000-8000-000000000002';

-- TEST CURRENT HOSTED CONTRACT
set request.jwt.claims='{"role":"service_role"}';
do $$ declare
 owner_id uuid:='b8200000-0000-4000-8000-000000000001'; org text; other_org text;
 result jsonb; doc public.invoice_docs; lines jsonb; request jsonb; bad jsonb; count_before int; reservations_before int; failed boolean;
begin
 select org_id into org from profiles where id=owner_id;
 select org_id into other_org from profiles where id='b8200000-0000-4000-8000-000000000002';
 request:='{"customer_name":"Fixture buyer","custom_columns":[{"key":"liters","label":"T.Liters"}],"price_by":"liters","items":[{"description":"H/O 68 PAIL 20L","qty":50,"unit":"L","unit_price":0.20,"custom":{"liters":"1000"}},{"description":"15W40 PAIL 20L","qty":15,"unit":"L","unit_price":4.10,"custom":{"liters":"300"}},{"description":"20W50 PAIL 20L","qty":15,"unit":"L","unit_price":4.10,"custom":{"liters":"300"}}]}';
 request:=request||'{"issue_date":"2026-09-23","due_date":"2026-10-01","notes":"Keep this note\nexactly as supplied.","terms":"Delivery after payment."}';
 result:=public.filey_channel_create_draft(owner_id,org,'invoice',request);
 if result->>'number'<>'INV-AUDIT-030-26' or (result->>'total')::numeric<>2793 then raise exception 'Sequence or T.Liters total changed: %',result; end if;
 select * into doc from invoice_docs where id=(result->>'id')::bigint;
 if doc.issue_date<>'2026-09-23'::date or doc.due_date<>'2026-10-01'::date
   or doc.notes<>request->>'notes' or doc.terms<>request->>'terms' then raise exception 'Requested dates, notes or terms were changed'; end if;
 if doc.seller_name<>'Fixture seller' or doc.seller_trn<>'100000000000003' or doc.seller_email<>'seller@fixture.invalid'
   or doc.seller_phone<>'+971500000001' or doc.seller_legal_id<>'TL-900' or doc.tax_country_code<>'AE'
   or doc.customer_address<>'Buyer street' or doc.customer_trn<>'100000000100003' or doc.buyer_city<>'Dubai'
   or doc.customer_email<>'buyer@fixture.invalid' or doc.customer_id is null
   or doc.einvoice->'seller'->>'tin'<>'1000000000' or doc.einvoice->'buyer'->>'tin'<>'1000000001'
   or doc.einvoice->'buyer'->>'phone'<>'+971500000002' or doc.einvoice->>'uuid' is null
   or doc.einvoice::text like '%credential%' then raise exception 'Saved identity snapshot mismatch'; end if;
 if doc.unit_price_formula<>'{"a":"liters","b":"unit_price"}' or doc.custom_columns<>request->'custom_columns' then raise exception 'Saved formula changed'; end if;
 select jsonb_agg(jsonb_build_object('description',description,'qty',qty,'unit',unit,'unit_price',unit_price,'custom',custom) order by position)
 into lines from invoice_doc_items where invoice_id=doc.id;
 if lines<>request->'items' then raise exception 'User quantities, rates, units or custom values changed: %',lines; end if;
 update company_profile set name='Later seller name' where org_id=org;
 if (select seller_name from invoice_docs where id=doc.id)<>'Fixture seller' then raise exception 'Snapshot changed with preset'; end if;
 select count(*) into count_before from invoice_docs;
 select count(*) into reservations_before from document_number_reservations;
 foreach bad in array array[
   jsonb_set(request,'{items,0,custom,liters}','"not a number"'),
   jsonb_set(request,'{items,0,custom,liters}','"Infinity"'),
   jsonb_set(request,'{items,0,custom}','{}'),
   jsonb_set(request,'{price_by}','"missing"'),
   jsonb_set(request,'{custom_columns}','[{"key":"liters","label":"One"},{"key":"liters","label":"Two"}]'),
   jsonb_set(request,'{items,0,custom,__manual_amount}','"1"'),
   jsonb_set(request,'{items,0,qty}','0'),
   jsonb_set(request,'{items,0,unit_price}','0.009'),
   jsonb_set(request,'{tax_rate}','5.1234'),
   jsonb_set(request,'{issue_date}','"2026-02-31"'),
   jsonb_set(request,'{issue_date}','"23/09/26"'),
   jsonb_set(request,'{issue_date}','""'),
   jsonb_set(request,'{due_date}','"2026-13-01"'),
   jsonb_set(request,'{due_date}','null'),
   jsonb_set(request,'{notes}','123'),
   jsonb_set(request,'{terms}','{}')
 ] loop
   failed:=false;
   begin perform public.filey_channel_create_draft(owner_id,org,'invoice',bad);
   exception when invalid_parameter_value then failed:=true; end;
   if not failed then raise exception 'Invalid calculation was accepted: %',bad; end if;
 end loop;
 failed:=false;
 begin perform public.filey_channel_create_draft(owner_id,other_org,'invoice',request);
 exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Cross-workspace save accepted'; end if;
 insert into crm_customers(user_id,org_id,name) values(owner_id,org,'Fixture buyer');
 failed:=false;
 begin perform public.filey_channel_create_draft(owner_id,org,'invoice',request);
 exception when invalid_parameter_value then failed:=true; end;
 if not failed then raise exception 'Ambiguous customer accepted'; end if;
 if count_before<>(select count(*) from invoice_docs) or reservations_before<>(select count(*) from document_number_reservations) then
   raise exception 'Rejected save consumed records or sequence numbers'; end if;
 update company_profile set default_tax_rate=0,currency='USD' where org_id=org;
 result:=public.filey_channel_create_draft(owner_id,org,'invoice','{"customer_name":"New buyer","customer_email":"manual@fixture.invalid","items":[{"description":"Item","qty":2,"unit_price":10}]}');
 if result->>'number'<>'INV-AUDIT-031-26' or result->>'currency'<>'USD' or (result->>'total')::numeric<>20 then raise exception 'Company defaults ignored'; end if;
 select * into doc from invoice_docs where id=(result->>'id')::bigint;
 if doc.issue_date<>current_date or doc.due_date is not null then raise exception 'Omitted date defaults changed'; end if;
 result:=public.filey_channel_create_draft(owner_id,org,'invoice','{"customer_name":"New buyer","currency":"AED","tax_rate":5,"due_date":"","notes":"","terms":"","items":[{"description":"Item","qty":2,"unit_price":10}]}');
 if result->>'currency'<>'AED' or (result->>'total')::numeric<>21 then raise exception 'Explicit currency/tax overwritten'; end if;
 select * into doc from invoice_docs where id=(result->>'id')::bigint;
 if doc.due_date is not null or doc.notes<>'' or doc.terms<>'' then raise exception 'Explicit blank due date or text changed'; end if;
 if has_function_privilege('service_role','public.filey_reserve_document_number_internal(text,text,integer,uuid,uuid,text)','execute')
   or has_function_privilege('authenticated','public.filey_reserve_document_number_internal(text,text,integer,uuid,uuid,text)','execute')
   or has_function_privilege('anon','public.filey_reserve_document_number_internal(text,text,integer,uuid,uuid,text)','execute')
   or has_function_privilege('authenticated','public.filey_channel_create_draft(uuid,text,text,jsonb)','execute')
   or not has_function_privilege('service_role','public.filey_channel_create_draft(uuid,text,text,jsonb)','execute') then raise exception 'Hosted/private function grants changed'; end if;
 raise notice 'PASS: sequence, seller/buyer snapshots, cross-workspace denial, exact T.Liters inputs/totals, defaults/overrides, private grants and preallocation validation.';
end $$;
