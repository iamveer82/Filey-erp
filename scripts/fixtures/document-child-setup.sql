-- Apply after the real shared-record migration in a fresh fixture database.
alter table order_items add column order_id bigint references orders(id);
alter table quotation_items add column quotation_id bigint references quotations(id);
alter table purchase_order_items add column po_id bigint references purchase_orders(id);
alter table po_payments add column po_id bigint references purchase_orders(id);
update order_items set order_id=id;
update quotation_items set quotation_id=id;
update purchase_order_items set po_id=id;
update po_payments set po_id=id;
insert into orders(id,user_id,org_id) values(21,'00000000-0000-0000-0000-000000000005','b');
insert into quotations(id,user_id,org_id) values(21,'00000000-0000-0000-0000-000000000005','b');
insert into purchase_orders(id,user_id,org_id) values(21,'00000000-0000-0000-0000-000000000005','b');
-- Own orphan and malformed legacy rows need neither deletion nor a data rewrite.
-- A leaked child must no longer be readable merely because its flag is shared.
do $$ declare item record; begin
  for item in select * from (values ('order_items','order_id'),('quotation_items','quotation_id'),('purchase_order_items','po_id'),('po_payments','po_id')) c(t,fk) loop
    execute format('insert into %I(id,user_id,org_id,%I,shared) values(80,''00000000-0000-0000-0000-000000000002'',''a'',null,false),(81,''00000000-0000-0000-0000-000000000002'',''a'',2,true),(82,''00000000-0000-0000-0000-000000000002'',''a'',21,true)',item.t,item.fk);
  end loop;
end $$;
set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000002';
do $$ declare item record; begin
  for item in select * from (values ('order_items','order_id'),('quotation_items','quotation_id'),('purchase_order_items','po_id'),('po_payments','po_id')) c(t,fk) loop
    -- Baseline proof: a staff member cannot read the other author's private
    -- header, but can inject both private- and cross-workspace children.
    execute format('insert into %I(id,%I) values(90,2),(91,21)',item.t,item.fk);
    execute format('delete from %I where id in (90,91)',item.t);
  end loop;
  if exists(select 1 from quotations where id=2) then raise exception 'Fixture private parent was visible'; end if;
end $$;
reset role;
select 'PASS: baseline staff direct writes inject foreign-author and foreign-org child rows.';
