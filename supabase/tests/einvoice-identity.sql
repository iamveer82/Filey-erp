-- Synthetic records only, run by test-channel-agent-local.mjs.
do $$ declare
  doc_id bigint; failed boolean; saved jsonb;
begin
  if (select count(*) from information_schema.columns where table_schema='public'
    and table_name in ('invoice_docs','company_profile') and column_name='einvoice' and data_type='jsonb')<>2 then
    raise exception 'E-invoice identity columns missing';
  end if;
  insert into invoice_docs(number,einvoice) values('IDENTITY-TEST','{"uuid":"stable-document-id","buyer":{"name":"Before"}}') returning id into doc_id;
  update invoice_docs set einvoice='{"uuid":"stale-client-id","buyer":{"name":"After"}}' where id=doc_id;
  select einvoice into saved from invoice_docs where id=doc_id;
  if saved->>'uuid'<>'stable-document-id' or saved#>>'{buyer,name}'<>'After' then
    raise exception 'Stale client replaced document identity or normal changes were lost';
  end if;
  update invoice_docs set einvoice=null where id=doc_id;
  if (select einvoice from invoice_docs where id=doc_id) is distinct from saved then
    raise exception 'Legacy client removed document identity';
  end if;
  failed := false;
  begin
    update invoice_docs set einvoice='[]' where id=doc_id;
  exception when raise_exception then failed := true; end;
  if not failed then raise exception 'Invalid identity JSON accepted'; end if;
  delete from invoice_docs where id=doc_id;
  raise notice 'PASS: repeatable identity fields preserve a document UUID through stale updates while allowing normal metadata edits.';
end $$;
