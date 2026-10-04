set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000002';
do $$ declare item record; n bigint; denied boolean; parent_id bigint; begin
  for item in select * from (values ('order_items','orders','order_id'),('quotation_items','quotations','quotation_id'),('purchase_order_items','purchase_orders','po_id'),('po_payments','purchase_orders','po_id')) c(t,parent,fk) loop
    execute format('select count(*) from %I where id in (2,3,81,82)',item.t) into n;
    if n<>0 then raise exception 'Private/foreign parent children leaked: %',item.t; end if;
    execute format('select count(*) from %I where id in (1,80)',item.t) into n;
    if n<>2 then raise exception 'Shared parent/own unattached child unreadable: %',item.t; end if;
    foreach parent_id in array array[1,2,21] loop
      denied:=false;
      begin execute format('insert into %I(id,%I) values(90,$1)',item.t,item.fk) using parent_id;
      exception when insufficient_privilege then denied:=true; end;
      if not denied then raise exception 'Injected line into shared/private/foreign parent: %, %',item.t,parent_id; end if;
    end loop;
    execute format('update %I set name=''tampered'' where id in (1,81,82)',item.t);
    get diagnostics n=row_count;
    if n<>0 then raise exception 'Recipient modified foreign-author line: %',item.t; end if;
    execute format('delete from %I where id in (1,81,82)',item.t);
    get diagnostics n=row_count;
    if n<>0 then raise exception 'Recipient deleted foreign-author line: %',item.t; end if;
    denied:=false;
    begin execute format('update %I set %I=1 where id=80',item.t,item.fk);
    exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'Owner reparented unattached row to another author: %',item.t; end if;
    execute format('update %I set name=''own unattached'' where id=80',item.t);
    get diagnostics n=row_count;
    if n<>1 then raise exception 'Unattached owner edit broken: %',item.t; end if;
  end loop;
end $$;
-- Parent author can add/edit their own child, including private documents.
set test.uid='00000000-0000-0000-0000-000000000001';
do $$ declare item record; n bigint; denied boolean; begin
  for item in select * from (values ('order_items','order_id'),('quotation_items','quotation_id'),('purchase_order_items','po_id'),('po_payments','po_id')) c(t,fk) loop
    execute format('insert into %I(id,%I) values(92,2)',item.t,item.fk);
    execute format('update %I set name=''private own'' where id=92',item.t);
    get diagnostics n=row_count;
    if n<>1 then raise exception 'Author child edit failed: %',item.t; end if;
    denied:=false;
    begin execute format('update %I set %I=21 where id=92',item.t,item.fk);
    exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'Author reparented child to foreign organization: %',item.t; end if;
  end loop;
end $$;
-- Current admin can maintain member-owned parents. Foreign admin cannot.
set test.uid='00000000-0000-0000-0000-000000000004';
insert into quotation_items(id,quotation_id) values(93,2);
update quotation_items set name='admin repaired' where id=81;
do $$ begin if not exists(select 1 from quotation_items where id=81 and name='admin repaired') then raise exception 'Admin repair failed'; end if; end $$;
set test.uid='00000000-0000-0000-0000-000000000005';
do $$ declare n bigint; denied boolean:=false; begin
  select count(*) into n from quotation_items where id in (1,2,81,82,92,93);
  if n<>0 then raise exception 'Foreign admin saw child rows'; end if;
  begin insert into quotation_items(id,quotation_id) values(94,2);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Foreign admin injected child'; end if;
end $$;
reset role;
-- Existing restrictive module gates must continue to intersect parent access.
create policy fixture_parent_module on quotations as restrictive for all to authenticated
  using(auth.uid()<>'00000000-0000-0000-0000-000000000002')
  with check(auth.uid()<>'00000000-0000-0000-0000-000000000002');
set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000002';
do $$ begin if exists(select 1 from quotation_items where id=1) then raise exception 'Child bypassed parent module gate'; end if; end $$;
reset role;
select 'PASS: child parent visibility/author/admin/foreign-org/edit/reparent/delete/legacy/module guards and repeated migration.';
