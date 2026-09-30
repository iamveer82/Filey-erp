create table organizations(
  id uuid primary key default gen_random_uuid(),name text,owner_id uuid default auth.uid(),
  created_at timestamptz default now(),updated_at timestamptz default now(),
  plan text default 'free',plan_status text default 'inactive',
  stripe_customer_id text,stripe_subscription_id text,current_period_end timestamptz,
  dodo_customer_id text,dodo_subscription_id text,cloud_grandfathered boolean default false
);
create function current_org() returns text language sql stable as $$ select current_setting('test.org',true) $$;
alter table organizations enable row level security;
create policy organizations_access on organizations for all
  using(id::text=current_org() or owner_id=auth.uid()) with check(owner_id=auth.uid());
grant all on organizations to anon,authenticated,service_role;
-- Reproduce the historical attempted lockdown and its ineffective result.
revoke update(plan,plan_status,stripe_customer_id,stripe_subscription_id,current_period_end,dodo_customer_id,dodo_subscription_id,cloud_grandfathered)
  on organizations from anon,authenticated;
select assert_equal(has_column_privilege('authenticated','organizations','plan','update'),true,'Table UPDATE overrides the old column-only revoke');
insert into organizations(id,name,owner_id) values
 ('10000000-0000-0000-0000-000000000001','Shared workspace','00000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002','Other workspace','00000000-0000-0000-0000-000000000002');
-- Existing application workspace creation uses a definer RPC with defaults.
create function filey_create_workspace(p_name text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare workspace uuid; begin
  insert into organizations(name,owner_id) values(p_name,auth.uid()) returning id into workspace;
  return workspace;
end $$;
revoke all on function filey_create_workspace(text) from public,anon;
grant execute on function filey_create_workspace(text) to authenticated;

-- Prove both old policy exploit paths on synthetic records, then roll back.
begin;
set local role authenticated;
set local test.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
set local test.org='10000000-0000-0000-0000-000000000001';
update organizations set plan='ultra',plan_status='active',cloud_grandfathered=true;
select assert_equal((select plan from organizations where id=current_org()::uuid),'ultra'::text,'Old grants allow owner self-upgrade');
set local test.claims='{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}';
delete from organizations where id=current_org()::uuid;
select assert_equal((select count(*) from organizations where id=current_org()::uuid),0::bigint,'Old DELETE USING admits current-org staff');
rollback;
