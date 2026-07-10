-- ============================================================
--  Filey ERP — sync_state: desktop → cloud auto-sync bookkeeping
--  Run in:  Supabase Dashboard → SQL Editor → New query
--  Safe to re-run (idempotent).
--  One row per (user, table): when the desktop's auto-sync (src/lib/sync.ts)
--  last pushed that table. Written by the desktop client as the signed-in
--  user; RLS keeps it per-account.
-- ============================================================

create table if not exists sync_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  table_name text not null,
  synced_at timestamptz not null default now(),
  primary key (user_id, table_name)
);

alter table sync_state enable row level security;
drop policy if exists sync_state_own on sync_state;
create policy sync_state_own on sync_state for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
