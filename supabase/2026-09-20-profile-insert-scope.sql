-- A user must not recreate their profile inside an arbitrary organization.
-- Signup provisioning runs as the trusted auth trigger; UI upserts omit org_id.
begin;
drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles for insert to authenticated
  with check (id=auth.uid() and (org_id='default' or exists(
    select 1 from public.org_members m where m.org_id=profiles.org_id and m.user_id=auth.uid()
  )));
commit;
