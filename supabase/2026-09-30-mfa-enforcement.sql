-- Optional MFA must be an API boundary, not only a login-screen check.
-- Additive/idempotent: no account or business rows are changed.
-- Deploy before publishing the matching login/edge-function changes.
-- Existing verified factors require aal2; unverified enrollment does not lock
-- out its owner. Auth's challenge/verify/recovery APIs are unaffected.
begin;

create or replace function public.filey_mfa_allowed()
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select coalesce(auth.jwt()->>'aal','') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors
      where user_id = auth.uid() and status = 'verified'
    );
$$;
revoke all on function public.filey_mfa_allowed() from public;
grant execute on function public.filey_mfa_allowed() to anon, authenticated, service_role;

-- RLS also protects Storage and Realtime; db_pre_request alone does not.
do $$ declare t record; begin
  for t in
    select n.nspname, c.relname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where c.relrowsecurity and c.relkind in ('r','p')
      and (n.nspname='public' or (n.nspname='storage' and c.relname='objects'))
  loop
    execute format('drop policy if exists filey_mfa_required on %I.%I', t.nspname,t.relname);
    execute format('create policy filey_mfa_required on %I.%I as restrictive for all to authenticated using ((select public.filey_mfa_allowed())) with check ((select public.filey_mfa_allowed()))',t.nspname,t.relname);
  end loop;
end $$;

-- SECURITY DEFINER RPCs bypass RLS; enforce the same check before PostgREST
-- dispatches table reads, writes or RPCs. Provider webhooks and cron calls use
-- service_role with their own signature/secret checks and remain unaffected.
create or replace function public.filey_assert_mfa()
returns void language plpgsql stable security definer
set search_path = public, pg_temp as $$
begin
  if auth.jwt()->>'role' = 'authenticated' and not public.filey_mfa_allowed() then
    raise exception 'Complete two-step verification in Filey to continue.' using errcode='42501';
  end if;
end;
$$;
revoke all on function public.filey_assert_mfa() from public;
grant execute on function public.filey_assert_mfa() to anon, authenticated, service_role;

-- Refuse to overwrite an unrelated deployment hook. Review/integrate that
-- hook first; a silent replacement would remove its own security checks.
do $$ declare existing text; begin
  select substring(setting from length('pgrst.db_pre_request=')+1) into existing
    from pg_roles r cross join lateral unnest(r.rolconfig) setting
    where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%';
  if coalesce(existing,'') not in ('','public.filey_assert_mfa') then
    raise exception 'An existing PostgREST pre-request hook must be integrated with filey_assert_mfa before this migration.';
  end if;
  alter role authenticator set pgrst.db_pre_request = 'public.filey_assert_mfa';
end $$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
