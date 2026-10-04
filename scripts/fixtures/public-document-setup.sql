-- Minimal table fixture; function definitions come from production migrations.
alter table invoice_docs add column share_token uuid not null default gen_random_uuid();
alter table quotations add column share_token uuid not null default gen_random_uuid();
alter table purchase_orders add column share_token uuid not null default gen_random_uuid();
alter table payment_receipts add column share_token uuid not null default gen_random_uuid();
alter table payment_receipts add column for_description text;
alter table payment_receipts add column amount numeric default 0;
alter table payment_receipts add column notes text;
alter table payment_receipts add column stamp jsonb;
alter table invoice_docs add column unit_price_formula jsonb;
alter table invoice_docs add column round_off boolean default false;
alter table invoice_docs add column bank_details jsonb;
alter table invoice_doc_items add column position bigint default 0;
alter table quotation_items add column position bigint default 0;
alter table purchase_order_items add column position bigint default 0;
alter table order_items add column order_id bigint references orders(id);
alter table quotation_items add column quotation_id bigint references quotations(id);
alter table purchase_order_items add column po_id bigint references purchase_orders(id);
alter table po_payments add column po_id bigint references purchase_orders(id);
update quotation_items set quotation_id=id;
update purchase_order_items set po_id=id;
update order_items set order_id=id;
update po_payments set po_id=id;
update invoice_docs set share_token='10000000-0000-4000-8000-000000000001',
  shared_with='["00000000-0000-0000-0000-000000000002"]',
  unit_price_formula='{"a":"qty","b":"unit_price"}',round_off=true,
  bank_details='{"account":"customer-visible account"}' where id=1;
update quotations set share_token='10000000-0000-4000-8000-000000000002' where id=1;
update purchase_orders set share_token='10000000-0000-4000-8000-000000000003' where id=1;
update payment_receipts set share_token='10000000-0000-4000-8000-000000000004',
  for_description='Customer deposit',amount=250,notes='Customer receipt terms',stamp='{"x":20,"y":30}' where id=1;
-- The original RPC emits all future columns too. Exercise stripping authority
-- without dropping customer-visible line calculation/formatting metadata.
do $$ declare t text; fk text; begin
  for t,fk in select * from (values('invoice_doc_items','invoice_id'),('quotation_items','quotation_id'),('purchase_order_items','po_id')) c(t,fk) loop
    execute format('alter table %I add column share_token uuid default gen_random_uuid()',t);
    execute format('alter table %I add column shared_with jsonb default ''["00000000-0000-0000-0000-000000000002"]''',t);
    execute format('alter table %I add column qty numeric default 2',t);
    execute format('alter table %I add column unit_price numeric default 10',t);
    execute format('alter table %I add column custom jsonb default ''{"_filey_calc_mode":"formula","discount":5,"tax":5,"label":"customer field"}''',t);
    execute format('insert into %I(id,user_id,org_id,%I,name) values(80,''00000000-0000-0000-0000-000000000005'',''b'',1,''private B line'')',t,fk);
    -- Emulate an ambiguous pre-org row; null identity must fail closed.
    execute format('alter table %I alter column org_id drop not null',t);
    execute format('insert into %I(id,user_id,org_id,%I,name) values(81,''00000000-0000-0000-0000-000000000001'',null,1,''ambiguous legacy line'')',t,fk);
  end loop;
end $$;
grant usage on schema public to anon;
