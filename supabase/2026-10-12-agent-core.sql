-- 2026-10-12: agent-core — queued execution state + audit for the in-app agent.
-- Idempotent: safe to re-run. Apply before shipping a build that enqueues tasks.
--
-- The desktop app writes these with the signed-in user's session, so every row
-- belongs to one auth.users row and RLS scopes all access to that owner.
-- Events and tool calls carry no user_id; they inherit their thread's/task's owner.
begin;

create table if not exists public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid,
  channel text not null default 'app',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.agent_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid,
  task_type text not null,
  status text not null default 'queued' check (status in ('queued','running','done','failed','dead_letter')),
  attempts integer not null default 0,
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  next_run_at timestamptz not null default now(),
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Per owner: a global key would let one user's key collide with (and reveal) another's.
create unique index if not exists ux_agent_tasks_idempotency
  on public.agent_tasks(user_id, idempotency_key) where idempotency_key is not null;

create index if not exists ix_agent_tasks_claim
  on public.agent_tasks(user_id, status, next_run_at);

create table if not exists public.agent_events (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.agent_threads(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.agent_tasks(id) on delete cascade,
  tool_name text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  status text not null default 'ok' check (status in ('ok','error')),
  elapsed_ms integer,
  created_at timestamptz not null default now()
);

create table if not exists public.journal_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid,
  source_type text not null,
  source_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ix_agent_threads_user on public.agent_threads(user_id);
create index if not exists ix_agent_events_thread on public.agent_events(thread_id);
create index if not exists ix_agent_tool_calls_task on public.agent_tool_calls(task_id);
create index if not exists ix_journal_events_user on public.journal_events(user_id, created_at desc);

alter table public.agent_threads enable row level security;
alter table public.agent_tasks enable row level security;
alter table public.agent_events enable row level security;
alter table public.agent_tool_calls enable row level security;
alter table public.journal_events enable row level security;

revoke all on public.agent_threads, public.agent_tasks, public.agent_events,
  public.agent_tool_calls, public.journal_events from anon;
grant select, insert, update, delete on public.agent_threads, public.agent_tasks,
  public.agent_events, public.agent_tool_calls, public.journal_events to authenticated;

drop policy if exists agent_threads_own on public.agent_threads;
create policy agent_threads_own on public.agent_threads for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- A task may only hang off one of its owner's own threads.
drop policy if exists agent_tasks_own on public.agent_tasks;
create policy agent_tasks_own on public.agent_tasks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (thread_id is null or exists (
    select 1 from public.agent_threads t where t.id = thread_id and t.user_id = (select auth.uid()))));

drop policy if exists agent_events_own on public.agent_events;
create policy agent_events_own on public.agent_events for all to authenticated
  using (exists (select 1 from public.agent_threads t where t.id = thread_id and t.user_id = (select auth.uid())))
  with check (exists (select 1 from public.agent_threads t where t.id = thread_id and t.user_id = (select auth.uid())));

drop policy if exists agent_tool_calls_own on public.agent_tool_calls;
create policy agent_tool_calls_own on public.agent_tool_calls for all to authenticated
  using (exists (select 1 from public.agent_tasks k where k.id = task_id and k.user_id = (select auth.uid())))
  with check (exists (select 1 from public.agent_tasks k where k.id = task_id and k.user_id = (select auth.uid())));

drop policy if exists journal_events_own on public.journal_events;
create policy journal_events_own on public.journal_events for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
