do $$ declare t text; begin
  foreach t in array array['products','invoice_docs','invoice_doc_items','invoice_payments','app_settings','company_profile'] loop
    execute format('create trigger force_org before insert or update on %I for each row execute function force_org_id()',t);
  end loop;
  assert (select org_id from products where id=1)='10000000-0000-0000-0000-000000000002','Installing the migration must not move records';
end $$;
set role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
do $$ declare source text; result jsonb; begin
  assert (select count(*) from app_settings)=0,'Legacy settings must start hidden by RLS';
  foreach source in array array[
    '10000000-0000-0000-0000-000000000003', -- other owner
    '10000000-0000-0000-0000-000000000004', -- active profile
    '10000000-0000-0000-0000-000000000005', -- another member
    'default'] loop
    begin
      perform filey_prepare_workspace_sync(array['10000000-0000-0000-0000-000000000002',source]);
      raise exception 'Unsafe recovery was accepted';
    exception when insufficient_privilege then null;
    end;
  end loop;
  assert (select count(*) from app_settings)=0,'A rejected batch must move nothing';
  result := filey_prepare_workspace_sync(array['10000000-0000-0000-0000-000000000002']);
  assert result->>'org_id'=current_org();
  assert (select count(*) from products)=2,'Only caller-owned rows can move';
  assert (select value from app_settings where id=40)='data:image/png;base64,unchanged';
  assert (select sync_revision from app_settings where id=40)=2,'Recovery must invalidate other device caches';
  assert (select count(*) from company_profile)=1,'Active company profile stays a singleton';
  assert (select count(*) from invoice_doc_items)=2,'Linked and unlinked rows are preserved';
  assert (select invoice_id from invoice_doc_items where id=20)=10,'No relationship is rewritten';
  perform filey_prepare_workspace_sync(array['10000000-0000-0000-0000-000000000002']);
  assert (select sync_revision from app_settings where id=40)=2,'Recovery retry is idempotent';
  result := sync_record('invoice_payments','{"id":23,"invoice_id":null,"name":"offline orphan"}',null);
  assert (result->>'ok')::boolean,'Nullable owner data must back up';
  result := sync_record('app_settings','{"id":40,"value":"local wins"}',2);
  assert (result->>'ok')::boolean,'Recovered settings can use revision-checked local choice';
  result := sync_record('app_settings','{"id":40,"value":"stale write"}',2);
  assert (result->>'conflict')::boolean,'A newer edit remains protected';
  update products set org_id='10000000-0000-0000-0000-000000000003' where id=1;
  assert (select org_id from products where id=1)=current_org(),'Normal cross-tenant injection stays pinned';
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000004',false);
do $$ begin
  assert (select count(*) from invoice_payments)=0,'Teammates cannot read another owner''s orphans';
  begin
    perform sync_record('invoice_doc_items','{"id":24,"invoice_id":10,"name":"injected"}',null);
    raise exception 'Shared/hidden parent write was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select org_id from products where id=2)='10000000-0000-0000-0000-000000000002','Other-owner row must remain untouched';
  assert (select name from company_profile where id=50)='Archived','Archived profile must not be deleted';
  assert (select count(*) from invoice_doc_items)=2,'No invented child records';
end $$;
select 'PASS: explicit workspace recovery, ownership/membership guards, image preservation, nullable links, revision conflicts and idempotent retries.';
