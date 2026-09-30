create role anon;
create role authenticated;
create role service_role bypassrls;
create role authenticator;
create schema auth;
create schema storage;
create table auth.mfa_factors(user_id uuid,status text);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('test.claims',true),''),'{}')::jsonb;
$$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
create table public.records(id integer primary key,owner_id uuid,value text,shared boolean default false);
create table storage.objects(id integer primary key,owner_id uuid,value text);
insert into records values
 (1,'00000000-0000-0000-0000-000000000001','private',false),
 (2,'00000000-0000-0000-0000-000000000002','other',false),
 (3,'00000000-0000-0000-0000-000000000002','public invoice',true);
insert into storage.objects values (1,'00000000-0000-0000-0000-000000000001','private pdf');
alter table records enable row level security;
alter table storage.objects enable row level security;
create policy own_records on records to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy public_records on records for select to anon using(shared);
create policy own_objects on storage.objects to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create function public.private_rpc() returns bigint language sql security definer set search_path=public as $$ select count(*) from records $$;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on public.records,storage.objects to authenticated,service_role;
grant select on public.records to anon;
-- Helper fixtures assert as the actual caller, not as a bypass-RLS owner.
create function public.assert_equal(actual anyelement,expected anyelement,msg text) returns void language plpgsql as $$
begin if actual is distinct from expected then raise exception '%: expected %, got %',msg,expected,actual; end if; end;
$$;
