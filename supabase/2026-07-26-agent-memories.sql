-- 2026-07-26: agent_memories — durable long-term memory for the channel agent.
-- Idempotent: safe to re-run.
--
-- The hosted channel agent (supabase/functions/channel-webhook) saves durable
-- facts/preferences/corrections here via its `remember` tool and reads them
-- back via `recall` + the system-prompt MEMORY block. Rows belong to one
-- auth.users row (the install owner); RLS scopes every operation to that owner.

create table if not exists public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id text not null,
  text text not null,
  tag text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_memories_user_updated_idx
  on public.agent_memories (user_id, updated_at desc);

alter table public.agent_memories enable row level security;

drop policy if exists agent_memories_select_own on public.agent_memories;
create policy agent_memories_select_own on public.agent_memories
  for select using (user_id = auth.uid());

drop policy if exists agent_memories_insert_own on public.agent_memories;
create policy agent_memories_insert_own on public.agent_memories
  for insert with check (user_id = auth.uid());

drop policy if exists agent_memories_update_own on public.agent_memories;
create policy agent_memories_update_own on public.agent_memories
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists agent_memories_delete_own on public.agent_memories;
create policy agent_memories_delete_own on public.agent_memories
  for delete using (user_id = auth.uid());
