-- One physical count = one atomic, repeatable operation. A lost response must
-- never replay a delta, and another stock change must not be overwritten.
begin;

create table if not exists public.stocktake_requests (
  request_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  org_id text not null default public.current_org(),
  product_id bigint not null references public.products(id) on delete cascade,
  expected_quantity numeric(14,3) not null,
  counted_quantity numeric(14,3) not null check (counted_quantity >= 0),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id, request_id)
);
alter table public.stocktake_requests enable row level security;
revoke all on public.stocktake_requests from public, anon, authenticated;
grant select, insert on public.stocktake_requests to authenticated;
drop policy if exists stocktake_requests_read on public.stocktake_requests;
create policy stocktake_requests_read on public.stocktake_requests for select to authenticated
  using (user_id = (select auth.uid()) and org_id = (select public.current_org())
    and (select public.filey_can_use('inventory')));
drop policy if exists stocktake_requests_insert on public.stocktake_requests;
create policy stocktake_requests_insert on public.stocktake_requests for insert to authenticated
  with check (user_id = (select auth.uid()) and org_id = (select public.current_org())
    and (select public.filey_can_use('inventory')));

create or replace function public.filey_record_stocktake(
  p_id bigint, p_counted numeric, p_expected numeric, p_request uuid
) returns numeric language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_org text := public.current_org();
  v_quantity numeric; v_delta numeric; v_inserted uuid;
  v_receipt public.stocktake_requests%rowtype;
begin
  if v_uid is null then raise exception 'Sign in to post a stocktake'; end if;
  if v_org is null or not public.filey_can_use('inventory') then
    raise exception 'Your account cannot post stocktakes in this workspace' using errcode='42501';
  end if;
  if p_id is null or p_id <= 0 or p_request is null
    or p_counted is null or p_expected is null
    or p_counted::text in ('NaN','Infinity','-Infinity') or p_expected::text in ('NaN','Infinity','-Infinity')
    or p_counted < 0 or abs(p_counted) >= 100000000000 or abs(p_expected) >= 100000000000
    or abs(p_counted-p_expected) >= 100000000000
    or p_counted <> round(p_counted,3) or p_expected <> round(p_expected,3) then
    raise exception 'Enter a valid physical quantity with at most 3 decimal places' using errcode='22023';
  end if;

  -- RLS controls both visibility and update rights. Every request locks just
  -- its product, then reserves its scoped receipt before changing anything.
  select quantity into v_quantity from public.products where id=p_id for update;
  if not found then raise exception 'Product not found or stock access denied' using errcode='42501'; end if;
  insert into public.stocktake_requests(request_id,user_id,org_id,product_id,expected_quantity,counted_quantity)
    values(p_request,v_uid,v_org,p_id,p_expected,p_counted)
    on conflict (org_id,user_id,request_id) do nothing returning request_id into v_inserted;
  if v_inserted is null then
    select * into v_receipt from public.stocktake_requests
      where org_id=v_org and user_id=v_uid and request_id=p_request;
    if not found or v_receipt.product_id<>p_id or v_receipt.expected_quantity<>p_expected or v_receipt.counted_quantity<>p_counted then
      raise exception 'This stocktake request was already used for a different count' using errcode='22023';
    end if;
    return v_receipt.counted_quantity;
  end if;

  if v_quantity is distinct from p_expected then
    raise exception 'Stock changed after this count was opened. Reload stock and review the physical count before posting again.' using errcode='40001';
  end if;
  v_delta := p_counted - v_quantity;
  update public.products set quantity=p_counted where id=p_id returning quantity into v_quantity;
  if not found then raise exception 'Your account cannot update this product stock' using errcode='42501'; end if;
  if v_delta <> 0 then
    insert into public.stock_movements(product_id,qty,type,ref,note,moved_at)
      values(p_id,v_delta,'adjust','Stocktake','Counted '||p_counted||', book '||p_expected,now());
  end if;
  return v_quantity;
end $$;
revoke all on function public.filey_record_stocktake(bigint,numeric,numeric,uuid) from public, anon;
grant execute on function public.filey_record_stocktake(bigint,numeric,numeric,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
