alter table invoice_docs add column einvoice jsonb, add column doc_type text default 'invoice';
create function public.filey_is_workspace_member(p_org text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from org_members where org_id=p_org and user_id=auth.uid())
$$;
create function public.filey_mfa_allowed() returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('test.mfa',true),''),'true')::boolean
$$;
create function public.filey_can_use(p_module text) returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('test.module_allowed',true),''),'true')::boolean
$$;
do $$ declare t text; begin
  foreach t in array array['invoice_docs','quotations','purchase_orders','payment_receipts'] loop
    execute format('alter table %I add column if not exists stamp jsonb',t);
    execute format('alter table %I add column signature jsonb, add column logo text, add column show_stamp boolean default false, add column show_signature boolean default false, add column show_logo boolean default false, add column show_bank boolean default false, add column private_future_column text default ''PRIVATE-NOT-FOR-CUSTOMERS''',t);
    execute format('update %I set stamp=$1,signature=$2,logo=''PRIVATE-LOGO''',t)
      using '{"data":"data:image/png;base64,PRIVATE_STAMP_FIXTURE"}'::jsonb,'{"data":"data:image/png;base64,PRIVATE_SIGNATURE_FIXTURE"}'::jsonb;
    execute format('insert into %I(id,user_id,org_id) values(4,''00000000-0000-0000-0000-000000000005'',''b'')',t);
  end loop;
end $$;
update invoice_docs set einvoice='{"uuid":"b8ee168c-60aa-4cbe-920c-51df95a5d112","seller":{"tin":"1234567890","private_future_column":"SECRET"},"private_future_column":"SECRET"}';
create table public.fixture_public_links(kind text primary key,old_token uuid,new_token uuid);
insert into fixture_public_links(kind,old_token) select 'invoice',share_token from invoice_docs where id=1
  union all select 'quotation',share_token from quotations where id=1
  union all select 'purchase_order',share_token from purchase_orders where id=1
  union all select 'receipt',share_token from payment_receipts where id=1;
grant select,update on fixture_public_links to authenticated;
grant select on fixture_public_links to anon;
