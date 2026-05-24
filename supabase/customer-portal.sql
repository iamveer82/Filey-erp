-- Customer portal (#23): public, read-only invoice view by share token.
-- A SECURITY DEFINER function returns a shared invoice for anonymous viewers,
-- WITHOUT opening broad anon SELECT on the table. Only invoices the owner has
-- explicitly shared (shared = true) are exposed, and only by their token.
-- user_id / org_id / share_token are stripped from the output.

alter table invoice_docs add column if not exists share_token uuid not null default gen_random_uuid();

create or replace function public.get_shared_invoice(p_token uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'doc', to_jsonb(d) - 'user_id' - 'org_id' - 'share_token',
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) - 'user_id' - 'org_id' order by i.position)
      from invoice_doc_items i
      where i.invoice_id = d.id
    ), '[]'::jsonb)
  )
  from invoice_docs d
  where d.share_token = p_token and d.shared = true;
$$;

grant execute on function public.get_shared_invoice(uuid) to anon, authenticated;
