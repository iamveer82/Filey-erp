-- Team sharing for invoices: per-member targeting on top of the org model.
--
-- Until now "share" was one bit: shared=true made an invoice visible to the
-- whole org (and minted a public portal link). This adds shared_with — a JSON
-- array of member user-ids — so an invoice can go to exactly the people who
-- need it. The RLS clause below is the only enforcement point; the same
-- column + clause pattern extends to quotations, customers, etc. later.
--
-- RLS: org members see an invoice when
--   · they authored it, OR
--   · shared = true (whole org), OR
--   · shared_with contains their auth.uid(), OR
--   · they are an org admin (admins see everything in the org).

alter table public.invoice_docs
  add column if not exists shared_with jsonb not null default '[]'::jsonb;

create index if not exists invoice_docs_shared_with_idx
  on public.invoice_docs using gin (shared_with);

-- Drop + recreate the access policy with the new clause.
drop policy if exists "invoice_docs_access" on public.invoice_docs;
create policy "invoice_docs_access"
  on public.invoice_docs
  for all
  using (
    user_id = (select auth.uid())
    or (
      org_id = (select current_org())
      and (
        (select is_org_admin())
        or shared = true
        or shared_with ? (select auth.uid())::text
      )
    )
  )
  with check (
    user_id = (select auth.uid())
    or (
      org_id = (select current_org())
      and (
        (select is_org_admin())
        or shared = true
        or shared_with ? (select auth.uid())::text
      )
    )
  );

-- Atomic share: only the invoice's author or an org admin may change who can
-- see it. `p_all` = whole org (shared=true); otherwise p_user_ids is the FULL
-- new member list (replace, not merge — so removing a member is possible).
create or replace function public.share_invoice(
  p_id bigint,
  p_all boolean,
  p_user_ids jsonb default '[]'::jsonb
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_row   invoice_docs;
  v_admin boolean := is_org_admin();
begin
  if v_uid is null then
    return json_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  select * into v_row from invoice_docs where id = p_id;
  if v_row.id is null then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_row.user_id <> v_uid and not v_admin then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_all then
    update invoice_docs
      set shared = true, updated_at = now()
      where id = p_id;
  else
    update invoice_docs
      set shared_with = coalesce(p_user_ids, '[]'::jsonb),
          updated_at = now()
      where id = p_id;
  end if;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.share_invoice(bigint, boolean, jsonb) from public, anon;
grant execute on function public.share_invoice(bigint, boolean, jsonb) to authenticated;
