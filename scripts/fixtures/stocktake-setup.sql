-- Disposable fixture only; match the columns used by the production RPC.
create table auth.users(id uuid primary key);
insert into auth.users select distinct user_id from public.org_members;
alter table public.products add column quantity numeric(14,3) not null default 10;
insert into public.products(id,user_id,org_id,shared,quantity) values
  (8001,'00000000-0000-0000-0000-000000000001','a',true,10),
  (8002,'00000000-0000-0000-0000-000000000001','a',false,10);
alter table public.stock_movements add column product_id bigint references public.products(id),
  add column qty numeric(14,3) not null default 0,
  add column type text not null default 'adjust', add column ref text, add column note text,
  add column moved_at timestamptz not null default now();
create sequence fixture_stocktake_ids start 10000;
alter table public.stock_movements alter column id set default nextval('fixture_stocktake_ids');
grant usage on sequence fixture_stocktake_ids to authenticated;
create function fixture_stocktake_failure() returns trigger language plpgsql as $$ begin
  if new.qty=777 then raise exception 'Fixture stock movement failure'; end if;
  return new;
end $$;
create trigger fixture_stocktake_failure before insert on public.stock_movements
  for each row execute function fixture_stocktake_failure();
