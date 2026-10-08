-- Disposable full-schema fixture; neither customer data nor deployed roles.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('bc000000-0000-4000-8000-000000000001','supplier-owner@example.invalid',now()),
 ('bc000000-0000-4000-8000-000000000002','supplier-other@example.invalid',now());
set local role authenticated;
set local request.jwt.claim.sub='bc000000-0000-4000-8000-000000000001';
set local request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
insert into suppliers(id,name,notes,bank_details) values(980801,'Existing supplier','Keep original notes','{"iban":"KEEP-ORIGINAL"}');
reset role;
create temp table supplier_before as select to_jsonb(s)-'custom_fields' as saved from suppliers s where id=980801;
create temp table supplier_authority_before as select relowner,relacl,relrowsecurity,
 (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public' and tablename='suppliers') as policies,
 (select jsonb_agg(pg_get_triggerdef(t.oid) order by tgname) from pg_trigger t where tgrelid=c.oid) as triggers
 from pg_class c where oid='public.suppliers'::regclass;
-- Reconstruct the old column layout only within this rolled-back fixture.
alter table suppliers drop column custom_fields;
-- APPLY SUPPLIER UPGRADE
do $$ begin
 if (select to_jsonb(s)-'custom_fields' from suppliers s where id=980801)<>(select saved from supplier_before) then
  raise exception 'Supplier upgrade changed an existing record'; end if;
 if not exists(select 1 from pg_attribute where attrelid='public.suppliers'::regclass and attname='custom_fields' and atttypid='jsonb'::regtype and not attnotnull and not attisdropped) then
  raise exception 'Optional supplier metadata column missing'; end if;
 if exists(select 1 from supplier_authority_before b join pg_class c on c.oid='public.suppliers'::regclass
  where b.relowner<>c.relowner or b.relacl is distinct from c.relacl or b.relrowsecurity<>c.relrowsecurity
   or b.policies is distinct from (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public' and tablename='suppliers')
   or b.triggers is distinct from (select jsonb_agg(pg_get_triggerdef(t.oid) order by tgname) from pg_trigger t where tgrelid=c.oid)) then
  raise exception 'Supplier upgrade changed authority or triggers'; end if;
end $$;
set local role authenticated;
update suppliers set custom_fields='{"city":"Dubai","country_code":"AE","country_subdivision":"DU","einvoice_identity":"{\"tin\":\"1234567890\",\"endpoint_id\":\"1234567890\"}"}' where id=980801;
insert into suppliers(id,name) values(980802,'Name only is allowed');
do $$ begin
 if (select custom_fields->>'city' from suppliers where id=980801)<>'Dubai'
  or (select custom_fields->>'einvoice_identity' from suppliers where id=980801)::jsonb->>'tin'<>'1234567890' then
  raise exception 'Authenticated supplier details did not persist'; end if;
 if not exists(select 1 from suppliers where id=980802 and custom_fields='{}') then
  raise exception 'Blank optional supplier details blocked creation'; end if;
end $$;
set local request.jwt.claim.sub='bc000000-0000-4000-8000-000000000002';
do $$ declare affected integer; begin
 if exists(select 1 from suppliers where id in(980801,980802)) then raise exception 'Other workspace could read supplier metadata'; end if;
 update suppliers set custom_fields='{"city":"UNAUTHORIZED"}' where id=980801;
 get diagnostics affected=row_count;
 if affected<>0 then raise exception 'Other workspace could change supplier metadata'; end if;
end $$;
set local request.jwt.claim.sub='bc000000-0000-4000-8000-000000000001';
update suppliers set custom_fields='{}' where id=980801;
do $$ begin
 if not exists(select 1 from suppliers where id=980801 and custom_fields='{}' and notes='Keep original notes' and bank_details->>'iban'='KEEP-ORIGINAL') then
  raise exception 'Clearing optional details changed existing supplier data'; end if;
end $$;
rollback;
select 'PASS: supplier metadata upgrade is repeatable, preserves saved rows and RLS/ACL/triggers; optional authenticated CRUD is isolated between workspaces.';
