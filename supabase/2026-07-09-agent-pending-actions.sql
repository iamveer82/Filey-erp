-- ============================================================
--  Filey ERP — agent_pending_actions: confirm-gated agent actions
--  Run in:  Supabase Dashboard → SQL Editor → New query
--  Safe to re-run (idempotent).
--  The channel agent PROPOSES an action (row status=pending, short code);
--  the owner replies "APPROVE <code>" on the channel to execute it.
--  Rows are written only by edge functions (service role); the desktop app
--  may read its own queue via RLS.
-- ============================================================

create table if not exists agent_pending_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id text not null,
  code text not null,                       -- short approval code the owner types
  action text not null,                     -- e.g. 'send_payment_reminder'
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',   -- pending | approved | rejected | expired
  created_at timestamptz not null default now(),
  executed_at timestamptz
);

create index if not exists idx_agent_pending_user
  on agent_pending_actions(user_id, status);

alter table agent_pending_actions enable row level security;
drop policy if exists agent_pending_read on agent_pending_actions;
create policy agent_pending_read on agent_pending_actions for select
  using (user_id = auth.uid());
