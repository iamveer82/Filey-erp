create sequence fixture_document_ids start 1000;
grant usage on sequence fixture_document_ids to authenticated;
do $$ declare t text; begin
  foreach t in array array['invoice_docs','invoice_doc_items','quotations','quotation_items','purchase_orders','purchase_order_items'] loop
    execute format('alter table %I alter column id set default nextval(''fixture_document_ids'')',t);
  end loop;
  foreach t in array array['invoice_docs','quotations','purchase_orders'] loop
    execute format('alter table %I add column status text not null default ''draft'', add column notes text, add column currency text default ''AED''',t);
  end loop;
  foreach t in array array['invoice_doc_items','quotation_items','purchase_order_items'] loop
    execute format('alter table %I add column position bigint not null default 0',t);
  end loop;
end $$;
alter table invoice_docs add column einvoice jsonb;
alter table invoice_docs add column doc_type text default 'sale';
-- These focused fixtures already stub Auth/workspace helpers. The complete
-- bootstrap suite below exercises the actual module/membership definitions.
create function public.filey_is_workspace_member(p_org text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from org_members where org_id=p_org and user_id=auth.uid()) $$;
create function public.filey_can_use(p_module text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.filey_is_workspace_member(public.current_org()) $$;
alter table invoice_doc_items add column description text,add column qty numeric,add column unit_price numeric,add column tax_category text;
alter table quotation_items add column product text,add column qty numeric,add column rate numeric;
alter table purchase_order_items add column description text,add column quantity numeric,add column unit_cost numeric;
