-- Team visibility is not consent to publish a bearer link. Historical `shared`
-- rows cannot establish that consent, so owners must explicitly enable a new
-- link once. Reapplying this migration preserves every explicit public link.
begin;
alter table public.invoice_docs add column if not exists public_shared boolean not null default false;
alter table public.quotations add column if not exists public_shared boolean not null default false;
alter table public.purchase_orders add column if not exists public_shared boolean not null default false;
alter table public.payment_receipts add column if not exists public_shared boolean not null default false;

-- Clones, imports, recurrence and device sync must never inherit a live link.
-- Ordinary saves cannot overwrite a later explicit enable/revoke with stale
-- editor/cache fields. The owner-authorized definer RPC below changes access.
create or replace function public.filey_public_link_guard()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    new.public_shared:=false;
    new.share_token:=gen_random_uuid();
  elsif current_user in ('authenticated','anon','filey_workflow_executor') then
    new.public_shared:=old.public_shared;
    new.share_token:=old.share_token;
  end if;
  return new;
end;
$$;
revoke all on function public.filey_public_link_guard() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['invoice_docs','quotations','purchase_orders','payment_receipts'] loop
    execute format('drop trigger if exists filey_public_link_guard on public.%I',t);
    execute format('create trigger filey_public_link_guard before insert or update on public.%I for each row execute function public.filey_public_link_guard()',t);
  end loop;
end $$;

create or replace function public.filey_set_public_document_link(p_type text,p_id bigint,p_enabled boolean,p_expected_org text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  t text; module_name text; owner_id uuid; doc_org text; token uuid; enabled boolean; invoice_kind text;
begin
  if auth.uid() is null or p_enabled is null or p_expected_org is null
    or p_expected_org is distinct from public.current_org()
    or not public.filey_is_workspace_member(p_expected_org) or not public.filey_mfa_allowed() then
    raise exception 'Review this document in your current workspace before sharing.' using errcode='42501';
  end if;
  case p_type
    when 'invoice' then t:='invoice_docs'; module_name:='invoicing';
    when 'quotation' then t:='quotations'; module_name:='quoting';
    when 'purchase_order' then t:='purchase_orders'; module_name:='purchase-orders';
    when 'receipt' then t:='payment_receipts'; module_name:='payment-receipts';
    else raise exception 'Unsupported public document type';
  end case;
  execute format('select user_id,org_id,share_token,public_shared,%s from public.%I where id=$1 and org_id=$2 for update',
    case when t='invoice_docs' then 'doc_type' else 'null::text' end,t)
    into owner_id,doc_org,token,enabled,invoice_kind using p_id,p_expected_org;
  if t='invoice_docs' and invoice_kind='purchase' then module_name:='purchase-invoices'; end if;
  if doc_org is null or not public.filey_can_use(module_name)
    or (owner_id is distinct from auth.uid() and not public.is_org_admin()) then
    raise exception 'Only the document owner or a workspace administrator can manage its public link.' using errcode='42501';
  end if;
  -- A revoked or legacy token must never become active again. Re-copying an
  -- already enabled link is stable and does not invalidate customer messages.
  if not enabled or not p_enabled then token:=gen_random_uuid(); end if;
  execute format('update public.%I set public_shared=$1,share_token=$2,updated_at=now() where id=$3 and org_id=$4',t)
    using p_enabled,token,p_id,p_expected_org;
  return case when p_enabled then token else null end;
end;
$$;
revoke all on function public.filey_set_public_document_link(text,bigint,boolean,text) from public,anon;
grant execute on function public.filey_set_public_document_link(text,bigint,boolean,text) to authenticated;

-- Explicit projections make newly added internal columns private by default.
create or replace function public.filey_public_document_fields(d jsonb)
returns jsonb language sql immutable security invoker set search_path=public,pg_temp as $$
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'number',coalesce(d->>'number',d->>'po_number'),
    'customer_name',coalesce(d->>'customer_name',d->>'supplier_name'),
    'customer_address',coalesce(d->>'customer_address',d->>'supplier_address'),
    'customer_trn',coalesce(d->>'customer_trn',d->>'supplier_trn'),
    'customer_email',coalesce(d->>'customer_email',d->>'supplier_email'),
    'issue_date',coalesce(d->>'issue_date',d->>'quote_date',d->>'order_date'),
    'due_date',coalesce(d->>'due_date',d->>'valid_until',d->>'expected_date'))) from jsonb_each(d)
  where key=any(array[
    'number','status','template','accent','currency','doc_title','tax_country_code',
    'seller_name','seller_address','seller_trn','seller_email','seller_phone','seller_city','seller_country_subdivision','seller_legal_id','seller_legal_id_type',
    'customer_name','customer_address','customer_trn','customer_email','buyer_city','buyer_country_subdivision','buyer_country_code',
    'supplier_name','supplier_address','supplier_trn','supplier_email','supplier_phone',
    'issue_date','due_date','quote_date','valid_until','order_date','expected_date','date_of_supply','po_number','po_date',
    'invoice_type_code','transaction_type','payment_means_code','original_invoice_number','original_invoice_date',
    'advance_applied','aed_exchange_rate','fx_rate','tax_rate','discount','notes','terms','payment_terms',
    'unit_price_formula','custom_columns','round_off','amount','amount_words','payment_method','ref_number','for_description',
    'show_logo','show_stamp','show_signature','show_bank'])
    -- Quotes/POs/receipts have no show_logo column and always render their logo.
    or (key='logo' and (not d ? 'show_logo' or d->'show_logo'='true'::jsonb))
    or (key='stamp' and d->'show_stamp'='true'::jsonb)
    or (key='signature' and d->'show_signature'='true'::jsonb)
    or (key='bank_details' and d->'show_bank'='true'::jsonb);
$$;
create or replace function public.filey_public_document_item(d jsonb)
returns jsonb language sql immutable security invoker set search_path=public,pg_temp as $$
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'description',coalesce(d->'description',d->'product'),
    'qty',coalesce(d->'qty',d->'quantity'),
    'unit_price',coalesce(d->'unit_price',d->'rate',d->'unit_cost'))) from jsonb_each(d)
  where key=any(array['description','qty','unit_price','unit','discount','tax','tax_category','custom']);
$$;
create or replace function public.filey_public_einvoice(d jsonb)
returns jsonb language sql immutable security invoker set search_path=public,pg_temp as $$
  select coalesce(jsonb_object_agg(key,case
    when key in ('seller','buyer') and jsonb_typeof(value)='object' then
      (select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) from jsonb_each(value) e(k,v)
       where k=any(array['corporate_trn','tin','endpoint_id','endpoint_scheme','legal_id','legal_id_type','legal_authority','identifier','phone']))
    when key='delivery' and jsonb_typeof(value)='object' then
      (select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) from jsonb_each(value) e(k,v)
       where k=any(array['address','city','region','country_code']))
    else value end),'{}'::jsonb)
  from jsonb_each(case when jsonb_typeof(d)='object' then d else '{}'::jsonb end)
  where key=any(array['uuid','seller','buyer','credit_reason','payment_account_id','payment_account_name','beneficiary_id','buyer_delivery_mode','delivery']);
$$;
revoke all on function public.filey_public_document_fields(jsonb),public.filey_public_document_item(jsonb),public.filey_public_einvoice(jsonb) from public,anon,authenticated;

create or replace function public.get_shared_doc(p_token uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('doc_type','invoice',
    'doc',public.filey_public_document_fields(to_jsonb(d))||jsonb_build_object('einvoice',public.filey_public_einvoice(d.einvoice)),
    'items',coalesce((select jsonb_agg(public.filey_public_document_item(to_jsonb(i)) order by i.position)
      from public.invoice_doc_items i where i.invoice_id=d.id and i.org_id=d.org_id),'[]'::jsonb))
  from public.invoice_docs d where d.share_token=p_token and d.public_shared=true
  union all
  select jsonb_build_object('doc_type','quotation','doc',public.filey_public_document_fields(to_jsonb(q)),
    'items',coalesce((select jsonb_agg(public.filey_public_document_item(to_jsonb(i)) order by i.position)
      from public.quotation_items i where i.quotation_id=q.id and i.org_id=q.org_id),'[]'::jsonb))
  from public.quotations q where q.share_token=p_token and q.public_shared=true
  union all
  select jsonb_build_object('doc_type','purchase_order','doc',public.filey_public_document_fields(to_jsonb(po)),
    'items',coalesce((select jsonb_agg(public.filey_public_document_item(to_jsonb(i)) order by i.position)
      from public.purchase_order_items i where i.po_id=po.id and i.org_id=po.org_id),'[]'::jsonb))
  from public.purchase_orders po where po.share_token=p_token and po.public_shared=true
  union all
  select jsonb_build_object('doc_type','receipt','doc',public.filey_public_document_fields(to_jsonb(r)),
    'items',jsonb_build_array(jsonb_build_object('description',coalesce(r.for_description,'Payment'),'qty',1,'unit_price',r.amount)))
  from public.payment_receipts r where r.share_token=p_token and r.public_shared=true
  limit 1;
$$;
create or replace function public.get_shared_invoice(p_token uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select d-'doc_type' from (select public.get_shared_doc(p_token) d) result where d->>'doc_type'='invoice';
$$;
revoke all on function public.get_shared_doc(uuid),public.get_shared_invoice(uuid) from public;
grant execute on function public.get_shared_doc(uuid),public.get_shared_invoice(uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
