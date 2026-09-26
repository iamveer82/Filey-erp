-- Buying from the website, before you have a Filey account.
--
-- In the app a purchase carries the buyer's user_id, so the webhook knows
-- exactly whose licence it is. From the website there is no account yet — the
-- buyer types an email on a pricing page. So the webhook parks the purchase
-- here, keyed by that email, and the app claims it the first time someone
-- signs in with the matching address.
--
-- Why this is safe: Supabase has already verified the email of whoever is
-- signed in, so only the real owner of that address can claim. A buyer who
-- mistypes their email gifts the purchase to whoever owns the address they
-- typed — that risks giving value away, never taking it from someone.
--
-- The table is service-role only. It has RLS on and NO policies at all, which
-- is the strongest statement available: no client, however authenticated, can
-- read or write it. The claim happens through a SECURITY DEFINER function that
-- only ever looks at the caller's own verified email.

begin;

create table if not exists public.pending_entitlements (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  kind text not null check (kind in ('cloud', 'freedom')),
  dodo_payment_id text,
  dodo_subscription_id text,
  dodo_customer_id text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by uuid references auth.users(id) on delete set null
);

-- Email is matched case-insensitively: people type Sam@Example.com and sign in
-- as sam@example.com.
create unique index if not exists pending_entitlements_payment_key
  on public.pending_entitlements (dodo_payment_id)
  where dodo_payment_id is not null;
create unique index if not exists pending_entitlements_subscription_key
  on public.pending_entitlements (dodo_subscription_id)
  where dodo_subscription_id is not null;
create index if not exists pending_entitlements_email_idx
  on public.pending_entitlements (lower(email))
  where claimed_at is null;

alter table public.pending_entitlements enable row level security;

/* ---------------- looking a buyer up by email ---------------- */
-- The webhook runs as the service role and needs to know whether the address
-- someone typed on the pricing page already has an account, so the purchase
-- can be granted immediately instead of waiting to be claimed. auth.users is
-- not reachable through PostgREST, so expose exactly two columns and nothing
-- else — and only to the service role, never to a client.

create or replace view public.filey_users_by_email
with (security_invoker = true) as
  select id, lower(email) as email from auth.users;

revoke all on public.filey_users_by_email from public, anon, authenticated;
grant select on public.filey_users_by_email to service_role;

/* ---------------- claiming ---------------- */

-- Called by the app after sign-in. Turns every unclaimed purchase for the
-- caller's verified email into the real thing: a licence row for Freedom, a
-- paid plan on their org for Cloud. Idempotent — a second call finds nothing
-- left to claim, and an existing licence is never duplicated.
create or replace function public.filey_claim_entitlements()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_org text;
  v_row record;
  v_claimed_cloud int := 0;
  v_claimed_licence int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('claimed', false, 'reason', 'not signed in');
  end if;

  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is null or v_email = '' then
    return jsonb_build_object('claimed', false, 'reason', 'no email on account');
  end if;

  for v_row in
    select * from public.pending_entitlements
    where claimed_at is null and lower(email) = v_email
    order by created_at
    for update
  loop
    if v_row.kind = 'freedom' then
      -- One active licence per account is enough; a second purchase stays
      -- unclaimed rather than silently vanishing.
      if not exists (
        select 1 from public.licenses
        where user_id = v_uid and status = 'active'
      ) then
        insert into public.licenses (user_id, product, status, dodo_payment_id)
        values (v_uid, 'filey-desktop', 'active', v_row.dodo_payment_id)
        on conflict do nothing;
        v_claimed_licence := v_claimed_licence + 1;
        update public.pending_entitlements
          set claimed_at = now(), claimed_by = v_uid where id = v_row.id;
      end if;
    else
      select o.id::text into v_org
      from public.organizations o
      where o.id::text = public.current_org()
         or o.owner_id = v_uid
      order by (o.id::text = public.current_org()) desc, o.created_at
      limit 1;
      if v_org is not null then
        update public.organizations
          set plan = 'cloud',
              plan_status = 'active',
              dodo_subscription_id = coalesce(v_row.dodo_subscription_id, dodo_subscription_id),
              dodo_customer_id = coalesce(v_row.dodo_customer_id, dodo_customer_id)
          where id::text = v_org;
        v_claimed_cloud := v_claimed_cloud + 1;
        update public.pending_entitlements
          set claimed_at = now(), claimed_by = v_uid where id = v_row.id;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'claimed', (v_claimed_cloud + v_claimed_licence) > 0,
    'cloud', v_claimed_cloud,
    'licences', v_claimed_licence
  );
end;
$$;

revoke all on function public.filey_claim_entitlements() from public, anon;
grant execute on function public.filey_claim_entitlements() to authenticated;

commit;
