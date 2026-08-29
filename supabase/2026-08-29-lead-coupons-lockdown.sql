-- Lock down lead_coupons. SECURITY FIX.
--
-- The table shipped with three blanket policies:
--
--   SELECT  to authenticated  using (true)
--   UPDATE  to authenticated  using (true) with check (true)
--   INSERT  to anon,authenticated  with check (true)
--
-- It holds a website lead's name, phone, email and message alongside `code` —
-- the voucher that grants a free offline licence, which is the paid product.
-- So any account that could sign up could read every lead's contact details
-- and every licence code, could flip `status`/`redeemed_at` to make a spent
-- coupon look unspent, and anyone at all could insert forged rows. Caught at
-- zero rows, before a single real lead had landed in it.
--
-- Nothing legitimate needs those grants: lead-contact/index.ts writes this
-- table with SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS. The only client
-- reader is the owner's LicensePanel list, so that is the only thing kept —
-- scoped to the owner rather than to "anyone signed in". lead_requests, the
-- sibling table, is already correct this way: RLS on, no policies at all.

-- ---------- who the platform owner is ----------
-- platform_config is RLS-on with no policies, so it is service-role only and
-- clients cannot read or rewrite this marker. The helper below is SECURITY
-- DEFINER so it can still consult it during policy evaluation.
insert into public.platform_config (key, value)
values ('owner_uid', '48cc4e67-ee5d-4f70-b221-f2570ecdde9e')
on conflict (key) do update set value = excluded.value;

create or replace function public.is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_config
    where key = 'owner_uid'
      and value = (select auth.uid())::text
  );
$$;

revoke all on function public.is_platform_owner() from public, anon;
grant execute on function public.is_platform_owner() to authenticated;

-- ---------- replace the blanket policies ----------
drop policy if exists "lead coupons can be created by anyone" on public.lead_coupons;
drop policy if exists "lead coupons readable by signed in"   on public.lead_coupons;
drop policy if exists "lead coupons updatable by signed in"  on public.lead_coupons;

-- No INSERT policy on purpose: the edge function inserts with the service
-- role. A client never legitimately creates a coupon, so leaving anon INSERT
-- open only bought forged rows.
create policy lead_coupons_owner_select
  on public.lead_coupons
  for select
  to authenticated
  using ((select public.is_platform_owner()));

-- The panel's only write is marking a coupon "sent".
create policy lead_coupons_owner_update
  on public.lead_coupons
  for update
  to authenticated
  using ((select public.is_platform_owner()))
  with check ((select public.is_platform_owner()));
