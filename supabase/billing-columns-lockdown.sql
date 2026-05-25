-- Security: the org's billing columns are written ONLY by the Stripe webhook
-- (service_role, which bypasses grants/RLS). Revoke UPDATE on those columns
-- from app users so a member can't fake their own plan via the API. SELECT is
-- untouched (the client still reads the plan). Idempotent.

revoke update (plan, plan_status, stripe_customer_id, stripe_subscription_id, current_period_end)
  on organizations from authenticated, anon;
