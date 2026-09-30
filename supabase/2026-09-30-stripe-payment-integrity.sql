-- Legacy Stripe checkout settlement: service-role only, paid events only.
-- Additive and repeatable; historical invoices, payments and licenses are
-- not changed. Deploy before the matching Stripe edge function update.
begin;
create table if not exists public.stripe_settled_checkouts (
  session_id text primary key,
  payment_intent text not null unique,
  kind text not null check (kind in ('invoice_payment','lite_license')),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id bigint references public.invoice_docs(id) on delete set null,
  amount numeric(14,2) not null check(amount>0),
  currency text not null,
  created_at timestamptz not null default now()
);
alter table public.stripe_settled_checkouts enable row level security;
revoke all on public.stripe_settled_checkouts from anon, authenticated;
grant select,insert on public.stripe_settled_checkouts to service_role;

create or replace function public.filey_settle_stripe_checkout(
  p_session text,p_kind text,p_user uuid,p_invoice bigint,
  p_amount numeric,p_currency text,p_intent text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare doc public.invoice_docs%rowtype; existing public.stripe_settled_checkouts%rowtype;
  buyer uuid; subtotal numeric; total numeric; paid numeric;
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
    -- An older deployment may already have fulfilled this payment. Do not
    -- rewrite that license or issue another one while registering its receipt.
    if not exists(select 1 from licenses where stripe_payment_intent=p_intent) then
      insert into licenses(user_id,product,status,stripe_payment_intent)
        values(buyer,'filey-desktop','active',p_intent);
    end if;
  else
    insert into invoice_payments(invoice_id,user_id,org_id,amount,method,paid_at)
      values(doc.id,doc.user_id,doc.org_id,p_amount,'card',now());
    select coalesce(sum(qty*unit_price),0) into subtotal from invoice_doc_items where invoice_id=doc.id and org_id=doc.org_id;
    total:=greatest(0,subtotal-coalesce(doc.discount,0));
    total:=round(total*(1+coalesce(doc.tax_rate,0)/100),2);
    select coalesce(sum(amount),0) into paid from invoice_payments where invoice_id=doc.id and org_id=doc.org_id;
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
