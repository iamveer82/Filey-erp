-- Public share-token RPCs bypass RLS. Their child joins must therefore enforce
-- organization identity explicitly, even for malformed historical/admin rows.
-- Preserve customer document fields; strip only ownership/share authority.
-- Null organization identity cannot prove the child belongs to this document.
begin;

create or replace function public.get_shared_invoice(p_token uuid)
returns jsonb language sql security definer set search_path = public,pg_temp as $$
  select jsonb_build_object(
    'doc', to_jsonb(d) - array['user_id','org_id','share_token','shared_with'],
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) - array['user_id','org_id','share_token','shared_with'] order by i.position)
      from public.invoice_doc_items i
      where i.invoice_id=d.id and i.org_id=d.org_id
    ), '[]'::jsonb)
  )
  from public.invoice_docs d
  where d.share_token=p_token and d.shared=true;
$$;

create or replace function public.get_shared_doc(p_token uuid)
returns jsonb language sql security definer set search_path = public,pg_temp as $$
  select jsonb_build_object(
    'doc_type', 'invoice',
    'doc', to_jsonb(d) - array['user_id','org_id','share_token','shared_with'],
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) - array['user_id','org_id','share_token','shared_with'] order by i.position)
      from public.invoice_doc_items i
      where i.invoice_id=d.id and i.org_id=d.org_id
    ), '[]'::jsonb)
  ) from public.invoice_docs d where d.share_token=p_token and d.shared=true
  union all
  select jsonb_build_object(
    'doc_type', 'quotation',
    'doc', to_jsonb(q) - array['user_id','org_id','share_token','shared_with'],
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) - array['user_id','org_id','share_token','shared_with'] order by i.position)
      from public.quotation_items i
      where i.quotation_id=q.id and i.org_id=q.org_id
    ), '[]'::jsonb)
  ) from public.quotations q where q.share_token=p_token and q.shared=true
  union all
  select jsonb_build_object(
    'doc_type', 'purchase_order',
    'doc', to_jsonb(po) - array['user_id','org_id','share_token','shared_with'],
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) - array['user_id','org_id','share_token','shared_with'] order by i.position)
      from public.purchase_order_items i
      where i.po_id=po.id and i.org_id=po.org_id
    ), '[]'::jsonb)
  ) from public.purchase_orders po where po.share_token=p_token and po.shared=true
  union all
  select jsonb_build_object(
    'doc_type', 'receipt',
    'doc', to_jsonb(r) - array['user_id','org_id','share_token','shared_with'],
    'items', jsonb_build_array(jsonb_build_object(
      'description', coalesce(r.for_description,'Payment'),
      'qty', 1,
      'unit_price', r.amount
    ))
  ) from public.payment_receipts r where r.share_token=p_token and r.shared=true
  limit 1;
$$;

-- These two narrow token gates remain intentionally anonymous-readable.
revoke all on function public.get_shared_invoice(uuid) from public;
revoke all on function public.get_shared_doc(uuid) from public;
grant execute on function public.get_shared_invoice(uuid) to anon,authenticated;
grant execute on function public.get_shared_doc(uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
