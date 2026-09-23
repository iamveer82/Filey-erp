-- The $5/month Cloud plan: remember which Dodo subscription pays for an org.
--
-- `dodo_subscription_id` is how a renewal, a failed card or a cancellation
-- finds the right organisation months later — the checkout metadata names the
-- org on the first event only, and later events carry the subscription alone.
--
-- `dodo_customer_id` is what the customer portal needs, so a member can cancel
-- or change their card without us holding billing data.
--
-- No plan values change here. `organizations.plan` already accepts any string
-- and every path that asks "is this paid?" reads `plan <> 'free'` with a live
-- status, so 'cloud' needs no enum, no backfill, and no new cap logic.

begin;

alter table public.organizations add column if not exists dodo_customer_id text;
alter table public.organizations add column if not exists dodo_subscription_id text;

-- One subscription pays for one organisation; without this a replayed or
-- out-of-order webhook could attach the same subscription to two orgs.
create unique index if not exists organizations_dodo_subscription_id_key
  on public.organizations (dodo_subscription_id)
  where dodo_subscription_id is not null;

-- SECURITY: same rule as billing-columns-lockdown.sql — only the webhook
-- (service_role, which bypasses grants) writes billing columns. A member who
-- could write dodo_subscription_id would be able to claim someone else's
-- subscription id and, through the unique index, keep the paying org from
-- being marked paid at all.
revoke update (dodo_customer_id, dodo_subscription_id)
  on public.organizations from authenticated, anon;

commit;
