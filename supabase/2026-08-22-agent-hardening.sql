-- ============================================================
--  Filey ERP — agent hardening: approval-code integrity + inbound dedup
--  Run in:  Supabase Dashboard → SQL Editor → New query
--  Safe to re-run (idempotent).
--
--  Four fixes for the channel agent's confirm gate and webhook pipeline:
--   1. agent_pending_actions.expires_at — explicit expiry timestamp
--      (backfilled to created_at + 24h to match what the function enforced).
--   2. A partial unique index so two LIVE pending actions can never share a
--      code: brute-forcing APPROVE codes must not hit look-alike proposals,
--      and the edge function relies on (user_id, code) picking ONE row.
--   3. An index for the count-based rate limiter (it filters
--      user_id + action + created_at on every request).
--   4. channel_seen_messages — provider message ids already processed, so a
--      redelivered Telegram/WhatsApp/Slack webhook can't make us reply twice.
--      RLS with NO policies: service-role only, by design.
--
--  Plus an INSERT policy letting the owner's own client (the MCP desktop
--  flow) create PENDING proposals. Deliberately NO update/delete policy:
--  approvals only ever happen through the service-role edge function.
-- ============================================================

alter table agent_pending_actions add column if not exists expires_at timestamptz;

update agent_pending_actions set expires_at = created_at + interval '24 hours'
  where expires_at is null;

-- Partial: only LIVE proposals are protected. Approved/rejected/expired rows
-- keep their historical codes without blocking reuse of the code space.
create unique index if not exists agent_pending_actions_live_code_uq
  on agent_pending_actions(user_id, code) where status = 'pending';

create index if not exists audit_log_user_action_created_ix
  on audit_log(user_id, action, created_at);

create table if not exists public.channel_seen_messages (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  external_id text not null,
  created_at timestamptz not null default now(),
  unique(channel, external_id)
);

alter table public.channel_seen_messages enable row level security;
-- No policies: nothing reads or writes this table except the service role.
-- CLEANUP: rows are append-only bookkeeping; prune old ones periodically,
-- e.g. nightly: delete from channel_seen_messages where created_at < now() - interval '7 days';

drop policy if exists agent_pending_actions_owner_insert on agent_pending_actions;
create policy agent_pending_actions_owner_insert on agent_pending_actions
  for insert to authenticated
  with check (auth.uid() = user_id and status = 'pending');
