-- ============================================================
--  Filey ERP — Unify Quotation / Purchase Order / Payment Receipt
--  document model with invoice_docs parity.
--  Safe to re-run (idempotent).
-- ============================================================

-- ----- Quotations -----
alter table public.quotations add column if not exists custom_columns jsonb;
alter table public.quotations add column if not exists unit_price_formula jsonb;
alter table public.quotations add column if not exists discount numeric(14,2) not null default 0;
alter table public.quotations add column if not exists tax_rate numeric(8,3) not null default 0;
alter table public.quotations add column if not exists shared boolean not null default false;
alter table public.quotations add column if not exists share_token uuid not null default gen_random_uuid();
alter table public.quotations add column if not exists logo text;
alter table public.quotations add column if not exists seller_name text not null default '';
alter table public.quotations add column if not exists seller_address text;
alter table public.quotations add column if not exists seller_trn text;
alter table public.quotations add column if not exists seller_email text;
alter table public.quotations add column if not exists seller_phone text;
alter table public.quotations add column if not exists doc_title text;
alter table public.quotations add column if not exists notes text;
alter table public.quotations add column if not exists status text not null default 'draft';
-- default template now matches the shared palette (was 'clean')
alter table public.quotations alter column template set default 'minimal';

alter table public.quotation_items add column if not exists unit text;
alter table public.quotation_items add column if not exists custom jsonb;

-- Back-fill existing rows so they are valid shared-doc citizens.
update public.quotations set custom_columns = coalesce(custom_columns, '[]'::jsonb),
                            unit_price_formula = coalesce(unit_price_formula, 'null'::jsonb),
                            shared = coalesce(shared, false),
                            show_stamp = coalesce(show_stamp, false),
                            show_signature = coalesce(show_signature, false),
                            discount = coalesce(discount, 0),
                            tax_rate = coalesce(tax_rate, 0),
                            status = coalesce(status, 'draft'),
                            seller_name = coalesce(nullif(seller_name, ''), '');

-- ----- Purchase Orders -----
alter table public.purchase_orders add column if not exists template text not null default 'uae';
alter table public.purchase_orders add column if not exists accent text not null default '#222222';
alter table public.purchase_orders add column if not exists currency text not null default 'AED';
alter table public.purchase_orders add column if not exists custom_columns jsonb;
alter table public.purchase_orders add column if not exists unit_price_formula jsonb;
alter table public.purchase_orders add column if not exists discount numeric(14,2) not null default 0;
alter table public.purchase_orders add column if not exists tax_rate numeric(8,3) not null default 0;
alter table public.purchase_orders add column if not exists shared boolean not null default false;
alter table public.purchase_orders add column if not exists share_token uuid not null default gen_random_uuid();
alter table public.purchase_orders add column if not exists logo text;
alter table public.purchase_orders add column if not exists seller_name text not null default '';
alter table public.purchase_orders add column if not exists seller_address text;
alter table public.purchase_orders add column if not exists seller_trn text;
alter table public.purchase_orders add column if not exists seller_email text;
alter table public.purchase_orders add column if not exists seller_phone text;
alter table public.purchase_orders add column if not exists supplier_name text;
alter table public.purchase_orders add column if not exists supplier_address text;
alter table public.purchase_orders add column if not exists supplier_trn text;
alter table public.purchase_orders add column if not exists supplier_email text;
alter table public.purchase_orders add column if not exists supplier_phone text;
alter table public.purchase_orders add column if not exists doc_title text;
alter table public.purchase_orders add column if not exists terms text;

alter table public.purchase_order_items add column if not exists unit text;
alter table public.purchase_order_items add column if not exists custom jsonb;

update public.purchase_orders set custom_columns = coalesce(custom_columns, '[]'::jsonb),
                                  unit_price_formula = coalesce(unit_price_formula, 'null'::jsonb),
                                  shared = coalesce(shared, false),
                                  show_stamp = coalesce(show_stamp, false),
                                  show_signature = coalesce(show_signature, false),
                                  discount = coalesce(discount, 0),
                                  tax_rate = coalesce(tax_rate, 0),
                                  template = coalesce(nullif(template, ''), 'uae'),
                                  accent = coalesce(nullif(accent, ''), '#222222'),
                                  currency = coalesce(nullif(currency, ''), 'AED');

-- ----- Payment Receipts -----
create table if not exists public.payment_receipts (
  id bigint generated by default as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  number text not null default '',
  status text not null default 'draft',
  template text not null default 'minimal',
  accent text not null default '#222222',
  currency text not null default 'AED',
  logo text,
  seller_name text not null default '',
  seller_address text,
  seller_trn text,
  seller_email text,
  seller_phone text,
  customer_name text not null default '',
  customer_address text,
  customer_trn text,
  customer_email text,
  issue_date date,
  due_date date,
  notes text,
  terms text,
  tax_rate numeric(8,3) not null default 0,
  discount numeric(14,2) not null default 0,
  amount numeric(14,2) not null default 0,
  amount_words text,
  payment_method text,
  ref_number text,
  for_description text,
  show_stamp boolean not null default false,
  show_signature boolean not null default false,
  shared boolean not null default false,
  share_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for lookups
create index if not exists idx_quotations_share_token on public.quotations(share_token);
create index if not exists idx_purchase_orders_share_token on public.purchase_orders(share_token);
create index if not exists idx_payment_receipts_share_token on public.payment_receipts(share_token);

-- ----- Generic public document viewer -----
-- SECURITY DEFINER: only rows explicitly shared (shared = true) are returned.
create or replace function public.get_shared_doc(p_token uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'doc_type', 'invoice',
    'doc', to_jsonb(d) - 'user_id' - 'org_id' - 'share_token',
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) - 'user_id' - 'org_id' order by i.position)
      from invoice_doc_items i
      where i.invoice_id = d.id
    ), '[]'::jsonb)
  )
  from invoice_docs d
  where d.share_token = p_token and d.shared = true

  union all

  select jsonb_build_object(
    'doc_type', 'quotation',
    'doc', to_jsonb(q) - 'user_id' - 'org_id' - 'share_token',
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) - 'user_id' - 'org_id' order by i.position)
      from quotation_items i
      where i.quotation_id = q.id
    ), '[]'::jsonb)
  )
  from quotations q
  where q.share_token = p_token and q.shared = true

  union all

  select jsonb_build_object(
    'doc_type', 'purchase_order',
    'doc', to_jsonb(po) - 'user_id' - 'org_id' - 'share_token',
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) - 'user_id' - 'org_id' order by i.position)
      from purchase_order_items i
      where i.po_id = po.id
    ), '[]'::jsonb)
  )
  from purchase_orders po
  where po.share_token = p_token and po.shared = true

  union all

  select jsonb_build_object(
    'doc_type', 'receipt',
    'doc', to_jsonb(r) - 'user_id' - 'org_id' - 'share_token',
    'items', jsonb_build_array(jsonb_build_object(
      'description', coalesce(r.for_description, 'Payment'),
      'qty', 1,
      'unit_price', r.amount
    ))
  )
  from payment_receipts r
  where r.share_token = p_token and r.shared = true

  limit 1;
$$;

grant execute on function public.get_shared_doc(uuid) to anon, authenticated;
