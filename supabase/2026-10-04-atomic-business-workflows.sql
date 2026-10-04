-- Document, stock, ledger, credit allocation and receipt are one transaction.
-- Dispatchers run under a nonowner, nonbypass role inheriting ordinary RLS.
-- Invoker helpers retain record/module policies; no service-role shortcut.
begin;
-- The dispatcher owns neither business tables nor an RLS bypass. Inheriting
-- authenticated makes existing TO authenticated policies apply to its calls.
-- Clients are never members of this narrowly privileged execution role.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='filey_workflow_executor') then
    create role filey_workflow_executor nologin nosuperuser nobypassrls inherit;
  end if;
  if exists(select 1 from pg_roles where rolname='filey_workflow_executor' and
      (rolcanlogin or rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication))
    or pg_has_role('authenticated','filey_workflow_executor','MEMBER')
    or pg_has_role('anon','filey_workflow_executor','MEMBER')
    or pg_has_role('service_role','filey_workflow_executor','MEMBER') then
    raise exception 'The workflow execution role must be nonlogin/nonbypass and unavailable to client roles.';
  end if;
end $$;
grant authenticated to filey_workflow_executor;
grant filey_workflow_executor to postgres;
-- ALTER FUNCTION OWNER requires CREATE for the new owner when the installer
-- is not a superuser (as on managed Postgres). It is revoked before commit.
grant usage,create on schema public to filey_workflow_executor;
alter table public.transactions add column if not exists po_id bigint;
alter table public.transactions add column if not exists workflow_payment_id bigint;
alter table public.transactions add column if not exists advance_id bigint;
alter table public.stock_movements add column if not exists workflow_kind text;
alter table public.stock_movements add column if not exists workflow_id bigint;
alter table public.stock_movements add column if not exists cost_before numeric;
alter table public.orders add column if not exists invoice_id bigint;
alter table public.invoice_docs add column if not exists order_id bigint;
alter table public.advances add column if not exists accounting_posted boolean not null default false;
create index if not exists transactions_po_workflow on public.transactions(po_id,workflow_payment_id);
create index if not exists stock_movement_workflow on public.stock_movements(workflow_kind,workflow_id);
create index if not exists orders_invoice_workflow on public.orders(invoice_id);

create table if not exists public.business_workflow_requests (
  user_id uuid not null default auth.uid(), org_id text not null default public.current_org(),
  request_id uuid not null, action text not null, payload jsonb not null, result jsonb not null,
  created_at timestamptz not null default now(), primary key(user_id,org_id,request_id)
);
alter table public.business_workflow_requests enable row level security;
revoke all on public.business_workflow_requests from public,anon,authenticated;
grant select on public.business_workflow_requests to authenticated;
grant select,insert on public.business_workflow_requests to filey_workflow_executor;
grant all on public.business_workflow_requests to service_role;
drop policy if exists business_workflow_owner on public.business_workflow_requests;
create policy business_workflow_owner on public.business_workflow_requests for select to authenticated
  using(user_id=auth.uid() and org_id=public.current_org() and public.filey_is_workspace_member(org_id));
drop policy if exists business_workflow_insert on public.business_workflow_requests;
create policy business_workflow_insert on public.business_workflow_requests for insert to authenticated
  with check(user_id=auth.uid() and org_id=public.current_org() and public.filey_is_workspace_member(org_id)
    and length(action)<=64 and jsonb_typeof(payload)='object' and jsonb_typeof(result)='object'
    and octet_length(payload::text)<=8388608 and octet_length(result::text)<=2048);

create or replace function public.filey_workflow_guard(p_actor uuid,p_org text,p_module text) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or auth.uid() is distinct from p_actor or public.current_org() is distinct from p_org
    or not public.filey_is_workspace_member(p_org) or not public.filey_can_use(p_module) then
    raise exception 'Your account or workspace changed. Reopen this document.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org||':business-workflows',0));
end $$;
create or replace function public.filey_workflow_round(p_value numeric) returns numeric
language sql immutable as $$ select floor((p_value+0.0000000000000002)*100+0.5)/100 $$;
create or replace function public.filey_workflow_number(p_value text) returns numeric
language plpgsql immutable as $$
declare v text;
begin
  v:=substring(btrim(coalesce(p_value,'')) from '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?');
  if v is null then return 0; end if;
  if length(v)>100 then raise exception 'Item number is outside the valid range.' using errcode='22023'; end if;
  return v::numeric;
end $$;
create or replace function public.filey_workflow_totals(p_doc jsonb,p_items jsonb,p_purchase boolean default false)
returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare
  v_item jsonb; v_custom jsonb; v_i int:=0; v_qty numeric; v_price numeric; v_gross numeric; v_net numeric;
  v_pct numeric; v_rate numeric; v_key text; v_cat text; v_multiplier text; v_lines jsonb:='[]';
  v_subtotal numeric:=0; v_discount numeric; v_tax numeric:=0; v_total numeric; v_sum numeric:=0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>500 then
    raise exception 'A document supports at most 500 valid item rows.' using errcode='22023';
  end if;
  foreach v_key in array array['discount','tax_rate'] loop
    if public.filey_workflow_number(p_doc->>v_key)<0 then raise exception 'Discount and tax cannot be negative.' using errcode='22023'; end if;
  end loop;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) is distinct from 'object' then raise exception 'Invalid item row.' using errcode='22023'; end if;
    v_i:=v_i+1; v_custom:=coalesce(v_item->'custom','{}'::jsonb);
    v_qty:=public.filey_workflow_number(v_item->>case when p_purchase then 'quantity' else 'qty' end);
    v_price:=public.filey_workflow_number(v_item->>case when p_purchase then 'unit_cost' else 'unit_price' end);
    if least(v_qty,v_price)<0 or greatest(v_qty,v_price)>=1000000000000 then raise exception 'Enter valid non-negative quantities and prices.' using errcode='22023'; end if;
    v_multiplier:=coalesce(case when v_custom->>'__calc_mode'='formula' then nullif(v_custom->>'__formula_a','') end,nullif(p_doc->'unit_price_formula'->>'a',''),'qty');
    if v_custom->>'__calc_mode'='manual' then v_gross:=public.filey_workflow_number(v_custom->>'__manual_amount');
    else
      v_gross:=public.filey_workflow_round((case when v_multiplier='qty' then v_qty else public.filey_workflow_number(v_custom->>v_multiplier) end)*v_price);
    end if;
    v_pct:=public.filey_workflow_number(v_custom->>'__disc_pct');
    v_rate:=public.filey_workflow_number(v_custom->>'__tax_pct');
    if least(v_gross,v_pct,v_rate)<0 or greatest(v_pct,v_rate)>100 or v_gross>=100000000000000 then
      raise exception 'Enter valid item amounts, discounts and tax percentages.' using errcode='22023';
    end if;
    v_net:=public.filey_workflow_round(v_gross*(1-v_pct/100));
    v_subtotal:=v_subtotal+public.filey_workflow_round(v_gross);
    v_cat:=coalesce(nullif(v_item->>'tax_category',''),'S');
    if v_cat not in ('S','Z','E','O','AE') then raise exception 'Choose a supported tax category.' using errcode='22023'; end if;
    v_rate:=case when v_cat='S' then case when v_rate<>0 then v_rate else public.filey_workflow_number(p_doc->>'tax_rate') end else 0 end;
    if v_rate>100 then raise exception 'Tax rate cannot exceed 100 percent.' using errcode='22023'; end if;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('category',v_cat,'rate',v_rate,'cents',floor(v_net*100+0.5),'position',v_i));
  end loop;
  select coalesce(sum((value->>'cents')::numeric),0) into v_sum from jsonb_array_elements(v_lines);
  v_discount:=least(greatest(0,floor(public.filey_workflow_number(p_doc->>'discount')*100+0.5)),v_sum);
  -- Allocate document discount by largest remainder. Ties follow the first
  -- appearance of a tax group, exactly as the shared preview/PDF calculator.
  with groups as (
    select value->>'category' category,(value->>'rate')::numeric rate,sum((value->>'cents')::numeric) cents,
      min((value->>'position')::int) position from jsonb_array_elements(v_lines) group by 1,2
  ), shares as (
    select *,case when v_sum>0 then v_discount*cents/v_sum else 0 end exact from groups
  ), ranked as (
    select *,floor(exact) base,row_number() over(order by exact-floor(exact) desc,position) rank,
      v_discount-sum(floor(exact)) over() remainder from shares
  ) select coalesce(sum(public.filey_workflow_round(((cents-base-case when rank<=remainder then 1 else 0 end)/100)*rate/100)),0)
    into v_tax from ranked;
  v_net:=(v_sum-v_discount)/100;
  v_total:=public.filey_workflow_round(v_net+v_tax);
  if not p_purchase and coalesce((p_doc->>'round_off')::boolean,false) then v_total:=floor(v_total+0.5); end if;
  return jsonb_build_object('subtotal',v_subtotal,'net',public.filey_workflow_round(v_total-v_tax),'tax',v_tax,'total',v_total);
end $$;

create or replace function public.filey_workflow_fx(p_doc jsonb,p_rates jsonb default '{}') returns numeric
language plpgsql immutable as $$
declare v_currency text:=upper(coalesce(nullif(p_doc->>'currency',''),'AED')); v_fx numeric;
begin
  if v_currency='AED' then return 1; end if;
  v_fx:=coalesce(nullif(p_doc->>'fx_rate','')::numeric,nullif(p_rates->>v_currency,'')::numeric);
  if v_currency !~ '^[A-Z]{3}$' or v_fx is null or v_fx::text in ('NaN','Infinity','-Infinity') or v_fx<=0 or v_fx>1000000 then
    raise exception 'Set a valid exchange rate before posting this currency.' using errcode='22023';
  end if;
  return v_fx;
end $$;
-- Admin edits keep generated accounts and effects under the document author.
create or replace function public.filey_workflow_account_for_owner(p_type text,p_code text,p_name text,p_pattern text,p_owner uuid) returns bigint
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_id bigint;
begin
  if not public.filey_can_use('accounting') or p_owner is null or not (p_owner=auth.uid() or public.is_org_admin()) then raise exception 'Accounting access is required to post this document.' using errcode='42501'; end if;
  select id into v_id from public.accounts where org_id=public.current_org() and account_type=p_type
    and user_id=p_owner and name ~* p_pattern order by id limit 1;
  if v_id is null then insert into public.accounts(code,name,account_type,balance,user_id) values(p_code,p_name,p_type,0,p_owner) returning id into v_id; end if;
  return v_id;
end $$;
create or replace function public.filey_workflow_account(p_type text,p_code text,p_name text,p_pattern text) returns bigint
language plpgsql security invoker set search_path=public,pg_temp as $$
begin return public.filey_workflow_account_for_owner(p_type,p_code,p_name,p_pattern,auth.uid()); end $$;
create or replace function public.filey_workflow_entry(p_account bigint,p_side text,p_amount numeric,p_description text,p_ref text,p_source text,p_date date,
  p_invoice bigint default null,p_po bigint default null,p_payment bigint default null) returns bigint
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_type text; v_id bigint; v_changed bigint; v_delta numeric; v_owner uuid;
begin
  p_amount:=public.filey_workflow_round(p_amount);
  if p_amount=0 then return null; end if;
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<0 or p_amount>=100000000000000
    or p_side not in ('debit','credit') or p_date is null then raise exception 'Invalid accounting entry.' using errcode='22023'; end if;
  select account_type,user_id into v_type,v_owner from public.accounts where id=p_account and org_id=public.current_org()
    and (user_id=auth.uid() or public.is_org_admin()) for update;
  if not found then raise exception 'Account not found or posting denied.' using errcode='42501'; end if;
  v_delta:=p_amount*case when (v_type in ('asset','expense'))=(p_side='debit') then 1 else -1 end;
  insert into public.transactions(account_id,txn_type,amount,description,ref,source,txn_date,invoice_id,po_id,workflow_payment_id,user_id)
    values(p_account,p_side,p_amount,p_description,p_ref,p_source,p_date,p_invoice,p_po,p_payment,v_owner) returning id into v_id;
  update public.accounts set balance=balance+v_delta where id=p_account returning id into v_changed;
  if v_changed is null then raise exception 'Account update denied.' using errcode='42501'; end if;
  return v_id;
end $$;
create or replace function public.filey_workflow_reverse(p_ids bigint[]) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_row record; v_type text; v_changed bigint;
begin
  for v_row in select * from public.transactions where id=any(p_ids) order by account_id,id for update loop
    select account_type into v_type from public.accounts where id=v_row.account_id and org_id=public.current_org()
      and (user_id=auth.uid() or public.is_org_admin()) for update;
    if not found then raise exception 'Account not found or reversal denied.' using errcode='42501'; end if;
    update public.accounts set balance=balance-v_row.amount*case when (v_type in ('asset','expense'))=(v_row.txn_type='debit') then 1 else -1 end
      where id=v_row.account_id returning id into v_changed;
    if v_changed is null then raise exception 'Account reversal denied.' using errcode='42501'; end if;
    delete from public.transactions where id=v_row.id returning id into v_changed;
    if v_changed is null then raise exception 'Ledger reversal denied.' using errcode='42501'; end if;
  end loop;
end $$;
create or replace function public.filey_workflow_stock(p_product bigint,p_delta numeric,p_kind text,p_id bigint,p_ref text,p_cost numeric default null) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_quantity numeric; v_cost numeric; v_before numeric; v_changed bigint; v_owner uuid; v_product_owner uuid;
begin
  if p_product is null or p_delta=0 then return; end if;
  if not public.filey_can_use('inventory') then raise exception 'Inventory access is required for stock-linked items.' using errcode='42501'; end if;
  select quantity,cost_price,user_id into v_quantity,v_cost,v_product_owner from public.products where id=p_product and org_id=public.current_org()
    and (user_id=auth.uid() or public.is_org_admin()) for update;
  if not found then raise exception 'Product not found or stock update denied.' using errcode='42501'; end if;
  if p_kind='invoice' then select user_id into v_owner from public.invoice_docs where id=p_id and org_id=public.current_org() and (user_id=auth.uid() or public.is_org_admin());
  elsif p_kind='po' then select user_id into v_owner from public.purchase_orders where id=p_id and org_id=public.current_org() and (user_id=auth.uid() or public.is_org_admin());
  elsif p_kind='order' then select user_id into v_owner from public.orders where id=p_id and org_id=public.current_org() and (user_id=auth.uid() or public.is_org_admin());
  else raise exception 'Invalid stock document.' using errcode='22023'; end if;
  if v_owner is null or v_product_owner is distinct from v_owner then raise exception 'Choose stock owned by this document author so its reservation remains reversible.' using errcode='42501'; end if;
  v_before:=v_cost;
  if p_delta>0 and p_cost>0 then
    v_cost:=public.filey_workflow_round(case when v_quantity>0 and v_cost>0 then (v_quantity*v_cost+p_delta*p_cost)/(v_quantity+p_delta) else p_cost end);
  end if;
  update public.products set quantity=quantity+p_delta,cost_price=v_cost where id=p_product returning id into v_changed;
  if v_changed is null then raise exception 'Stock update denied.' using errcode='42501'; end if;
  insert into public.stock_movements(product_id,qty,type,ref,note,workflow_kind,workflow_id,cost_before,user_id)
    values(p_product,p_delta,case when p_kind='order' then 'order' when p_delta>0 then 'purchase' else 'sale' end,p_ref,null,p_kind,p_id,case when p_delta>0 and p_cost is not null then v_before end,v_owner);
end $$;

-- Undo exactly this document's stock, including prior reversals. Historic
-- records have no IDs in the journal: only an unambiguous same-author reference
-- is eligible for legacy recovery; otherwise require reconciliation.
-- Historic admin-owned later movements can be invisible under staff RLS.
-- This returns only a permission-scoped yes/no and never private journal data.
create or replace function public.filey_workflow_receipt_reversible(p_kind text,p_id bigint,p_product bigint) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_first bigint;
begin
  if p_kind not in ('invoice','po') or not public.filey_workflow_effects_owned(p_kind,p_id,public.current_org()) or not public.filey_can_use('inventory') then return false; end if;
  select min(id) into v_first from public.stock_movements where org_id=public.current_org() and product_id=p_product
    and workflow_kind=p_kind and workflow_id=p_id and qty>0 and cost_before is not null;
  if v_first is null then return false; end if;
  return not exists(select 1 from public.stock_movements where product_id=p_product and id>v_first and qty<>0
    and (workflow_kind is distinct from p_kind or workflow_id is distinct from p_id));
end $$;
create or replace function public.filey_workflow_unstock(p_kind text,p_id bigint,p_ref text,p_owner uuid,p_items jsonb,p_legacy boolean,p_purchase boolean) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_row record; v_found boolean:=false; v_ambiguous boolean; v_first bigint; v_cost numeric;
begin
  for v_row in select product_id,sum(qty) qty from public.stock_movements where org_id=public.current_org()
    and workflow_kind=p_kind and workflow_id=p_id group by product_id loop
    v_found:=true;
    if p_purchase and v_row.qty>0 then
      select id,cost_before into v_first,v_cost from public.stock_movements where org_id=public.current_org() and product_id=v_row.product_id
        and workflow_kind=p_kind and workflow_id=p_id and qty>0 and cost_before is not null order by id limit 1;
      if v_first is null then raise exception 'This historic receipt needs cost reconciliation before reversal.' using errcode='22023'; end if;
      if not public.filey_workflow_receipt_reversible(p_kind,p_id,v_row.product_id) then raise exception 'Later stock movements use this receipt''s cost. Reconcile them before reversing it.' using errcode='22023'; end if;
      update public.products set cost_price=v_cost where id=v_row.product_id;
    end if;
    perform public.filey_workflow_stock(v_row.product_id,-v_row.qty,p_kind,p_id,p_ref);
  end loop;
  if v_found or not p_legacy then return; end if;
  if p_kind='invoice' then
    select count(*)>1 into v_ambiguous from public.invoice_docs where org_id=public.current_org() and user_id=p_owner
      and (case when doc_type='purchase' then 'Bill ' else 'Invoice ' end)||number=p_ref;
  else
    select count(*)>1 into v_ambiguous from public.purchase_orders where org_id=public.current_org() and user_id=p_owner and 'PO '||po_number=p_ref;
  end if;
  if p_purchase and exists(select 1 from jsonb_array_elements(p_items) where nullif(value->>'product_id','') is not null) then raise exception 'This historic receipt needs cost reconciliation before reversal.' using errcode='22023'; end if;
  if v_ambiguous then raise exception 'Historic document references overlap. Reconcile stock before changing this document.' using errcode='22023'; end if;
  for v_row in select product_id,sum(qty) qty from public.stock_movements where org_id=public.current_org()
    and user_id=p_owner and ref=p_ref and workflow_kind is null group by product_id loop
    v_found:=true;
    perform public.filey_workflow_stock(v_row.product_id,-v_row.qty,p_kind,p_id,p_ref);
    -- Attribute the old footprint after proving its reference unambiguous.
    update public.stock_movements set workflow_kind=p_kind,workflow_id=p_id
      where org_id=public.current_org() and user_id=p_owner and ref=p_ref and workflow_kind is null and product_id=v_row.product_id;
  end loop;
  if not v_found then
    for v_row in select value from jsonb_array_elements(p_items) loop
      perform public.filey_workflow_stock(nullif(v_row.value->>'product_id','')::bigint,
        abs(public.filey_workflow_number(v_row.value->>case when p_kind='po' then 'quantity' else 'qty' end))*case when p_purchase then -1 else 1 end,p_kind,p_id,p_ref);
    end loop;
    -- Missing historic journal: the reversal is an audited correction, but
    -- cannot represent a negative current footprint on the next edit.
    update public.stock_movements set workflow_kind='legacy-reversal' where workflow_kind=p_kind and workflow_id=p_id;
  end if;
end $$;

create or replace function public.filey_workflow_unpost(p_kind text,p_doc jsonb,p_items jsonb,p_delete boolean default false) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_id bigint:=(p_doc->>'id')::bigint; v_ref text; v_ids bigint[]; v_purchase boolean; v_posted boolean; v_owner uuid:=(p_doc->>'user_id')::uuid;
begin
  v_purchase:=p_kind='po' or coalesce(p_doc->>'doc_type'='purchase',false);
  v_posted:=case when p_kind='po' then p_doc->>'status' in ('received','completed') else p_doc->>'status' in ('sent','paid','overdue') end;
  v_ref:=case when p_kind='po' then 'PO '||(p_doc->>'po_number') when v_purchase then 'Bill '||(p_doc->>'number') else 'Invoice '||(p_doc->>'number') end;
  select array_agg(id) into v_ids from public.transactions where org_id=public.current_org() and (user_id=v_owner or public.is_org_admin())
    and (case when p_kind='po' then po_id=v_id or (po_id is null and invoice_id is null and ref=v_ref and user_id=v_owner)
      else invoice_id=v_id or (invoice_id is null and po_id is null and ref=v_ref and user_id=v_owner) end)
    and (p_delete or coalesce(source,'')<>'payment');
  if v_ids is not null and exists(select 1 from public.transactions where id=any(v_ids) and invoice_id is null and po_id is null) and
    (case when p_kind='po' then (select count(*) from public.purchase_orders where org_id=public.current_org() and user_id=v_owner and 'PO '||po_number=v_ref)
      else (select count(*) from public.invoice_docs where org_id=public.current_org() and user_id=v_owner and (case when doc_type='purchase' then 'Bill ' else 'Invoice ' end)||number=v_ref) end)>1 then
    raise exception 'Historic document references overlap. Reconcile the ledger before changing this document.' using errcode='22023';
  end if;
  perform public.filey_workflow_reverse(v_ids);
  if (v_posted or v_ids is not null or coalesce((p_doc->>'stock_received')::boolean,false))
    and not (p_kind='invoice' and coalesce(p_doc->>'invoice_type_code' in ('381','81'),false)) then
    perform public.filey_workflow_unstock(p_kind,v_id,v_ref,v_owner,p_items,
      case when p_kind='po' then coalesce((p_doc->>'stock_received')::boolean,false) else v_posted end,v_purchase);
  end if;
  if p_kind='po' then update public.purchase_orders set stock_received=false where id=v_id; end if;
  if p_kind='invoice' and not v_purchase then
    delete from public.orders where org_id=public.current_org() and (user_id=v_owner or public.is_org_admin()) and
      (invoice_id=v_id or (invoice_id is null and user_id=v_owner and order_number='SO-'||(p_doc->>'number')
        and not exists(select 1 from public.order_items oi where oi.order_id=orders.id)));
  end if;
end $$;

create or replace function public.filey_workflow_post(p_kind text,p_doc jsonb,p_items jsonb,p_rates jsonb default '{}') returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_id bigint:=(p_doc->>'id')::bigint; v_invoice bigint; v_po bigint; v_purchase boolean:=p_kind='po' or coalesce(p_doc->>'doc_type'='purchase',false);
  v_credit boolean:=p_kind='invoice' and coalesce(p_doc->>'invoice_type_code' in ('381','81'),false); v_totals jsonb; v_fx numeric;
  v_tax numeric; v_total numeric; v_net numeric; v_ref text; v_date date; v_source text; v_item jsonb;
  v_product bigint; v_qty numeric; v_cost numeric; v_cogs numeric:=0; v_target bigint; v_counter bigint;
begin
  if not public.filey_can_use('accounting') then raise exception 'Accounting access is required to post this document.' using errcode='42501'; end if;
  if v_credit and v_purchase then raise exception 'Keep supplier credit notes as drafts until supplier credit posting is available.' using errcode='22023'; end if;
  if v_credit and p_doc->'einvoice'->>'credit_reason' is distinct from 'VD'
    and (coalesce(p_doc->>'original_invoice_number','')='' or coalesce(p_doc->>'original_invoice_date','')='') then
    raise exception 'Add the original invoice number and date before posting a credit note.' using errcode='22023';
  end if;
  if coalesce(p_doc->>case when p_kind='po' then 'po_number' else 'number' end,'')='' then
    raise exception 'Add a document number before posting.' using errcode='22023';
  end if;
  v_fx:=public.filey_workflow_fx(p_doc,p_rates); v_totals:=public.filey_workflow_totals(p_doc,p_items,p_kind='po');
  v_total:=public.filey_workflow_round((v_totals->>'total')::numeric*v_fx);
  v_tax:=public.filey_workflow_round((v_totals->>'tax')::numeric*v_fx); v_net:=v_total-v_tax;
  if p_kind='po' then v_po:=v_id; else v_invoice:=v_id; end if;
  v_ref:=case when p_kind='po' then 'PO '||(p_doc->>'po_number') when v_purchase then 'Bill '||(p_doc->>'number') else 'Invoice '||(p_doc->>'number') end;
  v_source:=case when v_purchase then 'purchase_invoice' else 'invoice' end;
  v_date:=coalesce(nullif(p_doc->>case when p_kind='po' then 'order_date' else 'issue_date' end,'')::date,current_date);
  if not v_credit then
    for v_item in select value from jsonb_array_elements(p_items) loop
      v_product:=nullif(v_item->>'product_id','')::bigint; if v_product is null then continue; end if;
      v_qty:=abs(public.filey_workflow_number(v_item->>case when p_kind='po' then 'quantity' else 'qty' end));
      select cost_price into v_cost from public.products where id=v_product;
      if not found then raise exception 'Product not found or access denied.' using errcode='42501'; end if;
      v_cogs:=v_cogs+v_qty*v_cost;
      perform public.filey_workflow_stock(v_product,v_qty*case when v_purchase then 1 else -1 end,p_kind,v_id,v_ref,
        case when v_purchase then public.filey_workflow_number(v_item->>case when p_kind='po' then 'unit_cost' else 'unit_price' end)*v_fx else null end);
    end loop;
    if p_kind='po' then update public.purchase_orders set stock_received=true where id=v_id;
    elsif not v_purchase then
      insert into public.orders(order_number,customer_name,customer_id,status,total,invoice_id,user_id)
        values('SO-'||(p_doc->>'number'),coalesce(p_doc->>'customer_name',''),nullif(p_doc->>'customer_id','')::bigint,'completed',v_total,v_id,(p_doc->>'user_id')::uuid);
      if public.filey_workflow_round(v_cogs)>0 then
        v_target:=public.filey_workflow_account_for_owner('expense','5050','Cost of Goods Sold','cost of goods|cogs',(p_doc->>'user_id')::uuid);
        v_counter:=public.filey_workflow_account_for_owner('asset','1300','Inventory','inventory|stock',(p_doc->>'user_id')::uuid);
        perform public.filey_workflow_entry(v_target,'debit',v_cogs,v_ref||' — cost of goods sold',v_ref,'invoice',v_date,v_id);
        perform public.filey_workflow_entry(v_counter,'credit',v_cogs,v_ref||' — inventory issued',v_ref,'invoice',v_date,v_id);
      end if;
    end if;
  end if;
  if v_total=0 then return; end if;
  v_target:=case when v_purchase then public.filey_workflow_account_for_owner('asset','1300','Inventory','inventory|stock',(p_doc->>'user_id')::uuid)
    else public.filey_workflow_account_for_owner('revenue','4000','Sales Revenue','sales|revenue|income',(p_doc->>'user_id')::uuid) end;
  v_counter:=case when v_purchase then public.filey_workflow_account_for_owner('liability','2000','Accounts Payable','\m(payable|creditors|ap)\M',(p_doc->>'user_id')::uuid)
    else public.filey_workflow_account_for_owner('asset','1200','Accounts Receivable','\m(receivable|debtors|ar)\M',(p_doc->>'user_id')::uuid) end;
  perform public.filey_workflow_entry(v_target,case when v_purchase or v_credit then 'debit' else 'credit' end,v_net,v_ref,v_ref,v_source,v_date,v_invoice,v_po);
  perform public.filey_workflow_entry(v_counter,case when v_purchase or v_credit then 'credit' else 'debit' end,v_total,v_ref,v_ref,v_source,v_date,v_invoice,v_po);
  if v_tax>0 then
    v_target:=case when v_purchase then public.filey_workflow_account_for_owner('asset','1250','Input VAT','input vat|vat on purchases|purchase vat|vat recoverable',(p_doc->>'user_id')::uuid)
      else public.filey_workflow_account_for_owner('liability','2100','Output VAT','output vat|vat on sales|sales vat',(p_doc->>'user_id')::uuid) end;
    perform public.filey_workflow_entry(v_target,case when v_purchase or v_credit then 'debit' else 'credit' end,v_tax,v_ref||' — VAT',v_ref,v_source,v_date,v_invoice,v_po);
  end if;
end $$;

-- Boolean-only privileged pool check: staff cannot spend read-only shared
-- deposits or miss consumption hidden behind another invoice author. New
-- allocations always use the original invoice author's pool, even for admins.
create or replace function public.filey_workflow_credit_available(p_type text,p_party bigint,p_owner uuid,p_exclude text,p_need numeric) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_available numeric; v_org text:=public.current_org(); v_invoice bigint;
begin
  if auth.uid() is null or not public.filey_is_workspace_member(v_org) or not public.filey_can_use('invoicing') or not public.filey_can_use('people')
    or p_owner is null or not (p_owner=auth.uid() or public.is_org_admin()) or p_need is null or p_need<0 then return false; end if;
  if p_exclude is not null then
    if p_exclude !~ '^applied:inv#[0-9]+$' then return false; end if;
    v_invoice:=substring(p_exclude from '[0-9]+$')::bigint;
    if not exists(select 1 from public.invoice_docs where id=v_invoice and org_id=v_org and user_id=p_owner) then return false; end if;
  end if;
  -- Older admin-created allocations can have a different author from their
  -- parent. They cannot be attributed safely to a private pool automatically.
  if exists(select 1 from public.advances a left join public.invoice_docs d
    on a.note='applied:inv#'||d.id and d.org_id=a.org_id
    where a.org_id=v_org and a.party_type=p_type and a.party_id=p_party and a.amount<0
      and (d.id is null or d.user_id is distinct from a.user_id)) then return false; end if;
  -- Old shared-credit spending can have matching parent/allocation authors
  -- while borrowing another author's deposit. A negative private pool makes
  -- that attribution unsafe; no other intact-looking deposit can be reused.
  if exists(select 1 from public.advances where org_id=v_org and party_type=p_type and party_id=p_party
    group by user_id having sum(amount)<-0.005) then return false; end if;
  select coalesce(sum(amount),0) into v_available from public.advances where org_id=v_org
    and party_type=p_type and party_id=p_party and user_id=p_owner and (p_exclude is null or note is distinct from p_exclude);
  return p_need<=v_available+0.005;
end $$;
create or replace function public.filey_workflow_advance(p_doc jsonb,p_amount numeric,p_previous jsonb) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_id bigint:=(p_doc->>'id')::bigint; v_owner uuid:=(p_doc->>'user_id')::uuid; v_party bigint:=nullif(p_doc->>'customer_id','')::bigint;
  v_base numeric; v_tag text:='applied:inv#'||v_id; v_items jsonb; v_total numeric; v_ids bigint[]; v_liability bigint; v_ar bigint; v_retain boolean:=false;
begin
  if not (v_owner=auth.uid() or public.is_org_admin()) then raise exception 'Invoice allocation denied.' using errcode='42501'; end if;
  p_amount:=coalesce(p_amount,0);
  if (p_amount>0 or coalesce((p_previous->>'advance_applied')::numeric,0)>0) and not public.filey_can_use('people') then raise exception 'Advance access is required to change allocated credit.' using errcode='42501'; end if;
  if p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<0 then raise exception 'Enter a valid advance allocation.' using errcode='22023'; end if;
  if p_amount>0 and (v_party is null or p_doc->>'doc_type'='purchase' or p_doc->>'invoice_type_code' in ('381','81')) then
    raise exception 'Choose the customer before applying advance credit.' using errcode='22023'; end if;
  if p_amount>0 then
    v_base:=public.filey_workflow_round(p_amount*public.filey_workflow_fx(p_doc));
    select coalesce(jsonb_agg(to_jsonb(i)),'[]') into v_items from public.invoice_doc_items i where invoice_id=v_id;
    v_total:=(public.filey_workflow_totals(p_doc,v_items)->>'total')::numeric;
    if p_amount>v_total+0.005 then raise exception 'Advance allocation cannot exceed this invoice total.' using errcode='22023'; end if;
    perform 1 from public.crm_customers where id=v_party and org_id=public.current_org();
    if not found then raise exception 'Customer not found or access denied.' using errcode='42501'; end if;
    v_retain:=p_previous is not null and p_previous->>'customer_id' is not distinct from p_doc->>'customer_id'
      and coalesce(p_previous->>'currency','AED')=coalesce(p_doc->>'currency','AED')
      and p_previous->'fx_rate' is not distinct from p_doc->'fx_rate'
      and coalesce((p_previous->>'advance_applied')::numeric,0)=p_amount
      and exists(select 1 from public.advances where org_id=public.current_org() and user_id=v_owner
        and note=v_tag and party_type='customer' and party_id=v_party and amount=-v_base);
    if not v_retain and not public.filey_workflow_credit_available('customer',v_party,v_owner,v_tag,v_base) then
      raise exception 'Insufficient editable customer advance credit. Refresh the available balance or reconcile historic allocations.' using errcode='22023'; end if;
  end if;
  select array_agg(id) into v_ids from public.transactions where invoice_id=v_id and source='advance_allocation';
  perform public.filey_workflow_reverse(v_ids);
  if not v_retain then
    delete from public.advances where org_id=public.current_org() and user_id=v_owner and note=v_tag;
    if p_amount>0 then insert into public.advances(party_type,party_id,party_name,amount,note,user_id)
      values('customer',v_party,coalesce(p_doc->>'customer_name',''),-v_base,v_tag,v_owner); end if;
  end if;
  if p_amount>0 and p_doc->>'status' in ('sent','paid','overdue') then
    v_liability:=public.filey_workflow_account_for_owner('liability','2200','Customer Advances','customer advances|customer deposits',v_owner);
    v_ar:=public.filey_workflow_account_for_owner('asset','1200','Accounts Receivable','\m(receivable|debtors|ar)\M',v_owner);
    perform public.filey_workflow_entry(v_liability,'debit',v_base,'Customer advance applied',v_tag,'advance_allocation',coalesce(nullif(p_doc->>'issue_date','')::date,current_date),v_id);
    perform public.filey_workflow_entry(v_ar,'credit',v_base,'Customer advance applied — AR reduction',v_tag,'advance_allocation',coalesce(nullif(p_doc->>'issue_date','')::date,current_date),v_id);
  end if;
end $$;
-- Replace the historic two-argument signature too; upgrades leave no stale body.
create or replace function public.filey_workflow_advance(p_doc jsonb,p_amount numeric) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
begin perform public.filey_workflow_advance(p_doc,p_amount,null); end $$;
create or replace function public.filey_workflow_payment(p_kind text,p_doc jsonb,p_amount numeric,p_method text,p_date date,p_rates jsonb) returns bigint
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_id bigint:=(p_doc->>'id')::bigint; v_payment bigint; v_invoice bigint; v_po bigint;
  v_purchase boolean:=p_kind='po' or coalesce(p_doc->>'doc_type'='purchase',false); v_base numeric; v_spot numeric; v_diff numeric;
  v_cash bigint; v_counter bigint; v_fx bigint; v_ref text; v_total numeric; v_paid numeric; v_items jsonb;
begin
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount>=1000000000000
    or p_amount<>round(p_amount,2) or p_date is null or length(coalesce(p_method,''))>200 then raise exception 'Enter a positive payment amount with at most two decimals and a valid payment date.' using errcode='22023'; end if;
  if p_doc->>'invoice_type_code' in ('381','81') then raise exception 'Credit notes cannot receive invoice payments.' using errcode='22023'; end if;
  if (case when p_kind='po' then p_doc->>'status' not in ('received','completed') else p_doc->>'status' not in ('sent','paid','overdue') end) then
    raise exception 'Finalize or receive this document before recording a payment. Use a party advance for prepayments.' using errcode='22023'; end if;
  v_base:=public.filey_workflow_round(p_amount*public.filey_workflow_fx(p_doc,p_rates));
  v_spot:=public.filey_workflow_round(p_amount*public.filey_workflow_fx(p_doc||jsonb_build_object('fx_rate',null),
    p_rates||case when p_rates->>coalesce(p_doc->>'currency','AED') is null then jsonb_build_object(coalesce(p_doc->>'currency','AED'),public.filey_workflow_fx(p_doc,p_rates)) else '{}'::jsonb end));
  v_diff:=v_spot-v_base;
  if p_kind='po' then
    v_po:=v_id; insert into public.po_payments(po_id,amount,method,paid_at,user_id) values(v_id,p_amount,p_method,p_date,(p_doc->>'user_id')::uuid) returning id into v_payment;
  else
    v_invoice:=v_id; insert into public.invoice_payments(invoice_id,amount,method,paid_at,user_id) values(v_id,p_amount,p_method,p_date,(p_doc->>'user_id')::uuid) returning id into v_payment;
    select coalesce(jsonb_agg(to_jsonb(i) order by position,id),'[]') into v_items from public.invoice_doc_items i where invoice_id=v_id;
    v_total:=(public.filey_workflow_totals(p_doc,v_items)->>'total')::numeric;
    select coalesce(sum(amount),0) into v_paid from public.invoice_payments where invoice_id=v_id;
    update public.invoice_docs set status=case when v_paid+coalesce((p_doc->>'advance_applied')::numeric,0)>=v_total-0.005 then 'paid' when status='paid' then 'sent' else status end where id=v_id;
  end if;
  v_ref:=case when p_kind='po' then 'PO payment #' else 'Invoice payment #' end||v_payment;
  v_cash:=public.filey_workflow_account_for_owner('asset','1000','Cash & Bank','cash|bank',(p_doc->>'user_id')::uuid);
  v_counter:=case when v_purchase then public.filey_workflow_account_for_owner('liability','2000','Accounts Payable','\m(payable|creditors|ap)\M',(p_doc->>'user_id')::uuid)
    else public.filey_workflow_account_for_owner('asset','1200','Accounts Receivable','\m(receivable|debtors|ar)\M',(p_doc->>'user_id')::uuid) end;
  perform public.filey_workflow_entry(v_cash,case when v_purchase then 'credit' else 'debit' end,v_spot,v_ref||' — cash',v_ref,'payment',p_date,v_invoice,v_po,v_payment);
  perform public.filey_workflow_entry(v_counter,case when v_purchase then 'debit' else 'credit' end,v_base,v_ref||case when v_purchase then ' — AP reduction' else ' — AR reduction' end,v_ref,'payment',p_date,v_invoice,v_po,v_payment);
  if abs(v_diff)>=0.01 then
    v_fx:=public.filey_workflow_account_for_owner('expense','5900','Foreign Exchange Gain/Loss','foreign exchange|fx gain|exchange (gain|loss)',(p_doc->>'user_id')::uuid);
    perform public.filey_workflow_entry(v_fx,case when (v_diff>0)=v_purchase then 'debit' else 'credit' end,abs(v_diff),v_ref||' — FX difference',v_ref,'payment',p_date,v_invoice,v_po,v_payment);
  end if;
  return v_payment;
end $$;

-- A boolean-only privileged read detects hidden corrupt historical children.
-- It first proves the parent writable; no private child values are returned.
create or replace function public.filey_workflow_children_owned(p_kind text,p_id bigint,p_org text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid; v_module text;
begin
  if auth.uid() is null or p_org is distinct from public.current_org() or not public.filey_is_workspace_member(p_org) then return false; end if;
  if p_kind='invoice' then select user_id,case when doc_type='purchase' then 'purchase-invoices' else 'invoicing' end into v_owner,v_module
    from public.invoice_docs where id=p_id and org_id=p_org and (user_id=auth.uid() or public.is_org_admin());
  elsif p_kind='po' then select user_id,'purchase-orders' into v_owner,v_module from public.purchase_orders where id=p_id and org_id=p_org and (user_id=auth.uid() or public.is_org_admin());
  elsif p_kind='order' then select user_id,'orders' into v_owner,v_module from public.orders where id=p_id and org_id=p_org and (user_id=auth.uid() or public.is_org_admin());
  else return false; end if;
  if v_owner is null or not public.filey_can_use(v_module) then return false; end if;
  -- A valid admin can replace another author's lines; their creator identity
  -- differs legitimately. The parent policy governs access, while its org
  -- must match every child, including rows hidden by the invoker's RLS.
  if p_kind='invoice' then return not exists(select 1 from public.invoice_doc_items where invoice_id=p_id and (org_id is distinct from p_org or (not public.is_org_admin() and user_id is distinct from v_owner)));
  elsif p_kind='po' then return not exists(select 1 from public.purchase_order_items where po_id=p_id and (org_id is distinct from p_org or (not public.is_org_admin() and user_id is distinct from v_owner)));
  else return not exists(select 1 from public.order_items where order_id=p_id and (org_id is distinct from p_org or (not public.is_org_admin() and user_id is distinct from v_owner))); end if;
end $$;

-- Generated private effects must remain reversible by the original author.
-- The privileged read returns only a boolean after verifying the parent.
create or replace function public.filey_workflow_effects_owned(p_kind text,p_id bigint,p_org text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid; v_ref text; v_legacy boolean; v_number text;
begin
  if p_kind='advance' then
    if auth.uid() is null or p_org is distinct from public.current_org() or not public.filey_is_workspace_member(p_org) or not public.filey_can_use('invoicing') or not public.filey_can_use('accounting') or not public.filey_can_use('people') then return false; end if;
    select user_id into v_owner from public.advances where id=p_id and org_id=p_org and (user_id=auth.uid() or public.is_org_admin());
    if v_owner is null then return false; end if;
  elsif not public.filey_workflow_children_owned(p_kind,p_id,p_org) then return false; end if;
  if p_kind='invoice' then select user_id,(case when doc_type='purchase' then 'Bill ' else 'Invoice ' end)||number,number into v_owner,v_ref,v_number from public.invoice_docs where id=p_id and org_id=p_org;
  elsif p_kind='po' then select user_id,'PO '||po_number into v_owner,v_ref from public.purchase_orders where id=p_id and org_id=p_org;
  elsif p_kind='order' then select user_id,'Order #'||id into v_owner,v_ref from public.orders where id=p_id and org_id=p_org;
  elsif p_kind<>'advance' then return false; end if;
  if exists(select 1 from public.transactions t left join public.accounts a on a.id=t.account_id
    where (case when p_kind='invoice' then t.invoice_id=p_id when p_kind='po' then t.po_id=p_id when p_kind='advance' then t.advance_id=p_id else false end)
      and (t.org_id is distinct from p_org or t.user_id is distinct from v_owner or a.org_id is distinct from p_org or a.user_id is distinct from v_owner))
    or exists(select 1 from public.stock_movements where workflow_kind=p_kind and workflow_id=p_id
      and (org_id is distinct from p_org or user_id is distinct from v_owner)) then return false; end if;
  if v_ref is not null then
    v_legacy:=exists(select 1 from public.transactions where org_id=p_org and invoice_id is null and po_id is null and ref=v_ref)
      or exists(select 1 from public.stock_movements where org_id=p_org and workflow_kind is null and ref=v_ref);
    if v_legacy and ((p_kind='invoice' and (select count(*) from public.invoice_docs where org_id=p_org and (case when doc_type='purchase' then 'Bill ' else 'Invoice ' end)||number=v_ref)>1)
      or (p_kind='po' and (select count(*) from public.purchase_orders where org_id=p_org and 'PO '||po_number=v_ref)>1)) then return false; end if;
    if exists(select 1 from public.transactions t left join public.accounts a on a.id=t.account_id
      where t.org_id=p_org and t.invoice_id is null and t.po_id is null and t.ref=v_ref
        and (t.user_id is distinct from v_owner or a.user_id is distinct from v_owner or a.org_id is distinct from p_org))
      or exists(select 1 from public.stock_movements where org_id=p_org and workflow_kind is null and ref=v_ref and user_id is distinct from v_owner) then return false; end if;
  end if;
  if p_kind='invoice' then
    if exists(select 1 from public.advances where org_id=p_org and note='applied:inv#'||p_id) and not public.filey_can_use('people') then return false; end if;
    if exists(select 1 from public.orders o where o.org_id=p_org and o.invoice_id is null and o.order_number='SO-'||v_number
      and not exists(select 1 from public.order_items where order_id=o.id) and o.user_id is distinct from v_owner) then return false; end if;
    if exists(select 1 from public.advances where note='applied:inv#'||p_id and (org_id is distinct from p_org or user_id is distinct from v_owner))
      or exists(select 1 from public.orders where invoice_id=p_id and (org_id is distinct from p_org or user_id is distinct from v_owner))
      or exists(select 1 from public.invoice_payments where invoice_id=p_id and (org_id is distinct from p_org or (not public.is_org_admin() and user_id is distinct from v_owner))) then return false; end if;
  elsif p_kind='po' and exists(select 1 from public.po_payments where po_id=p_id and (org_id is distinct from p_org or (not public.is_org_admin() and user_id is distinct from v_owner))) then return false; end if;
  return true;
end $$;
create or replace function public.filey_business_workflow(p_kind text,p_action text,p_payload jsonb,p_request uuid,p_actor uuid,p_org text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_doc jsonb; v_old jsonb; v_items jsonb:='[]'; v_old_items jsonb:='[]'; v_id bigint; v_payment bigint; v_payment_row jsonb;
  v_result jsonb; v_prior record; v_ids bigint[]; v_ref text; v_header jsonb; v_module text; v_paid numeric; v_total numeric;
begin
  if p_kind not in ('invoice','po') or p_action not in ('save','status','delete','receive','payment-add','payment-remove','advance')
    or p_request is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>8388608 then
    raise exception 'Invalid document workflow request.' using errcode='22023'; end if;
  v_module:=case when p_kind='po' then 'purchase-orders' when p_payload->'header'->>'doc_type'='purchase' then 'purchase-invoices' else 'invoicing' end;
  perform public.filey_workflow_guard(p_actor,p_org,v_module);
  select * into v_prior from public.business_workflow_requests where user_id=p_actor and org_id=p_org and request_id=p_request;
  if found then
    if v_prior.action<>p_kind||':'||p_action or v_prior.payload<>p_payload then raise exception 'This request was already used for different changes.' using errcode='22023'; end if;
    return v_prior.result;
  end if;
  v_id:=nullif(p_payload->>'id','')::bigint;
  if p_action='payment-remove' then
    v_payment:=nullif(p_payload->>'payment_id','')::bigint;
    if p_kind='po' then select to_jsonb(p),po_id into v_payment_row,v_id from public.po_payments p where id=v_payment for update;
    else select to_jsonb(p),invoice_id into v_payment_row,v_id from public.invoice_payments p where id=v_payment for update; end if;
    if v_payment_row is null then raise exception 'Payment not found or access denied.' using errcode='42501'; end if;
  end if;
  if v_id is not null then
    if not public.filey_workflow_effects_owned(p_kind,v_id,p_org) then raise exception 'This document has inconsistent historic item or generated effect ownership. Reconcile it before changing the document.' using errcode='42501'; end if;
    if p_kind='po' then
      select to_jsonb(d) into v_old from public.purchase_orders d where id=v_id and org_id=p_org and (user_id=p_actor or public.is_org_admin()) for update;
      select coalesce(jsonb_agg(to_jsonb(i) order by position,id),'[]') into v_old_items from public.purchase_order_items i where po_id=v_id;
    else
      select to_jsonb(d) into v_old from public.invoice_docs d where id=v_id and org_id=p_org and (user_id=p_actor or public.is_org_admin()) for update;
      select coalesce(jsonb_agg(to_jsonb(i) order by position,id),'[]') into v_old_items from public.invoice_doc_items i where invoice_id=v_id;
    end if;
    if v_old is null then raise exception 'Document not found or write access denied.' using errcode='42501'; end if;
    perform public.filey_workflow_guard(p_actor,p_org,case when p_kind='po' then 'purchase-orders' when v_old->>'doc_type'='purchase' then 'purchase-invoices' else 'invoicing' end);
  elsif p_action<>'save' then raise exception 'Choose a saved document.' using errcode='22023'; end if;
  if p_action='save' then
    v_header:=p_payload->'header'; v_items:=p_payload->'items';
    if jsonb_typeof(v_header) is distinct from 'object' then raise exception 'Invalid document header.' using errcode='22023'; end if;
    if coalesce(v_header->>'status','draft') not in ('draft','sent','paid','overdue','cancelled','canceled','received','completed','ordered','pending') then raise exception 'Choose a valid document status.' using errcode='22023'; end if;
    if (case when p_kind='po' then v_header->>'status' in ('received','completed') else v_header->>'status' in ('sent','paid','overdue') end)
      and coalesce(btrim(v_header->>case when p_kind='po' then 'po_number' else 'number' end),'')='' then raise exception 'Enter a document number before posting.' using errcode='22023'; end if;
    if p_kind='invoice' and jsonb_typeof(v_header->'einvoice')='object' and nullif(v_header->'einvoice'->>'uuid','') is null then
      v_header:=jsonb_set(v_header,'{einvoice,uuid}',to_jsonb(gen_random_uuid()::text));
    end if;
    perform public.filey_workflow_totals(v_header,v_items,p_kind='po');
    if v_old is not null then
      -- Receipts continue to relieve the original amount/currency. Editing the
      -- settlement identity would strand them in a different control account.
      if (p_kind='invoice' and exists(select 1 from public.invoice_payments where invoice_id=v_id)) or
        (p_kind='po' and exists(select 1 from public.po_payments where po_id=v_id)) then
        if coalesce(v_header->>'currency','AED')<>coalesce(v_old->>'currency','AED') or v_header->'fx_rate' is distinct from v_old->'fx_rate'
          or coalesce(v_header->>'doc_type','sale')<>coalesce(v_old->>'doc_type','sale')
          or coalesce(v_header->>'status','draft') not in ('sent','paid','overdue','received','completed') then
          raise exception 'Remove the recorded payments before changing currency, document type or unposting.' using errcode='22023'; end if;
      end if;
      if p_kind='invoice' and v_old->>'status' in ('sent','paid','overdue') and
        (coalesce(v_header->>'invoice_type_code','') in ('381','81'))<>(coalesce(v_old->>'invoice_type_code','') in ('381','81')) then
        raise exception 'Create a separate credit note to correct a posted invoice.' using errcode='22023'; end if;
      if p_kind='invoice' and v_old->'einvoice'->>'uuid' is not null then
        v_header:=jsonb_set(v_header,'{einvoice}',coalesce(v_header->'einvoice','{}')||jsonb_build_object('uuid',v_old->'einvoice'->>'uuid'));
      end if;
      perform public.filey_workflow_unpost(p_kind,v_old,v_old_items);
    end if;
    if p_kind='po' then v_header:=v_header||jsonb_build_object('total',(public.filey_workflow_totals(v_header,v_items,true)->>'total')::numeric); end if;
    v_id:=public.filey_save_document(case when p_kind='po' then 'purchase_orders' else 'invoice_docs' end,v_header,v_items,v_id);
    if p_kind='po' then
      select to_jsonb(d) into v_doc from public.purchase_orders d where id=v_id;
      update public.purchase_order_items set user_id=(v_doc->>'user_id')::uuid where po_id=v_id;
      select coalesce(jsonb_agg(to_jsonb(i) order by position,id),'[]') into v_items from public.purchase_order_items i where po_id=v_id;
    else
      select to_jsonb(d) into v_doc from public.invoice_docs d where id=v_id;
      update public.invoice_doc_items set user_id=(v_doc->>'user_id')::uuid where invoice_id=v_id;
      select coalesce(jsonb_agg(to_jsonb(i) order by position,id),'[]') into v_items from public.invoice_doc_items i where invoice_id=v_id;
    end if;
    if (case when p_kind='po' then v_doc->>'status' in ('received','completed') else v_doc->>'status' in ('sent','paid','overdue') end) then
      perform public.filey_workflow_post(p_kind,v_doc,v_items,coalesce(p_payload->'rates','{}'));
    end if;
    if p_kind='invoice' then perform public.filey_workflow_advance(v_doc,nullif(v_doc->>'advance_applied','')::numeric,v_old); end if;
  elsif p_action in ('status','receive') then
    v_doc:=v_old||jsonb_build_object('status',case when p_action='receive' then 'received' else p_payload->>'status' end);
    if v_doc->>'status' not in ('draft','sent','paid','overdue','cancelled','canceled','received','completed','ordered','pending') then raise exception 'Choose a valid document status.' using errcode='22023'; end if;
    if (case when p_kind='po' then v_old->>'status' in ('received','completed') else v_old->>'status' in ('sent','paid','overdue') end)
      is distinct from (case when p_kind='po' then v_doc->>'status' in ('received','completed') else v_doc->>'status' in ('sent','paid','overdue') end) then
      if not (case when p_kind='po' then v_doc->>'status' in ('received','completed') else v_doc->>'status' in ('sent','paid','overdue') end)
        and ((p_kind='po' and exists(select 1 from public.po_payments where po_id=v_id)) or (p_kind='invoice' and exists(select 1 from public.invoice_payments where invoice_id=v_id))) then
        raise exception 'Remove the recorded payments before unposting this document.' using errcode='22023'; end if;
      perform public.filey_workflow_unpost(p_kind,v_old,v_old_items);
      if (case when p_kind='po' then v_doc->>'status' in ('received','completed') else v_doc->>'status' in ('sent','paid','overdue') end) then
        perform public.filey_workflow_post(p_kind,v_doc,v_old_items,coalesce(p_payload->'rates','{}'));
        if p_kind='invoice' then perform public.filey_workflow_advance(v_doc,nullif(v_doc->>'advance_applied','')::numeric,v_old); end if;
      end if;
    end if;
    if p_kind='invoice' and v_doc->>'status' in ('cancelled','canceled') then
      perform public.filey_workflow_advance(v_doc,0,v_old); v_doc:=v_doc||jsonb_build_object('advance_applied',0);
    end if;
    if p_kind='po' then update public.purchase_orders set status=v_doc->>'status',stock_received=(v_doc->>'status' in ('received','completed')) where id=v_id;
    else update public.invoice_docs set status=v_doc->>'status',advance_applied=coalesce((v_doc->>'advance_applied')::numeric,0) where id=v_id; end if;
  elsif p_action='delete' then
    perform public.filey_workflow_unpost(p_kind,v_old,v_old_items,true);
    if p_kind='po' then
      delete from public.po_payments where po_id=v_id; delete from public.purchase_order_items where po_id=v_id; delete from public.purchase_orders where id=v_id;
    else
      delete from public.advances where org_id=p_org and note='applied:inv#'||v_id;
      delete from public.invoice_payments where invoice_id=v_id; delete from public.invoice_doc_items where invoice_id=v_id; delete from public.invoice_docs where id=v_id;
    end if;
  elsif p_action='payment-add' then
    v_payment:=public.filey_workflow_payment(p_kind,v_old,(p_payload->>'amount')::numeric,p_payload->>'method',(p_payload->>'paid_at')::date,coalesce(p_payload->'rates','{}'));
  elsif p_action='payment-remove' then
    v_ref:=case when p_kind='po' then 'PO payment #' else 'Invoice payment #' end||v_payment;
    select array_agg(id) into v_ids from public.transactions where org_id=p_org and source='payment'
      and case when p_kind='po' then po_id=v_id else invoice_id=v_id end
      and (workflow_payment_id=v_payment or ref=v_ref);
    if v_ids is null and p_kind='invoice' and exists(select 1 from public.transactions where invoice_id=v_id and source='payment' and ref ~ ' Payment$') then
      -- Old receipts were not given an ID. Never guess which historical bundle
      -- to erase when it could change another receipt or a different currency.
      raise exception 'This historic payment needs ledger reconciliation before removal.' using errcode='22023';
    end if;
    perform public.filey_workflow_reverse(v_ids);
    if p_kind='po' then delete from public.po_payments where id=v_payment;
    else
      delete from public.invoice_payments where id=v_payment;
      select coalesce(sum(amount),0) into v_paid from public.invoice_payments where invoice_id=v_id;
      v_total:=(public.filey_workflow_totals(v_old,v_old_items)->>'total')::numeric;
      if v_old->>'status'='paid' and v_paid+coalesce((v_old->>'advance_applied')::numeric,0)<v_total-0.005 then update public.invoice_docs set status='sent' where id=v_id; end if;
    end if;
  elsif p_action='advance' then
    if p_kind<>'invoice' then raise exception 'Advance allocation requires a customer invoice.' using errcode='22023'; end if;
    if p_payload ? 'party_id' and nullif(p_payload->>'party_id','')::bigint is distinct from nullif(v_old->>'customer_id','')::bigint then raise exception 'The invoice customer changed. Reopen the invoice before allocating credit.' using errcode='22023'; end if;
    v_doc:=v_old||jsonb_build_object('advance_applied',(p_payload->>'amount')::numeric);
    perform public.filey_workflow_advance(v_doc,(p_payload->>'amount')::numeric,v_old);
    update public.invoice_docs set advance_applied=(p_payload->>'amount')::numeric where id=v_id;
  end if;
  v_result:=jsonb_build_object('id',v_id,'payment_id',v_payment);
  insert into public.business_workflow_requests(request_id,action,payload,result) values(p_request,p_kind||':'||p_action,p_payload,v_result);
  return v_result;
end $$;
alter function public.filey_business_workflow(text,text,jsonb,uuid,uuid,text) owner to filey_workflow_executor;

create or replace function public.filey_order_workflow(p_action text,p_payload jsonb,p_request uuid,p_actor uuid,p_org text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id bigint:=nullif(p_payload->>'id','')::bigint; v_doc jsonb; v_header jsonb; v_items jsonb; v_item jsonb;
  v_prior record; v_result jsonb; v_old_qty record; v_new_qty record; v_total numeric:=0; v_status text; v_old_status text;
begin
  if p_action not in ('save','status','delete') or p_request is null or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(p_payload::text)>8388608 then raise exception 'Invalid order workflow request.' using errcode='22023'; end if;
  perform public.filey_workflow_guard(p_actor,p_org,'orders');
  select * into v_prior from public.business_workflow_requests where user_id=p_actor and org_id=p_org and request_id=p_request;
  if found then
    if v_prior.action<>'order:'||p_action or v_prior.payload<>p_payload then raise exception 'This request was already used for different changes.' using errcode='22023'; end if;
    return v_prior.result;
  end if;
  if v_id is not null then
    if not public.filey_workflow_effects_owned('order',v_id,p_org) then raise exception 'This order has inconsistent historic item ownership. Reconcile it before changing the order.' using errcode='42501'; end if;
    select to_jsonb(o) into v_doc from public.orders o where id=v_id and org_id=p_org and (user_id=p_actor or public.is_org_admin()) for update;
    if v_doc is null then raise exception 'Order not found or write access denied.' using errcode='42501'; end if;
    if nullif(v_doc->>'invoice_id','') is not null then raise exception 'Change the linked invoice to update this generated order.' using errcode='22023'; end if;
  elsif p_action<>'save' then raise exception 'Choose a saved order.' using errcode='22023'; end if;
  v_header:=coalesce(p_payload->'header','{}');
  v_old_status:=coalesce(v_doc->>'status','draft');
  v_status:=case when p_action='delete' then 'cancelled' when p_action='status' then p_payload->>'status' else coalesce(v_header->>'status',v_old_status) end;
  if v_status not in ('draft','pending','processing','completed','cancelled','canceled','shipped','delivered','confirmed') then raise exception 'Choose a valid order status.' using errcode='22023'; end if;
  if p_action='save' then
    v_items:=p_payload->'items';
    if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items)>500 then raise exception 'An order supports at most 500 valid item rows.' using errcode='22023'; end if;
    for v_item in select value from jsonb_array_elements(v_items) loop
      if nullif(v_item->>'product_id','')::bigint is null or public.filey_workflow_number(v_item->>'quantity')<0 or public.filey_workflow_number(v_item->>'unit_price')<0 then raise exception 'Choose valid order products, quantities and prices.' using errcode='22023'; end if;
      v_total:=v_total+public.filey_workflow_round(public.filey_workflow_number(v_item->>'quantity')*public.filey_workflow_number(v_item->>'unit_price'));
    end loop;
    if jsonb_array_length(v_items)=0 then v_total:=coalesce(nullif(v_header->>'total','')::numeric,0); end if;
    if v_total::text in ('NaN','Infinity','-Infinity') or v_total<0 or v_total>=1000000000000 then raise exception 'Enter a valid order total.' using errcode='22023'; end if;
    if nullif(v_header->>'customer_id','') is not null and not exists(select 1 from public.crm_customers where id=(v_header->>'customer_id')::bigint and org_id=p_org) then raise exception 'Customer not found or access denied.' using errcode='42501'; end if;
    if v_id is null then
      insert into public.orders(order_number,customer_name,customer_id,status,total)
        values(coalesce(v_header->>'order_number',''),coalesce(v_header->>'customer_name',''),nullif(v_header->>'customer_id','')::bigint,v_status,v_total) returning id into v_id;
    end if;
  else select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') into v_items from public.order_items i where order_id=v_id; end if;
  -- Apply only the difference between the current journal footprint and the
  -- desired reservation. Reopening a cancelled historic order uses its actual
  -- movement history, and an unchanged status creates no movement noise.
  for v_old_qty in select product_id from public.order_items where order_id=v_id union
    select nullif(value->>'product_id','')::bigint from jsonb_array_elements(v_items) union
    select product_id from public.stock_movements where org_id=p_org and ((workflow_kind='order' and workflow_id=v_id) or (workflow_kind is null and ref='Order #'||v_id)) loop
    select coalesce(sum(qty),0) qty,count(*) n into v_new_qty from public.stock_movements where org_id=p_org and product_id=v_old_qty.product_id
      and ((workflow_kind='order' and workflow_id=v_id) or (workflow_kind is null and ref='Order #'||v_id));
    if v_new_qty.n=0 and v_doc is not null and v_old_status not in ('cancelled','canceled') then
      select -coalesce(sum(quantity),0),0 into v_new_qty from public.order_items where order_id=v_id and product_id=v_old_qty.product_id;
    end if;
    if v_status not in ('cancelled','canceled') then select coalesce(sum(public.filey_workflow_number(value->>'quantity')),0) into v_total
      from jsonb_array_elements(v_items) where nullif(value->>'product_id','')::bigint=v_old_qty.product_id;
    else v_total:=0; end if;
    perform public.filey_workflow_stock(v_old_qty.product_id,-v_new_qty.qty-v_total,'order',v_id,'Order #'||v_id);
  end loop;
  v_total:=case when jsonb_array_length(v_items)=0 then coalesce(nullif(v_header->>'total','')::numeric,0) else
    (select coalesce(sum(public.filey_workflow_round(public.filey_workflow_number(value->>'quantity')*public.filey_workflow_number(value->>'unit_price'))),0) from jsonb_array_elements(v_items)) end;
  if p_action='delete' then delete from public.order_items where order_id=v_id; delete from public.orders where id=v_id;
  elsif p_action='status' then update public.orders set status=v_status where id=v_id;
  else
    update public.orders set customer_name=coalesce(v_header->>'customer_name',customer_name),
      customer_id=case when v_header ? 'customer_id' then nullif(v_header->>'customer_id','')::bigint else customer_id end,
      status=v_status,total=v_total where id=v_id;
    delete from public.order_items where order_id=v_id;
    for v_item in select value from jsonb_array_elements(v_items) loop
      insert into public.order_items(order_id,product_id,quantity,unit_price,user_id)
        values(v_id,(v_item->>'product_id')::bigint,(v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric,coalesce((v_doc->>'user_id')::uuid,p_actor));
    end loop;
  end if;
  v_result:=jsonb_build_object('id',v_id);
  insert into public.business_workflow_requests(request_id,action,payload,result) values(p_request,'order:'||p_action,p_payload,v_result);
  return v_result;
end $$;
alter function public.filey_order_workflow(text,jsonb,uuid,uuid,text) owner to filey_workflow_executor;

create or replace function public.filey_advance_workflow(p_action text,p_payload jsonb,p_request uuid,p_actor uuid,p_org text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id bigint:=nullif(p_payload->>'id','')::bigint; v_old public.advances; v_header jsonb:=coalesce(p_payload->'header','{}');
  v_row public.advances; v_prior record; v_result jsonb; v_available numeric; v_ids bigint[]; v_account bigint; v_cash bigint; v_entry bigint;
begin
  if p_action not in ('add','update','delete') or p_request is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>32768 then raise exception 'Invalid advance request.' using errcode='22023'; end if;
  perform public.filey_workflow_guard(p_actor,p_org,'invoicing');
  perform public.filey_workflow_guard(p_actor,p_org,'accounting');
  select * into v_prior from public.business_workflow_requests where user_id=p_actor and org_id=p_org and request_id=p_request;
  if found then if v_prior.action<>'advance:'||p_action or v_prior.payload<>p_payload then raise exception 'This request was already used for different changes.' using errcode='22023'; end if; return v_prior.result; end if;
  if p_action<>'add' then
    if not public.filey_workflow_effects_owned('advance',v_id,p_org) then raise exception 'This advance has inconsistent historic posting ownership. Reconcile it before changing the advance.' using errcode='42501'; end if;
    select * into v_old from public.advances where id=v_id and org_id=p_org and (user_id=p_actor or public.is_org_admin()) for update;
    if not found then raise exception 'Advance not found or write access denied.' using errcode='42501'; end if;
    if v_old.amount<0 or v_old.note like 'applied:inv#%' then raise exception 'Change the linked invoice to update an applied advance.' using errcode='22023'; end if;
    v_header:=to_jsonb(v_old)||v_header;
  end if;
  v_row:=jsonb_populate_record(null::public.advances,v_header);
  v_row.user_id:=coalesce(v_old.user_id,p_actor);
  if v_row.party_type not in ('customer','supplier') or v_row.party_id is null or v_row.amount is null or v_row.amount::text in ('NaN','Infinity','-Infinity')
    or v_row.amount<=0 or v_row.amount>=1000000000000 or v_row.amount<>round(v_row.amount,2) or coalesce(v_row.note,'') like 'applied:%'
    or v_row.paid_at is null then raise exception 'Choose a party, a positive advance amount and valid date.' using errcode='22023'; end if;
  if (v_row.party_type='customer' and not exists(select 1 from public.crm_customers where id=v_row.party_id and org_id=p_org))
    or (v_row.party_type='supplier' and not exists(select 1 from public.suppliers where id=v_row.party_id and org_id=p_org)) then raise exception 'Party not found or access denied.' using errcode='42501'; end if;
  if p_action<>'add' then
    if v_old.amount>(case when p_action='delete' then 0 else v_row.amount end) and
      not public.filey_workflow_credit_available(v_old.party_type,v_old.party_id,v_old.user_id,null,v_old.amount-(case when p_action='delete' then 0 else v_row.amount end)) then raise exception 'This advance is already allocated. Release the invoice allocation before reducing it.' using errcode='22023'; end if;
    select array_agg(id) into v_ids from public.transactions where advance_id=v_id;
    perform public.filey_workflow_reverse(v_ids);
  end if;
  if p_action='delete' then delete from public.advances where id=v_id;
  else
    if p_action='add' then
      insert into public.advances(party_type,party_id,party_name,amount,note,paid_at,accounting_posted)
        values(v_row.party_type,v_row.party_id,coalesce(v_row.party_name,''),v_row.amount,v_row.note,v_row.paid_at,true) returning id into v_id;
      v_row.accounting_posted:=true;
    else
      update public.advances set amount=v_row.amount,note=v_row.note,paid_at=v_row.paid_at where id=v_id;
      v_row.accounting_posted:=v_old.accounting_posted;
    end if;
    if v_row.accounting_posted then
      v_account:=case when v_row.party_type='customer' then public.filey_workflow_account_for_owner('liability','2200','Customer Advances','customer advances|customer deposits',v_row.user_id)
        else public.filey_workflow_account_for_owner('asset','1260','Supplier Advances','supplier advances|supplier prepayments',v_row.user_id) end;
      v_cash:=public.filey_workflow_account_for_owner('asset','1000','Cash & Bank','cash|bank',v_row.user_id);
      v_entry:=public.filey_workflow_entry(v_cash,case when v_row.party_type='customer' then 'debit' else 'credit' end,v_row.amount,'Advance #'||v_id,'Advance #'||v_id,'advance',v_row.paid_at);
      update public.transactions set advance_id=v_id where id=v_entry;
      v_entry:=public.filey_workflow_entry(v_account,case when v_row.party_type='customer' then 'credit' else 'debit' end,v_row.amount,'Advance #'||v_id,'Advance #'||v_id,'advance',v_row.paid_at);
      update public.transactions set advance_id=v_id where id=v_entry;
    end if;
  end if;
  v_result:=jsonb_build_object('id',v_id);
  insert into public.business_workflow_requests(request_id,action,payload,result) values(p_request,'advance:'||p_action,p_payload,v_result);
  return v_result;
end $$;
alter function public.filey_advance_workflow(text,jsonb,uuid,uuid,text) owner to filey_workflow_executor;

create or replace function public.filey_journal_workflow(p_action text,p_payload jsonb,p_request uuid,p_actor uuid,p_org text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id bigint:=nullif(p_payload->>'id','')::bigint; v_prior record; v_result jsonb; v_row public.transactions; v_account public.accounts; v_ids bigint[]; v_removed bigint:=0;
begin
  if p_action not in ('post','delete','repair','account-delete','account-update') or p_request is null or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(p_payload::text)>32768 then raise exception 'Invalid accounting request.' using errcode='22023'; end if;
  perform public.filey_workflow_guard(p_actor,p_org,'accounting');
  select * into v_prior from public.business_workflow_requests where user_id=p_actor and org_id=p_org and request_id=p_request;
  if found then if v_prior.action<>'journal:'||p_action or v_prior.payload<>p_payload then raise exception 'This request was already used for different changes.' using errcode='22023'; end if; return v_prior.result; end if;
  if p_action='post' then
    v_id:=public.filey_workflow_entry((p_payload->>'account_id')::bigint,p_payload->>'txn_type',(p_payload->>'amount')::numeric,p_payload->>'description',null,null,(p_payload->>'txn_date')::date);
    if v_id is null then raise exception 'Enter a positive journal amount.' using errcode='22023'; end if;
  elsif p_action='delete' then
    select * into v_row from public.transactions where id=v_id and org_id=p_org and (user_id=p_actor or public.is_org_admin()) for update;
    if not found then raise exception 'Journal entry not found or write access denied.' using errcode='42501'; end if;
    if v_row.invoice_id is not null or v_row.po_id is not null or v_row.advance_id is not null or nullif(v_row.source,'') is not null or nullif(v_row.ref,'') is not null then
      raise exception 'Change the source document or payment to reverse these linked postings together.' using errcode='22023'; end if;
    perform public.filey_workflow_reverse(array[v_id]);
  elsif p_action in ('account-delete','account-update') then
    select * into v_account from public.accounts where id=v_id and org_id=p_org and (user_id=p_actor or public.is_org_admin()) for update;
    if not found then raise exception 'Account not found or write access denied.' using errcode='42501'; end if;
    if p_action='account-delete' then
      if v_account.balance<>0 or exists(select 1 from public.transactions where account_id=v_id) or exists(select 1 from public.expenses where account_id=v_id) then
        raise exception 'An account with a balance or activity must be retained for the audit trail.' using errcode='22023'; end if;
      delete from public.accounts where id=v_id;
    else
      if (p_payload->'header' ? 'account_type' and p_payload->'header'->>'account_type' not in ('asset','liability','equity','revenue','expense'))
        or (p_payload->'header' ? 'balance' and ((p_payload->'header'->>'balance')::numeric::text in ('NaN','Infinity','-Infinity') or abs((p_payload->'header'->>'balance')::numeric)>=1000000000000)) then raise exception 'Enter a valid account type and finite balance.' using errcode='22023'; end if;
      if exists(select 1 from public.transactions where account_id=v_id) and
        (coalesce(p_payload->'header'->>'account_type',v_account.account_type)<>v_account.account_type or coalesce((p_payload->'header'->>'balance')::numeric,v_account.balance)<>v_account.balance) then
        raise exception 'An active account type and balance are maintained by its journal. Record an adjustment instead.' using errcode='22023'; end if;
      update public.accounts set code=coalesce(p_payload->'header'->>'code',code),name=coalesce(p_payload->'header'->>'name',name),
        account_type=coalesce(p_payload->'header'->>'account_type',account_type),balance=coalesce((p_payload->'header'->>'balance')::numeric,balance) where id=v_id;
    end if;
  elsif p_action='repair' then
    -- Equal manual entries can both be real. Only remove duplicates with the
    -- same immutable source identity, reference, account, side, value and date.
    select array_agg(id) into v_ids from (
      select id,row_number() over(partition by user_id,invoice_id,po_id,advance_id,workflow_payment_id,ref,source,account_id,txn_type,amount,description,txn_date order by id) n
      from public.transactions where org_id=p_org and (user_id=p_actor or public.is_org_admin()) and nullif(ref,'') is not null and nullif(source,'') is not null
        and (invoice_id is not null or po_id is not null or advance_id is not null or workflow_payment_id is not null)
        and (source<>'payment' or workflow_payment_id is not null)
    ) candidates where n>1;
    v_removed:=coalesce(cardinality(v_ids),0); perform public.filey_workflow_reverse(v_ids); v_id:=1;
  end if;
  v_result:=jsonb_build_object('id',v_id,'removed',v_removed);
  insert into public.business_workflow_requests(request_id,action,payload,result) values(p_request,'journal:'||p_action,p_payload,v_result);
  return v_result;
end $$;
alter function public.filey_journal_workflow(text,jsonb,uuid,uuid,text) owner to filey_workflow_executor;

create or replace function public.filey_stock_workflow(p_action text,p_payload jsonb,p_request uuid,p_actor uuid,p_org text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id bigint:=(p_payload->>'id')::bigint; v_delta numeric:=(p_payload->>'delta')::numeric; v_prior record; v_result jsonb; v_qty numeric; v_changed bigint; v_owner uuid;
begin
  if p_action<>'adjust' or p_request is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>32768
    or v_delta is null or v_delta::text in ('NaN','Infinity','-Infinity') or abs(v_delta)>=100000000000 or v_delta<>round(v_delta,3)
    or p_payload->>'type' not in ('in','out','adjust') then raise exception 'Enter a valid stock adjustment with at most three decimals.' using errcode='22023'; end if;
  perform public.filey_workflow_guard(p_actor,p_org,'inventory');
  select * into v_prior from public.business_workflow_requests where user_id=p_actor and org_id=p_org and request_id=p_request;
  if found then if v_prior.action<>'stock:adjust' or v_prior.payload<>p_payload then raise exception 'This request was already used for different changes.' using errcode='22023'; end if; return v_prior.result; end if;
  select quantity,user_id into v_qty,v_owner from public.products where id=v_id and org_id=p_org and (user_id=p_actor or public.is_org_admin()) for update;
  if not found then raise exception 'Product not found or stock update denied.' using errcode='42501'; end if;
  update public.products set quantity=quantity+v_delta where id=v_id returning id into v_changed;
  if v_changed is null then raise exception 'Stock update denied.' using errcode='42501'; end if;
  if v_delta<>0 then insert into public.stock_movements(product_id,qty,type,ref,note,moved_at,workflow_kind,workflow_id,user_id)
    values(v_id,v_delta,p_payload->>'type',p_payload->>'ref',p_payload->>'note',coalesce(nullif(p_payload->>'date','')::date::timestamptz,now()),'manual',v_id,v_owner); end if;
  v_result:=jsonb_build_object('id',v_id);
  insert into public.business_workflow_requests(request_id,action,payload,result) values(p_request,'stock:adjust',p_payload,v_result);
  return v_result;
end $$;
alter function public.filey_stock_workflow(text,jsonb,uuid,uuid,text) owner to filey_workflow_executor;

-- Internal writes are callable only from the trusted dispatcher, retaining
-- ordinary RLS there. Clients cannot bypass the receipt/atomic entry point.
-- Pure calculators and bounded permission-scoped booleans remain public RPCs
-- for authenticated clients; anonymous callers have no workflow.
do $$ declare v record; begin
  for v in select proname,oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and
    (proname like 'filey_workflow_%' or proname in ('filey_business_workflow','filey_order_workflow','filey_journal_workflow','filey_advance_workflow','filey_stock_workflow')) loop
    execute format('revoke all on function %s from public,anon',v.signature);
    if v.proname like 'filey_workflow_%' and v.proname not in ('filey_workflow_round','filey_workflow_number','filey_workflow_totals','filey_workflow_fx',
      'filey_workflow_children_owned','filey_workflow_effects_owned','filey_workflow_credit_available','filey_workflow_receipt_reversible') then
      execute format('revoke all on function %s from authenticated,service_role',v.signature);
      execute format('grant execute on function %s to filey_workflow_executor',v.signature);
    else
      execute format('grant execute on function %s to authenticated',v.signature);
    end if;
  end loop;
end $$;
revoke create on schema public from filey_workflow_executor;
do $$ begin
  if has_schema_privilege('filey_workflow_executor','public','CREATE') then
    raise exception 'The workflow executor inherits public schema CREATE. Correct the schema grants before installing this workflow.';
  end if;
end $$;
notify pgrst,'reload schema';
commit;
