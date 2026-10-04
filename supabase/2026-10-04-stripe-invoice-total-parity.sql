-- Legacy, already-created Stripe invoice checkouts use current document totals.
-- No new public checkout, ledger backfill or historical receipt rewrite.
begin;
do $$ begin
  if to_regprocedure('public.filey_workflow_totals(jsonb,jsonb,boolean)') is null then
    raise exception 'Apply 2026-10-04-atomic-business-workflows.sql before Stripe total parity.';
  end if;
end $$;
create or replace function public.filey_settle_stripe_checkout(
  p_session text,p_kind text,p_user uuid,p_invoice bigint,
  p_amount numeric,p_currency text,p_intent text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare doc public.invoice_docs%rowtype; existing public.stripe_settled_checkouts%rowtype;
  buyer uuid; items jsonb; total numeric; paid numeric;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service-role settlement required' using errcode='42501';
  end if;
  if p_session is null or p_session !~ '^cs_[A-Za-z0-9_]+$' or length(p_session)>255
    or p_intent is null or p_intent !~ '^pi_[A-Za-z0-9_]+$' or length(p_intent)>255
    or p_currency is null or p_currency !~ '^[A-Z]{3}$'
    or p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount>999999999999.99
    or round(p_amount,2)<>p_amount or p_kind is null or p_kind not in ('invoice_payment','lite_license') then
    raise exception 'Invalid Stripe settlement';
  end if;
  if p_kind='invoice_payment' then
    if p_user is not null or p_invoice is null then raise exception 'Invalid invoice settlement'; end if;
    select * into doc from invoice_docs where id=p_invoice for update;
    if not found or upper(coalesce(doc.currency,''))<>p_currency then raise exception 'Invoice currency or reference mismatch'; end if;
    buyer:=doc.user_id;
  else
    if p_user is null or p_invoice is not null then raise exception 'Invalid license settlement'; end if;
    buyer:=p_user;
  end if;
  insert into stripe_settled_checkouts(session_id,payment_intent,kind,user_id,invoice_id,amount,currency)
    values(p_session,p_intent,p_kind,buyer,p_invoice,p_amount,p_currency)
    on conflict do nothing;
  if not found then
    select * into existing from stripe_settled_checkouts where session_id=p_session;
    if not found or existing.payment_intent<>p_intent or existing.kind<>p_kind or existing.user_id<>buyer
      or existing.invoice_id is distinct from p_invoice or existing.amount<>p_amount or existing.currency<>p_currency then
      raise exception 'Stripe settlement replay mismatch';
    end if;
    return jsonb_build_object('received',true,'duplicate',true);
  end if;
  if p_kind='lite_license' then
    if not exists(select 1 from licenses where stripe_payment_intent=p_intent) then
      insert into licenses(user_id,product,status,stripe_payment_intent)
        values(buyer,'filey-desktop','active',p_intent);
    end if;
  else
    -- Service-role reads can see malformed legacy children that ordinary RLS
    -- hides. Refuse partial totals; preserve the original records for repair.
    if exists(select 1 from invoice_doc_items where invoice_id=doc.id and org_id is distinct from doc.org_id) then
      raise exception 'Invoice lines require workspace reconciliation.' using errcode='22023';
    end if;
    select coalesce(jsonb_agg(to_jsonb(i) order by position,id),'[]'::jsonb)
      into items from invoice_doc_items i where invoice_id=doc.id and org_id=doc.org_id;
    total:=(public.filey_workflow_totals(to_jsonb(doc),items,false)->>'total')::numeric;
    if doc.advance_applied<0 or doc.advance_applied>total then
      raise exception 'Invoice advance requires reconciliation.' using errcode='22023';
    end if;
    insert into invoice_payments(invoice_id,user_id,org_id,amount,method,paid_at)
      values(doc.id,doc.user_id,doc.org_id,p_amount,'card',now());
    select coalesce(sum(amount),0)+coalesce(doc.advance_applied,0) into paid
      from invoice_payments where invoice_id=doc.id and org_id=doc.org_id;
    if paid>=total and doc.status in ('sent','overdue') then
      update invoice_docs set status='paid',updated_at=now() where id=doc.id;
    end if;
  end if;
  return jsonb_build_object('received',true,'duplicate',false);
end;
$$;
revoke all on function public.filey_settle_stripe_checkout(text,text,uuid,bigint,numeric,text,text) from public,anon,authenticated;
grant execute on function public.filey_settle_stripe_checkout(text,text,uuid,bigint,numeric,text,text) to service_role;
notify pgrst,'reload schema';
commit;
